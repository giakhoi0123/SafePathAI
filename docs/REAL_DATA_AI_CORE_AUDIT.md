# SAFEPATHAI — REAL DATA, HYDROLOGY & AI CORE AUDIT

**Author:** Principal AI Engineer, Computer Vision Researcher, Senior Backend Architect  
**Project:** SafePathAI (Phase P0: Real-Time Hydrology, Flood AI Training & Complete Camera Ingestion)  
**Date:** October 2026  
**Status:** Audit Completed · Fixes Specified · Zero-Mock Enforced

---

## 1. Executive Summary

A comprehensive pre-check and audit of SafePathAI was performed across the local repository. The system currently features active microservices (PostGIS, Redis, OSRM, FastAPI, Next.js), but several structural gaps and reliability defects were identified in real data ingestion, hydrological grounding, computer vision weights, and camera snapshot storage.

This document details the audit findings and establishes the technical blueprint for Phase P0.

---

## 2. Core Architectural Audit Table

| Component | Existing Implementation | Defect / Gap | Root Cause | Proposed Fix | Verification Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hydrology & Tides** (`weather_tide.py`, DB schema) | Open-Meteo provides hourly rain data; tide reading only queries Redis key `env:tide:verified_bulletin`. If key absent, returns `UNAVAILABLE`. No DB table for historical hydrology. | No automated ingestion from official hydrographic bulletins / telemetry for Phú An & Nhà Bè stations. No PostgreSQL persistence. | Historical focus was purely on weather forecasting without a dedicated hydrology ingestion daemon or table schema. | 1. Create `hydrology_observations` table in PostgreSQL.<br>2. Build `HydrologySourceAdapter` and `HydrologyIngestionService` supporting stations Phú An & Nhà Bè.<br>3. Ingest real water levels (m, datum Hòn Dấu), alarm levels (I: 1.40m, II: 1.50m, III: 1.60m).<br>4. Implement quality states: `OBSERVED_LIVE`, `OBSERVED_STALE`, `FORECAST`, `UNAVAILABLE`.<br>5. Expose `/api/v1/hydrology/stations`, `/latest`, `/history`. | Unit & integration tests in `test_hydrology_ingestion.py`. Validate datum, alarm thresholds, station coordinates, and fallback states. |
| **Flood Segmentation AI** (`vision.py`, `model_manifest.json`) | `FloodSegmenter` class exists in `vision.py` checking `model_manifest.json`. `model_manifest.json` has `flood_segmenter` marked `MODEL_UNAVAILABLE` with empty SHA-256 and no weights on disk. | Real flood segmentation inference is completely disabled; falls back to `MODEL_UNAVAILABLE`. No training/export scripts in repo. | Model was planned but never trained/exported into ONNX, leaving `data/models/flood_unet.onnx` missing and manifest unverified. | 1. Implement complete ML pipeline in `scripts/ml/` (`prepare_flood_dataset.py`, `train_flood_model.py`, `evaluate_flood_model.py`, `export_flood_onnx.py`, `benchmark_flood_inference.py`).<br>2. Train and export validated ONNX model `data/models/flood_unet.onnx` (Input: `[1, 3, 256, 256]`, Output: `[1, 1, 256, 256]`).<br>3. Compute real SHA-256, file size, benchmark metrics (IoU >= 0.70, F1 >= 0.80), update manifest with `VALIDATED_HCMC_ROAD_FLOOD`.<br>4. Wire `FloodSegmenter` to run real inference, road ROI masking, and water ratio calculation. | Test suite `test_flood_segmentation.py`. Verify input/output dimensions, SHA-256 integrity, water mask generation, and latency <= 50ms. |
| **Camera Ingestion Storage** (`scraper.py`) | Writes JPEG snapshots to disk at `data/camera_snapshots/{cam_id}.jpg`. Eviction function `evict_stale_disk_images` purges files with `getmtime` older than 24h. | 1. Non-atomic file write (`with open(...) as f: f.write(...)`) creates race conditions and corrupted files if read while writing.<br>2. `evict_stale_disk_images` deletes the file even if it is the *only* valid Last Known Good image for an offline/stale camera. | Direct I/O without temporary swap files. Eviction logic does not check camera registry or database status. | 1. Implement atomic file writes: write to `.tmp` file, `flush`, `os.fsync`, and atomic rename via `os.replace`.<br>2. Update eviction policy to *never* evict the active snapshot of any registered camera (only unlinked/orphaned snapshots).<br>3. Support 4 exact timestamps (`last_attempt_at`, `last_success_at`, `last_retrieved_at`, `last_captured_at`). | Test atomic replacement under concurrent read, ensure last known good is never deleted, test validator rejection of placeholders. |
| **Camera Scheduler & Queue** (`camera_scheduler.py`) | 4-tier prioritization logic (Tier 0 Viewed, Tier 1 Route, Tier 2 Stale, Tier 3 Round-Robin). | Redis set `active_viewed_cameras` accumulated old camera IDs permanently because Redis SET lacks per-element TTL, creating zombie Tier 0 cameras that starve others. | Use of dual Redis structures (SET and ZSET) where SET members never expired, causing test assertions and starvation. | 1. Use Redis ZSET as authoritative source of truth with score = epoch expiration timestamp.<br>2. Prune expired entries via `zremrangebyscore` and mirror only active members to SET.<br>3. Enforce exponential backoff with jitter on consecutive failures.<br>4. Fair round-robin across all 796 cameras in PostgreSQL. | Test `test_camera_60s_refresh_and_validator.py` and `test_camera_ingestion_complete.py`. Verify full 796 camera coverage without starvation. |
| **Route Corridor Prioritization** (`routing.py`, PostGIS) | PostGIS corridor spatial query exists in `_get_cameras_for_step`. | Corridor cameras were not consistently registered into Redis `active_route_cameras_zset` with TTL during route planning. Routing risk did not restrict AI inference strictly to corridor cameras. | Decoupling between route calculation engine and camera scheduler priority queues. | 1. In `routing.py`, when route is calculated, extract route buffer corridor (100m) using PostGIS `ST_DWithin`.<br>2. Dynamically register all matched corridor camera IDs to `active_route_cameras_zset` with 900s TTL.<br>3. Compute AI risk assessments exclusively for corridor cameras. | Test `test_route_camera_corridor.py`. Verify corridor camera registration and selective AI inference. |
| **Admin Observability & Metrics** (`main.py`) | Basic `/api/v1/admin/cameras/metrics` exists. | Missing detailed breakdown of queue depth per priority tier, circuit breaker trips, placeholder rejections, average fetch latency, and station status. | Initial admin metrics endpoint was a placeholder with basic counters. | Expand `/api/v1/admin/cameras/metrics` and system health endpoints with comprehensive real-time telemetry (total, live, stale, offline, rejected placeholders, queue lengths, average latency). | Integration tests validating JSON schema, status codes, and counter accuracy. |

---

## 3. Strict Scope & Quality Principles

1. **Zero-Mock Runtime:**
   - Real stations (Phú An, Nhà Bè) with geographic coordinates and official VN-2000 Hòn Dấu vertical datum.
   - Genuine ONNX model with validated weights, deterministic SHA-256, and reproducible training pipeline.
   - Real status tagging: `OBSERVED_LIVE`, `OBSERVED_STALE`, `FORECAST`, `UNAVAILABLE`.
2. **Preservation of Existing Functionality:**
   - Google Authentication (OAuth), PostGIS, Redis, OSRM routing, and YOLO26n inference remain intact and protected.
3. **No Unapproved Git Operations:**
   - Local modifications only (`git commit` and `git push` strictly prohibited).

