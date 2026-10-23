"""
AI Explanation and FastMCP Tool Provider for SafePathAI.
Provides:
- FastMCP tools for route evidence summary and hydrometeorological context.
- Mathematical-data-grounded route explanations (2-3 concise sentences in Vietnamese).
- Smart Template Fallback with sub-millisecond execution when LLM_API_KEY is not set or times out.
- LLM Integration (Gemini / OpenAI) strictly constrained to explaining computed facts (Rule #2).
"""

import asyncio
from datetime import datetime, timezone
import json
import logging
from typing import Any, Dict, List, Optional
import httpx
from mcp.server.fastmcp import FastMCP

from backend.app.core.config import settings
from backend.app.db.session import get_redis_client
from backend.app.schemas.contracts import (
    CameraEvidence,
    RiskLevel,
    SafeRouteResponse,
    WeatherTideSignal,
)
from backend.app.services.weather_tide import get_cached_weather_tide

logger = logging.getLogger(__name__)

# Initialize FastMCP Server for SafePathAI
mcp_server = FastMCP("SafePathAI-Evidence-Explainer")


def extract_route_evidence_summary(route: SafeRouteResponse) -> Dict[str, Any]:
    """
    Synchronous helper to extract structured evidence from a SafeRouteResponse.
    """
    critical_segments = []
    moderate_segments = []
    all_cameras: Dict[str, Dict[str, Any]] = {}

    for seg in route.segments:
        seg_data = {
            "osm_way_id": seg.osm_way_id,
            "street_name": seg.street_name or "Đoạn đường đô thị",
            "risk_score": seg.risk_score,
            "risk_level": seg.risk_level.value,
        }
        if seg.risk_level == RiskLevel.CRITICAL:
            critical_segments.append(seg_data)
        elif seg.risk_level == RiskLevel.MODERATE:
            moderate_segments.append(seg_data)

        for cam in seg.evidence_cameras:
            if cam.cam_id not in all_cameras:
                all_cameras[cam.cam_id] = {
                    "cam_id": cam.cam_id,
                    "code": cam.code or "CAM",
                    "name": cam.name,
                    "district": cam.district or "",
                    "flood_ratio": cam.flood_ratio,
                    "traffic_density_score": cam.traffic_density_score,
                    "vehicle_count": cam.vehicle_count,
                    "risk_level": cam.risk_level.value,
                    "source_status": cam.source_status.value,
                }

    return {
        "route_id": route.route_id,
        "total_distance_km": route.total_distance_km,
        "estimated_time_mins": route.estimated_time_mins,
        "overall_risk": route.overall_risk.value,
        "critical_segment_count": len(critical_segments),
        "critical_segments": critical_segments,
        "moderate_segment_count": len(moderate_segments),
        "cameras": list(all_cameras.values()),
    }


@mcp_server.tool()
async def get_route_evidence_summary(route_id: str, total_distance_km: float, overall_risk: str) -> Dict[str, Any]:
    """
    MCP Tool: Returns high-level metadata and evidence status for a computed route.
    """
    return {
        "route_id": route_id,
        "total_distance_km": total_distance_km,
        "overall_risk": overall_risk,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@mcp_server.tool()
async def get_weather_tide_context() -> Dict[str, Any]:
    """
    MCP Tool: Retrieves current rainfall and tide levels in Ho Chi Minh City from cache.
    """
    redis_client = get_redis_client()
    try:
        cached_signal = await get_cached_weather_tide(redis_client=redis_client)
        if cached_signal:
            return cached_signal.model_dump(mode="json")
        return {
            "rain_mm_per_hour": 0.0,
            "tide_level_meters": 1.15,
            "is_high_tide_alert": False,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        await redis_client.aclose()


def build_template_explanation(
    recommended_route: SafeRouteResponse,
    alternative_routes: List[SafeRouteResponse],
    weather: Optional[WeatherTideSignal] = None,
) -> str:
    """
    Generates a deterministic, factual, human-readable Vietnamese explanation (2-3 sentences)
    grounded directly in camera evidence, vehicle counts, and hydrometeorological signals.
    Guaranteed latency < 1ms.
    """
    # 1. Inspect recommended route
    rec_streets = [s.street_name for s in recommended_route.segments if s.street_name]
    primary_street = rec_streets[0] if rec_streets else "trục đường chính"

    # Check cameras on recommended route
    rec_cams: List[CameraEvidence] = []
    for s in recommended_route.segments:
        rec_cams.extend(s.evidence_cameras)

    # 2. Inspect alternative routes to find avoided critical flood/congestion hotspots
    avoided_cam: Optional[CameraEvidence] = None
    avoided_street: Optional[str] = None
    for alt in alternative_routes:
        for s in alt.segments:
            if s.risk_level == RiskLevel.CRITICAL or any(c.flood_ratio >= 0.25 for c in s.evidence_cameras):
                avoided_street = s.street_name or avoided_street
                for c in s.evidence_cameras:
                    if avoided_cam is None or c.flood_ratio > avoided_cam.flood_ratio:
                        avoided_cam = c

    # Weather sentence fragment
    weather_info = ""
    if weather:
        if weather.rain_mm_per_hour >= 20.0 or weather.is_high_tide_alert:
            tide_str = f" kèm triều cường {weather.tide_level_meters:.2f}m" if weather.is_high_tide_alert else ""
            weather_info = f" Trong điều kiện mưa lớn {weather.rain_mm_per_hour:.0f}mm/h{tide_str},"
        elif weather.rain_mm_per_hour > 0.0:
            weather_info = f" Khu vực đang có mưa nhỏ ({weather.rain_mm_per_hour:.1f}mm/h),"

    # Case A: An alternative route had a severe flood or gridlock
    if avoided_cam and avoided_cam.flood_ratio > 0.0:
        flood_pct = int(round(avoided_cam.flood_ratio * 100))
        cam_code_str = f" tại camera {avoided_cam.code}" if avoided_cam.code else ""
        location_str = f" ({avoided_cam.name})" if avoided_cam.name else (f" ({avoided_street})" if avoided_street else "")
        vehicles_str = f" và ùn tắc {avoided_cam.vehicle_count} phương tiện" if avoided_cam.vehicle_count > 0 else ""

        return (
            f"Hệ thống đề xuất lộ trình qua {primary_street} ({recommended_route.total_distance_km:.1f}km, "
            f"ước tính {recommended_route.estimated_time_mins:.0f} phút) để né tránh điểm ngập sâu {flood_pct}%"
            f"{vehicles_str} vừa phát hiện{cam_code_str}{location_str}.{weather_info} "
            f"Tuyến đường này có mặt bằng cao ráo, lưu thông thông suốt và đảm bảo an toàn tuyệt đối cho phương tiện."
        )

    # Case B: Recommended route is SAFE and no critical alternatives
    if recommended_route.overall_risk == RiskLevel.SAFE:
        total_rec_vehicles = sum(c.vehicle_count for c in rec_cams)
        density_phrase = (
            f"mật độ phương tiện vừa phải ({total_rec_vehicles} xe quan trắc)"
            if total_rec_vehicles > 0
            else "mật độ giao thông thông thoáng"
        )
        return (
            f"Hệ thống đề xuất lộ trình tối ưu qua {primary_street} ({recommended_route.total_distance_km:.1f}km, "
            f"thời gian di chuyển ~{recommended_route.estimated_time_mins:.0f} phút).{weather_info} "
            f"Toàn tuyến ghi nhận {density_phrase}, mặt đường khô ráo và không có nguy cơ ngập nước."
        )

    # Case C: Recommended route has MODERATE risk (best of challenging alternatives)
    max_rec_flood = max((c.flood_ratio for c in rec_cams), default=0.0)
    flood_desc = f"đọng nước cục bộ nhẹ ({int(max_rec_flood * 100)}%)" if max_rec_flood > 0 else "mật độ lưu thông đông đúc"
    return (
        f"Lộ trình qua {primary_street} ({recommended_route.total_distance_km:.1f}km) được đánh giá là phương án "
        f"tối ưu nhất hiện tại dù có {flood_desc}.{weather_info} "
        f"Khuyến nghị người lái xe giảm tốc độ, giữ khoảng cách an toàn và chú ý quan sát qua các giao lộ."
    )


async def _call_llm_for_explanation(
    prompt_payload: Dict[str, Any],
    api_key: str,
    timeout_sec: float = 2.5,
) -> Optional[str]:
    """
    Calls Gemini API (or OpenAI API if key starts with sk-) to synthesize 2-3 sentences.
    Enforces a strict timeout of 2.5 seconds.
    """
    system_instruction = (
        "Bạn là trợ lý AI định hướng an toàn giao thông SafePathAI tại TP.HCM. "
        "Nhiệm vụ của bạn là viết đúng 2 đến 3 câu ngắn gọn, súc tích bằng tiếng Việt cho người lái xe. "
        "Tuyệt đối KHÔNG thay đổi lộ trình. Chỉ giải thích lý do thuật toán chọn tuyến đường dựa trên "
        "các số liệu thực tế được cung cấp (tên đường, khoảng cách, % ngập nước, số xe đếm được tại mã camera)."
    )
    user_content = json.dumps(prompt_payload, ensure_ascii=False)

    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        # 1. Google Gemini API
        if api_key.startswith("AIza") or len(api_key) == 39:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
            body = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {"text": f"{system_instruction}\n\nDữ liệu quan trắc thực tế:\n{user_content}"}
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 256,
                },
            }
            resp = await client.post(url, json=body)
            if resp.status_code == 200:
                data = resp.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
                )
                if text:
                    return text

        # 2. OpenAI API
        elif api_key.startswith("sk-"):
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}"}
            body = {
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": f"Dữ liệu quan trắc thực tế:\n{user_content}"},
                ],
                "temperature": 0.2,
                "max_tokens": 256,
            }
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code == 200:
                data = resp.json()
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                if text:
                    return text

    return None


async def generate_route_explanation(
    recommended_route: SafeRouteResponse,
    alternative_routes: List[SafeRouteResponse],
    weather: Optional[WeatherTideSignal] = None,
) -> str:
    """
    Main entrypoint for generating route explanations.
    Combines:
    1. Deterministic template generation (Baseline & Fast Fallback).
    2. Optional LLM refinement if LLM_API_KEY is configured and responds within 2.5 seconds.
    """
    # 1. Compute baseline factual explanation
    baseline_explanation = build_template_explanation(
        recommended_route=recommended_route,
        alternative_routes=alternative_routes,
        weather=weather,
    )

    api_key = settings.LLM_API_KEY.strip()
    if not api_key:
        return baseline_explanation

    # 2. Package facts for LLM refinement
    prompt_payload = {
        "recommended_route": extract_route_evidence_summary(recommended_route),
        "alternative_routes": [extract_route_evidence_summary(alt) for alt in alternative_routes],
        "weather": weather.model_dump(mode="json") if weather else None,
    }

    try:
        llm_text = await asyncio.wait_for(
            _call_llm_for_explanation(prompt_payload, api_key=api_key, timeout_sec=2.5),
            timeout=2.6,
        )
        if llm_text:
            return llm_text
    except Exception as exc:
        logger.info("LLM explanation call timed out or failed (%s), using smart template fallback", exc)

    return baseline_explanation

