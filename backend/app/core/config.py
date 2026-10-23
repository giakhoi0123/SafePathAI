"""
Application Configuration Module using Pydantic Settings.
Single Source of Truth for environment configurations and runtime parameters.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Core application settings loaded from environment variables or .env file.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database Configuration (PostgreSQL with PostGIS)
    DATABASE_URL: str = (
        "postgresql+asyncpg://safepath_user:safepath_password@localhost:5432/safepath_db"
    )

    # Redis Configuration (Streams and Real-time State Cache)
    REDIS_URL: str = "redis://localhost:6379/0"

    # Routing Engine (OSRM Backend)
    OSRM_BASE_URL: str = "http://localhost:5000"
    OSRM_GRAPH_VERSION: str = ""

    # Weather & Meteorological Service
    OPEN_METEO_URL: str = "https://api.open-meteo.com/v1/forecast"

    # HCMC VDMS Traffic Portal & Camera Scraper Settings
    HCMC_CAMERA_BASE_URL: str = (
        "https://giaothong.hochiminhcity.gov.vn:8007/Render/CameraHandler.ashx"
    )
    HCMC_CAMERA_REFERER: str = "https://giaothong.hochiminhcity.gov.vn/"
    HCMC_CAMERA_COOKIE: str = ""

    # Camera Ingestion Permissions & Security Settings
    # Default False: requires explicit authorization to scrape/ingest external cameras
    CAMERA_INGESTION_PERMITTED: bool = False

    # Granular Provider Capability Configuration
    # Allows viewing permitted/public snapshots without elevating them to routing evidence
    CAMERA_ALLOW_VIEW_ONLY: bool = True
    # Only allow altering route risk scores if explicit verified permission and calibration exist
    CAMERA_ROUTING_EVIDENCE_PERMITTED: bool = False
    # Freshness threshold: snapshots older than 180s (3m) are classified as STALE, never LIVE
    CAMERA_IMAGE_TTL_SECONDS: int = 180
    # Storage retention threshold: clean up cached frames older than 24h
    CAMERA_DISK_EVICTION_MAX_HOURS: int = 24

    CAMERA_REQUEST_TIMEOUT_SEC: float = 6.0
    CAMERA_MAX_CONCURRENCY: int = 4
    CAMERA_SCRAPE_INTERVAL_SEC: int = 60

    # Deprecated fallback flag kept False for strict Zero-Mock compliance
    USE_MOCK_CAMERA_FALLBACK: bool = False

    # Image Enhancement & Super-Resolution Pipeline Settings
    ENABLE_IMAGE_ENHANCEMENT: bool = True
    ENABLE_SUPER_RESOLUTION: bool = False
    IMAGE_ENHANCEMENT_MODE: str = "classic"  # "classic" or "classic+sr"
    LOW_LIGHT_GAMMA: float = 1.4
    CLAHE_CLIP_LIMIT: float = 2.0
    CLAHE_TILE_GRID_SIZE: int = 8
    DENOISE_H: float = 3.0
    UNSHARP_STRENGTH: float = 0.45

    # Large Language Model API Key (Gemini / OpenAI)
    LLM_API_KEY: str = ""

    # CORS Allowed Origins (Restricted list)
    CORS_ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3100",
        "http://127.0.0.1:3100",
        "http://localhost:3102",
        "http://127.0.0.1:3102",
    ]

    @property
    def sync_database_url(self) -> str:
        """
        Derives a synchronous connection URL for synchronous drivers (psycopg2).
        Useful for synchronous database operations, testing, or migrations.
        """
        url = self.DATABASE_URL
        if url.startswith("postgresql+asyncpg://"):
            return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        return url


# Global settings singleton
settings = Settings()
