"""
SafePathAI Camera Ingestion Scheduler & Fair Queue Manager.

Solves camera starvation across all registered HCMC traffic cameras:
- Rotates dynamically across all 796 verified PostGIS camera nodes.
- Preserves persistent attempt, success, failure count, and next_retry_at state in PostgreSQL.
- Implements exponential backoff for offline/unreachable nodes.
- Enforces multi-tier prioritization:
    Tier 0: Actively viewed cameras on map / dashboard.
    Tier 1: Corridor cameras along actively searched navigation routes.
    Tier 2: Stale cameras requiring refresh.
    Tier 3: Fair round-robin pool ensuring all 796 nodes receive scheduled checks.
- Redis distributed lease locking (prevents duplicate fetches across concurrent workers).
- Decouples raw image fetching from ONNX Computer Vision inference queue.
- Strict Zero-Mock: Excludes error frames ("IMAGE NOT AVAILABLE" / PLACEHOLDER) from AI pipeline.
"""

from datetime import datetime, timedelta, timezone
import json
import logging
import os
from typing import Any, Dict, List, Optional, Set, Tuple
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.services.scraper import ScrapedCameraResult

logger = logging.getLogger("safepath.scheduler")


class CameraScheduler:
    """
    Autonomous Camera Ingestion Scheduler managing rotating batches,
    distributed locks, and persistent state.
    """

    def __init__(
        self,
        base_interval_sec: float = 60.0,
        base_backoff_sec: float = 30.0,
        max_backoff_sec: float = 3600.0,
        lease_ttl_sec: int = 120,
    ):
        self.base_interval_sec = base_interval_sec
        self.base_backoff_sec = base_backoff_sec
        self.max_backoff_sec = max_backoff_sec
        self.lease_ttl_sec = lease_ttl_sec

    async def get_active_priority_camera_ids(self, redis: Optional[Redis]) -> Tuple[Set[str], Set[str]]:
        """
        Retrieves real-time high-priority camera IDs from Redis sets:
        - active_viewed_cameras: cameras currently in active browser viewports
        - active_route_cameras: cameras within corridors of active searched routes
        """
        if redis is None:
            return set(), set()
        try:
            viewed_raw = await redis.smembers("active_viewed_cameras")
            route_raw = await redis.smembers("active_route_cameras")
            viewed = {x if isinstance(x, str) else x.decode("utf-8") for x in viewed_raw}
            route = {x if isinstance(x, str) else x.decode("utf-8") for x in route_raw}
            return viewed, route
        except Exception as exc:
            logger.debug("Failed to read priority sets from Redis: %s", exc)
            return set(), set()

    async def acquire_batch(
        self,
        session: AsyncSession,
        redis: Optional[Redis] = None,
        batch_size: int = 8,
        worker_id: str = "worker-1",
    ) -> List[Dict[str, Any]]:
        """
        Selects a priority-ranked, starvation-free batch of cameras ready for ingestion.
        Guarantees that every camera in the 796-node registry gets rotated fairly.
        """
        now = datetime.now(timezone.utc)
        viewed_ids, route_ids = await self.get_active_priority_camera_ids(redis)

        # Multi-tiered selection query:
        # 1. Ready for poll: next_retry_at IS NULL OR next_retry_at <= now
        # 2. Priority order:
        #    - Tier 0: In active_viewed_cameras
        #    - Tier 1: In active_route_cameras
        #    - Tier 2: Stale data needing refresh
        #    - Tier 3: Round-robin by last_attempt_at ASC (NULLs first!)
        query_sql = text("""
            SELECT 
                c.cam_id, 
                c.code, 
                c.name, 
                c.district, 
                ST_Y(c.geom) AS lat, 
                ST_X(c.geom) AS lng,
                c.source_uri,
                s.last_attempt_at,
                s.last_success_at,
                s.failure_count,
                s.image_hash,
                CASE 
                    WHEN c.cam_id = ANY(:viewed_ids) THEN 0
                    WHEN c.cam_id = ANY(:route_ids) THEN 1
                    WHEN s.last_success_at IS NOT NULL AND (:now_epoch - EXTRACT(EPOCH FROM s.last_success_at)) > :ttl THEN 2
                    ELSE 3
                END AS priority_tier
            FROM traffic_cameras c
            LEFT JOIN camera_ingestion_state s ON c.cam_id = s.cam_id
            WHERE c.geom IS NOT NULL
              AND (s.next_retry_at IS NULL OR s.next_retry_at <= :now)
            ORDER BY 
                priority_tier ASC,
                COALESCE(s.last_attempt_at, '1970-01-01 00:00:00+00'::timestamptz) ASC,
                c.cam_id ASC
            LIMIT :candidate_limit
        """)

        candidate_limit = max(batch_size * 4, 32)
        params = {
            "viewed_ids": list(viewed_ids) if viewed_ids else ["__none__"],
            "route_ids": list(route_ids) if route_ids else ["__none__"],
            "now": now,
            "now_epoch": now.timestamp(),
            "ttl": settings.CAMERA_IMAGE_TTL_SECONDS,
            "candidate_limit": candidate_limit,
        }

        result = await session.execute(query_sql, params)
        candidates = result.fetchall()

        acquired_batch: List[Dict[str, Any]] = []

        for row in candidates:
            cam_id = row.cam_id

            # Distributed Lease Lock via Redis SET NX EX
            if redis is not None:
                try:
                    lease_key = f"camera:lease:{cam_id}"
                    acquired = await redis.set(lease_key, worker_id, ex=self.lease_ttl_sec, nx=True)
                    if not acquired:
                        # Another worker holds lease on this camera
                        continue
                except Exception as exc:
                    logger.debug("Redis lease check failed for %s: %s", cam_id, exc)

            acquired_batch.append({
                "cam_id": cam_id,
                "code": row.code,
                "name": row.name,
                "district": row.district,
                "lat": row.lat,
                "lng": row.lng,
                "source_uri": row.source_uri,
                "previous_image_hash": row.image_hash,
                "priority_tier": row.priority_tier,
            })

            # Update last_attempt_at immediately to advance starvation round-robin
            upsert_attempt_sql = text("""
                INSERT INTO camera_ingestion_state (
                    cam_id, source_status, last_attempt_at, next_retry_at, failure_count
                ) VALUES (
                    :cam_id, 'ATTEMPTING', :now, :tentative_retry, 0
                )
                ON CONFLICT (cam_id) DO UPDATE SET
                    last_attempt_at = :now,
                    next_retry_at = :tentative_retry
            """)
            await session.execute(upsert_attempt_sql, {
                "cam_id": cam_id,
                "now": now,
                "tentative_retry": now + timedelta(seconds=self.base_interval_sec),
            })

            if len(acquired_batch) >= batch_size:
                break

        await session.commit()
        return acquired_batch

    async def record_result(
        self,
        session: AsyncSession,
        res: ScrapedCameraResult,
        redis: Optional[Redis] = None,
    ) -> None:
        """
        Updates persistent camera ingestion state following fetch & validation:
        - Success: resets failure count, schedules next standard cycle.
        - Failure: applies exponential backoff and records truthful error codes.
        - Releases Redis lease lock.
        """
        now = datetime.now(timezone.utc)
        cam_id = res.cam_id

        # 1. Release distributed lease
        if redis is not None:
            try:
                await redis.delete(f"camera:lease:{cam_id}")
            except Exception as exc:
                logger.debug("Failed to release lease for %s: %s", cam_id, exc)

        # 2. Compute backoff & next retry
        if res.is_valid_image:
            new_failure_count = 0
            next_retry = now + timedelta(seconds=self.base_interval_sec)
            status_str = "LIVE"
            val_status = res.validation_status or "VALID_FRAME"
            http_status = 200
            err_code = None
        else:
            # Query existing failure count for backoff
            cur_fc = await session.execute(
                text("SELECT failure_count FROM camera_ingestion_state WHERE cam_id = :cam_id"),
                {"cam_id": cam_id},
            )
            val = cur_fc.scalar()
            new_failure_count = (val or 0) + 1

            # Exponential backoff capped at max_backoff_sec (1 hour)
            backoff_sec = min(self.max_backoff_sec, self.base_backoff_sec * (2 ** min(new_failure_count - 1, 6)))
            next_retry = now + timedelta(seconds=backoff_sec)
            status_str = "STALE" if res.image_path else "OFFLINE"
            val_status = res.validation_status or "VALIDATION_FAILED"
            http_status = 200 if res.image_status_reason == "PLACEHOLDER_FRAME" else 503
            err_code = res.image_status_reason or "FETCH_FAILED"

        upsert_sql = text("""
            INSERT INTO camera_ingestion_state (
                cam_id, source_status, last_attempt_at, last_success_at,
                last_captured_at, last_retrieved_at, next_retry_at, failure_count,
                http_status, validation_status, image_hash, last_error_code
            ) VALUES (
                :cam_id, :source_status, :now, :last_success_at,
                :last_captured_at, :last_retrieved_at, :next_retry_at, :failure_count,
                :http_status, :validation_status, :image_hash, :last_error_code
            )
            ON CONFLICT (cam_id) DO UPDATE SET
                source_status = :source_status,
                last_attempt_at = :now,
                last_success_at = COALESCE(:last_success_at, camera_ingestion_state.last_success_at),
                last_captured_at = COALESCE(:last_captured_at, camera_ingestion_state.last_captured_at),
                last_retrieved_at = COALESCE(:last_retrieved_at, camera_ingestion_state.last_retrieved_at),
                next_retry_at = :next_retry_at,
                failure_count = :failure_count,
                http_status = :http_status,
                validation_status = :validation_status,
                image_hash = COALESCE(:image_hash, camera_ingestion_state.image_hash),
                last_error_code = :last_error_code
        """)

        await session.execute(upsert_sql, {
            "cam_id": cam_id,
            "source_status": status_str,
            "now": now,
            "last_success_at": now if res.is_valid_image else None,
            "last_captured_at": res.captured_at,
            "last_retrieved_at": res.retrieved_at,
            "next_retry_at": next_retry,
            "failure_count": new_failure_count,
            "http_status": http_status,
            "validation_status": val_status,
            "image_hash": res.etag if res.is_valid_image else None,
            "last_error_code": err_code,
        })
        await session.commit()

    async def record_vision_completion(
        self,
        session: AsyncSession,
        cam_id: str,
        model_status: str,
        image_hash: Optional[str] = None,
    ) -> None:
        """Records completion of Computer Vision pipeline execution."""
        stmt = text("""
            UPDATE camera_ingestion_state
            SET model_status = :model_status,
                image_hash = COALESCE(:image_hash, image_hash)
            WHERE cam_id = :cam_id
        """)
        await session.execute(stmt, {
            "cam_id": cam_id,
            "model_status": model_status,
            "image_hash": image_hash,
        })
        await session.commit()

    async def get_metrics(
        self,
        session: AsyncSession,
        redis: Optional[Redis] = None,
    ) -> Dict[str, Any]:
        """
        Aggregates operational ingestion metrics for administration endpoints.
        Never leaks internal cookies, secrets, or authentication tokens.
        """
        now = datetime.now(timezone.utc)
        recent_cutoff = now - timedelta(hours=1)

        stmt = text("""
            SELECT 
                count(*) AS total_registered,
                count(geom) AS with_gps,
                count(*) FILTER (WHERE snapshot_cam_status = 'UP') AS historical_up
            FROM traffic_cameras
        """)
        row_cam = (await session.execute(stmt)).fetchone()

        stmt_state = text("""
            SELECT 
                count(*) AS total_tracked,
                count(*) FILTER (WHERE source_status = 'LIVE') AS live_count,
                count(*) FILTER (WHERE source_status = 'STALE') AS stale_count,
                count(*) FILTER (WHERE source_status = 'OFFLINE') AS offline_count,
                count(*) FILTER (WHERE last_attempt_at >= :recent_cutoff) AS attempted_recent,
                count(*) FILTER (WHERE last_success_at >= :recent_cutoff) AS success_recent,
                count(*) FILTER (WHERE validation_status = 'PLACEHOLDER_FRAME') AS placeholder_count,
                count(*) FILTER (WHERE model_status = 'INFERENCE_COMPLETED') AS model_analyzed_count,
                max(last_attempt_at) AS latest_attempt_at,
                max(last_success_at) AS latest_success_at
            FROM camera_ingestion_state
        """)
        row_state = (await session.execute(stmt_state, {"recent_cutoff": recent_cutoff})).fetchone()

        # Error reason breakdown
        stmt_errors = text("""
            SELECT last_error_code, count(*) as cnt
            FROM camera_ingestion_state
            WHERE last_error_code IS NOT NULL
            GROUP BY last_error_code
            ORDER BY cnt DESC
            LIMIT 10
        """)
        res_errors = await session.execute(stmt_errors)
        error_breakdown = {r.last_error_code: r.cnt for r in res_errors.fetchall()}

        viewed_ids, route_ids = await self.get_active_priority_camera_ids(redis)

        return {
            "status": "healthy",
            "timestamp": now.isoformat(),
            "total_registered_cameras": row_cam.total_registered if row_cam else 0,
            "geolocated_cameras": row_cam.with_gps if row_cam else 0,
            "historical_up_cameras": row_cam.historical_up if row_cam else 0,
            "tracked_in_scheduler": row_state.total_tracked if row_state else 0,
            "live_cameras": row_state.live_count if row_state else 0,
            "stale_cameras": row_state.stale_count if row_state else 0,
            "offline_cameras": row_state.offline_count if row_state else 0,
            "recent_hour_attempts": row_state.attempted_recent if row_state else 0,
            "recent_hour_successes": row_state.success_recent if row_state else 0,
            "placeholder_frames_excluded": row_state.placeholder_count if row_state else 0,
            "model_analyzed_cameras": row_state.model_analyzed_count if row_state else 0,
            "active_viewed_cameras_count": len(viewed_ids),
            "active_route_cameras_count": len(route_ids),
            "latest_attempt_at": row_state.latest_attempt_at.isoformat() if (row_state and row_state.latest_attempt_at) else None,
            "latest_success_at": row_state.latest_success_at.isoformat() if (row_state and row_state.latest_success_at) else None,
            "error_breakdown": error_breakdown,
        }


# Singleton Scheduler Instance
camera_scheduler = CameraScheduler(
    base_interval_sec=float(getattr(settings, "CAMERA_SCRAPE_INTERVAL_SEC", 60)),
    base_backoff_sec=30.0,
    max_backoff_sec=3600.0,
    lease_ttl_sec=120,
)
