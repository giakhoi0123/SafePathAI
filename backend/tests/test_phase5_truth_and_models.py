"""Phase 5 fail-closed contracts for missing observations and model migration."""
import json
from pathlib import Path

import numpy as np
import pytest

from backend.app.services import mcp_explanation, vision, weather_tide
from backend.app.services.vision import VehicleDetector, decode_yolo26_output


@pytest.mark.asyncio
async def test_empty_weather_cache_has_no_measurement_or_fabricated_timestamp(monkeypatch):
    class RedisStub:
        async def aclose(self):
            pass

    async def no_signal(redis_client):
        return None

    monkeypatch.setattr(mcp_explanation, "get_redis_client", RedisStub)
    monkeypatch.setattr(mcp_explanation, "get_cached_weather_tide", no_signal)
    context = await mcp_explanation.get_weather_tide_context()
    assert context["rain_mm_per_hour"] is None
    assert context["tide_level_meters"] is None
    assert context["is_high_tide_alert"] is None
    assert context["timestamp"] is None
    assert context["rain_status"] == "WEATHER_UNAVAILABLE"
    assert context["tide_status"] == "TIDE_UNAVAILABLE"


@pytest.mark.asyncio
async def test_missing_both_sources_has_no_observation_timestamp(monkeypatch):
    async def no_rain(**kwargs):
        return None, "WEATHER_UNAVAILABLE", None, None

    async def no_tide(**kwargs):
        from backend.app.schemas.contracts import WeatherTideSignal
        return WeatherTideSignal(tide_status="TIDE_UNAVAILABLE", tide_level_meters=None)

    monkeypatch.setattr(weather_tide, "fetch_hcm_weather", no_rain)
    monkeypatch.setattr(weather_tide, "fetch_tide_signal", no_tide)
    result = await weather_tide.get_combined_weather_tide()
    assert result.timestamp is None
    assert result.source_url is None
    assert result.rain_mm_per_hour is None
    assert result.tide_level_meters is None


def test_modified_manifest_hash_blocks_onnx_session(monkeypatch, tmp_path):
    manifest = json.loads(Path(vision.DEFAULT_MANIFEST_PATH).read_text())
    manifest["models"]["vehicle_detector"]["sha256"] = "0" * 64
    path = tmp_path / "model_manifest.json"
    path.write_text(json.dumps(manifest))
    monkeypatch.setattr(vision, "DEFAULT_MANIFEST_PATH", str(path))
    detector = VehicleDetector(vision.DEFAULT_YOLO_PATH, fallback_to_heuristic=False)
    assert detector.session is None
    assert detector.model_status == "MODEL_UNAVAILABLE"


def test_yolo26_heads_have_distinct_decoders():
    nms_free = np.zeros((1, 300, 6), dtype=np.float32)
    nms_free[0, 0] = [10, 20, 30, 40, .9, 3]
    boxes, scores, classes, needs_nms = decode_yolo26_output(nms_free)
    assert boxes.shape == (1, 4)
    assert boxes[0].tolist() == [10, 20, 30, 40]
    assert classes.tolist() == [3]
    assert needs_nms is False

    one_to_many = np.zeros((1, 84, 8400), dtype=np.float32)
    one_to_many[0, :4, 0] = [20, 30, 20, 20]
    one_to_many[0, 4 + 2, 0] = .8
    boxes, scores, classes, needs_nms = decode_yolo26_output(one_to_many)
    assert boxes[0].tolist() == [10, 20, 30, 40]
    assert classes.tolist() == [2]
    assert needs_nms is True

    with pytest.raises(ValueError):
        decode_yolo26_output(np.zeros((1, 25200, 85), dtype=np.float32))
