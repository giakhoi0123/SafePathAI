"""
Weather and Tide Data Ingestion Service for SafePathAI (Zero-Mock Runtime).
Fetches real-time hydrometeorological signals for Ho Chi Minh City:
- Open-Meteo API for real precipitation and rainfall intensity.
  If unreachable or error, returns None / WEATHER_UNAVAILABLE (NEVER returns 0.0 mm/h).
- Tidal observation for HCMC stations (Phú An / Nhà Bè) with vertical datum Hòn Dấu (VN-2000).
  In absence of a live telemetry feed, returns None / TIDE_UNAVAILABLE (NEVER fabricates sine waves).
- Caches signals in Redis with grid-based coordinate rounding and TTL matching source cadences.
"""

from datetime import datetime, timedelta, timezone
import json
import logging
from typing import Optional
import httpx
from redis.asyncio import Redis

from backend.app.core.config import settings
from backend.app.db.session import get_redis_client
from backend.app.schemas.contracts import WeatherTideSignal

logger = logging.getLogger(__name__)

# Redis cache keys
REDIS_WEATHER_TIDE_KEY = "env:current_weather_tide"
REDIS_TIDE_BULLETIN_KEY = "env:tide:verified_bulletin"
REDIS_WEATHER_GRID_PREFIX = "env:weather:"

# Standard vertical datum and alert thresholds for Ho Chi Minh City
# Datum: Mốc cao độ Quốc gia Hòn Dấu (VN-2000)
# Trạm Phú An (sông Sài Gòn) & Trạm Nhà Bè (sông Đồng Điền)
DATUM_HON_DAU_VN2000 = "Hòn Dấu (VN-2000)"
TIDE_ALARM_LEVEL_1_METERS = 1.40
TIDE_ALARM_LEVEL_2_METERS = 1.50
TIDE_ALARM_LEVEL_3_METERS = 1.60
HIGH_TIDE_ALERT_THRESHOLD_METERS = TIDE_ALARM_LEVEL_2_METERS

WEATHER_CACHE_TTL_SECONDS = 900  # 15 minutes (Open-Meteo cadence)
TIDE_BULLETIN_TTL_SECONDS = 10800  # 3 hours


async def fetch_hcm_weather(
    lat: float = 10.7769,
    lng: float = 106.7009,
    client: Optional[httpx.AsyncClient] = None,
    redis_client: Optional[Redis] = None,
) -> tuple[Optional[float], str, Optional[datetime], Optional[int]]:
    """
    Fetches real-time rainfall precipitation in mm/hour from Open-Meteo API.
    
    Returns:
        tuple of (rain_mm_per_hour, rain_status, rain_observed_at, weather_code)
    
    Zero-Mock Rule:
        If external API is unreachable or fails, returns (None, "WEATHER_UNAVAILABLE", None, None).
        NEVER defaults to 0.0 mm/h.
    """
    lat_round = round(lat, 2)
    lng_round = round(lng, 2)
    grid_cache_key = f"{REDIS_WEATHER_GRID_PREFIX}{lat_round}:{lng_round}"

    close_redis = False
    if redis_client is None:
        try:
            redis_client = get_redis_client()
            close_redis = True
        except Exception:
            redis_client = None

    # Check cache first
    if redis_client is not None:
        try:
            cached_raw = await redis_client.get(grid_cache_key)
            if cached_raw:
                data = json.loads(cached_raw)
                observed_at = None
                if data.get("rain_observed_at"):
                    observed_at = datetime.fromisoformat(data["rain_observed_at"])
                if observed_at is not None and observed_at.tzinfo is not None:
                    return (data.get("rain_mm_per_hour"), data.get("rain_status", "LIVE"), observed_at, data.get("weather_code"))
        except Exception as exc:
            logger.debug("Redis weather cache read failed: %s", exc)

    url = (
        f"{settings.OPEN_METEO_URL}?latitude={lat}&longitude={lng}"
        "&current=precipitation,rain,weather_code&timezone=Asia%2FHo_Chi_Minh"
    )

    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=6.0)
        close_client = True

    try:
        response = await client.get(url)
        if response.status_code == 200:
            data = response.json()
            current = data.get("current", {})
            rain_val = current.get("rain")
            if rain_val is None:
                rain_val = current.get("precipitation")
            
            rain_mm = float(rain_val) if rain_val is not None else None
            weather_code = current.get("weather_code")
            
            observed_at = None
            time_str = current.get("time")
            if time_str:
                try:
                    observed_at = datetime.fromisoformat(time_str)
                    if observed_at.tzinfo is None:
                        offset = data.get("utc_offset_seconds")
                        if isinstance(offset, int) and -43200 <= offset <= 50400:
                            observed_at = observed_at.replace(tzinfo=timezone(timedelta(seconds=offset)))
                        else:
                            observed_at = None
                except ValueError:
                    pass
            if observed_at is None or rain_mm is None:
                return (None, "WEATHER_UNAVAILABLE", None, weather_code)

            rain_status = "LIVE"

            # Cache the result
            if redis_client is not None and rain_mm is not None:
                try:
                    payload = json.dumps({
                        "rain_mm_per_hour": rain_mm,
                        "rain_status": rain_status,
                        "rain_observed_at": observed_at.isoformat(),
                        "weather_code": weather_code,
                    })
                    await redis_client.set(grid_cache_key, payload, ex=WEATHER_CACHE_TTL_SECONDS)
                except Exception as exc:
                    logger.debug("Redis weather cache write failed: %s", exc)

            return (rain_mm, rain_status, observed_at, weather_code)
        else:
            logger.warning("Open-Meteo API returned status %d", response.status_code)
            return (None, "WEATHER_UNAVAILABLE", None, None)
    except Exception as exc:
        logger.warning("Failed to fetch Open-Meteo weather data: %s", exc)
        return (None, "WEATHER_UNAVAILABLE", None, None)
    finally:
        if close_client:
            await client.aclose()
        if close_redis and redis_client is not None:
            await redis_client.aclose()


async def ingest_verified_tide_bulletin(
    station: str,
    level_meters: float,
    observed_at: datetime,
    source_url: str,
    datum: str = DATUM_HON_DAU_VN2000,
    redis_client: Optional[Redis] = None,
) -> WeatherTideSignal:
    """
    Ingests an authorized, verified hydrographic bulletin from official sources
    (e.g., Đài Khí tượng Thủy văn Nam Bộ / Trung tâm Dự báo KTTV Quốc gia).
    """
    is_alert = level_meters >= HIGH_TIDE_ALERT_THRESHOLD_METERS
    signal = WeatherTideSignal(
        rain_mm_per_hour=None,
        rain_status="WEATHER_UNAVAILABLE",
        tide_level_meters=round(level_meters, 2),
        tide_status="LIVE",
        tide_station=station,
        tide_datum=datum,
        is_high_tide_alert=is_alert,
        timestamp=observed_at,
        source_url=source_url,
    )

    close_redis = False
    if redis_client is None:
        redis_client = get_redis_client()
        close_redis = True

    try:
        payload = signal.model_dump_json()
        await redis_client.set(REDIS_TIDE_BULLETIN_KEY, payload, ex=TIDE_BULLETIN_TTL_SECONDS)
        logger.info("Ingested verified tide bulletin to Redis (TTL %ds): %s", TIDE_BULLETIN_TTL_SECONDS, payload)
    except Exception as exc:
        logger.warning("Failed to save verified tide bulletin to Redis: %s", exc)
    finally:
        if close_redis:
            await redis_client.aclose()

    return signal


async def fetch_tide_signal(
    now: Optional[datetime] = None,
    redis_client: Optional[Redis] = None,
) -> WeatherTideSignal:
    """
    Retrieves the current tidal observation for HCMC stations.
    
    Zero-Mock Rules:
    - Checks Redis for an active verified bulletin.
    - If no verified bulletin exists, returns tide_status="TIDE_UNAVAILABLE", tide_level_meters=None.
      NEVER generates harmonic sine waves or assumes calm tides.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    # Check for verified bulletin in Redis
    close_redis = False
    if redis_client is None:
        try:
            redis_client = get_redis_client()
            close_redis = True
        except Exception:
            redis_client = None

    if redis_client is not None:
        try:
            cached_raw = await redis_client.get(REDIS_TIDE_BULLETIN_KEY)
            if cached_raw:
                data = json.loads(cached_raw)
                return WeatherTideSignal.model_validate(data)
        except Exception as exc:
            logger.debug("Failed to read tide bulletin from Redis: %s", exc)
        finally:
            if close_redis:
                await redis_client.aclose()

    # No verified bulletin available
    return WeatherTideSignal(
        rain_mm_per_hour=None,
        rain_status="WEATHER_UNAVAILABLE",
        tide_level_meters=None,
        tide_status="TIDE_UNAVAILABLE",
        tide_station=None,
        tide_datum=DATUM_HON_DAU_VN2000,
        is_high_tide_alert=None,
        timestamp=None,
        source_url=None,
    )


async def get_combined_weather_tide(
    lat: float = 10.7769,
    lng: float = 106.7009,
    client: Optional[httpx.AsyncClient] = None,
    redis_client: Optional[Redis] = None,
) -> WeatherTideSignal:
    """
    Gathers both Open-Meteo weather precipitation and tide signal into a unified WeatherTideSignal.
    Zero-Mock: All fields reflect verified inputs; missing measurements are explicitly None.
    """
    rain_mm, rain_status, rain_observed_at, weather_code = await fetch_hcm_weather(
        lat=lat, lng=lng, client=client, redis_client=redis_client
    )
    tide_signal = await fetch_tide_signal(
        redis_client=redis_client,
    )

    return WeatherTideSignal(
        rain_mm_per_hour=rain_mm,
        rain_status=rain_status,
        rain_observed_at=rain_observed_at,
        weather_code=weather_code,
        tide_level_meters=tide_signal.tide_level_meters,
        tide_status=tide_signal.tide_status,
        tide_station=tide_signal.tide_station,
        tide_datum=tide_signal.tide_datum,
        is_high_tide_alert=tide_signal.is_high_tide_alert,
        timestamp=rain_observed_at or tide_signal.timestamp,
        source_url=settings.OPEN_METEO_URL if rain_status == "LIVE" else tide_signal.source_url,
    )


async def sync_weather_tide_to_redis(
    signal: Optional[WeatherTideSignal] = None,
    redis_client: Optional[Redis] = None,
    ttl_seconds: int = 900,
) -> WeatherTideSignal:
    """
    Saves the latest WeatherTideSignal payload into Redis with a TTL (default 900s).
    If signal is omitted, fetches the latest signal before saving.
    """
    close_redis = False
    if redis_client is None:
        redis_client = get_redis_client()
        close_redis = True

    if signal is None:
        signal = await get_combined_weather_tide(redis_client=redis_client)

    try:
        payload = signal.model_dump_json()
        await redis_client.set(REDIS_WEATHER_TIDE_KEY, payload, ex=ttl_seconds)
        logger.info("Synchronized weather-tide signal to Redis (TTL: %ds): %s", ttl_seconds, payload)
    except Exception as exc:
        logger.warning("Failed to synchronize weather-tide to Redis: %s", exc)
    finally:
        if close_redis:
            await redis_client.aclose()

    return signal


async def get_cached_weather_tide(
    redis_client: Optional[Redis] = None,
) -> Optional[WeatherTideSignal]:
    """
    Reads the cached WeatherTideSignal from Redis.
    Returns None if cache is expired or Redis is unreachable.
    """
    close_redis = False
    if redis_client is None:
        redis_client = get_redis_client()
        close_redis = True

    try:
        raw_val = await redis_client.get(REDIS_WEATHER_TIDE_KEY)
        if not raw_val:
            return None
        data = json.loads(raw_val)
        return WeatherTideSignal.model_validate(data)
    except Exception as exc:
        logger.warning("Failed to retrieve cached weather-tide from Redis: %s", exc)
        return None
    finally:
        if close_redis:
            await redis_client.aclose()
