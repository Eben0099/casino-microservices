"""Dynamic settings for the Keno engine.

Stored in Redis at ``keno:settings`` (JSON).  Loaded fresh at the start of
every game loop cycle so admin changes take effect without a restart.
"""

import json
import logging
from typing import Any

logger = logging.getLogger("keno-settings")

REDIS_KEY = "keno:settings"

DEFAULT_SETTINGS: dict[str, Any] = {
    "idle_duration": 30.0,
    "prelaunch_duration": 2.0,
    "draw_duration": 67.0,
    "results_duration": 5.0,
    "min_stake": 100,
    "max_stake": 50000,
    "enabled": True,
    "commission_pct": 0.0,
    "default_spots": 10,
}

DURATION_BOUNDS: dict[str, tuple[float, float]] = {
    "idle_duration": (5.0, 300.0),
    "prelaunch_duration": (1.0, 30.0),
    "draw_duration": (10.0, 120.0),
    "results_duration": (1.0, 60.0),
}


def coerce_settings(raw: dict) -> dict:
    """Merge raw dict with defaults, clamp / validate values."""
    out = dict(DEFAULT_SETTINGS)
    for key, default in DEFAULT_SETTINGS.items():
        if key in raw and raw[key] is not None:
            try:
                if isinstance(default, bool):
                    out[key] = bool(raw[key])
                elif isinstance(default, float):
                    out[key] = float(raw[key])
                else:
                    out[key] = int(raw[key])
            except (TypeError, ValueError):
                continue

    for key, (lo, hi) in DURATION_BOUNDS.items():
        out[key] = max(lo, min(hi, out[key]))

    out["min_stake"] = max(1, int(out["min_stake"]))
    out["max_stake"] = max(out["min_stake"], int(out["max_stake"]))
    out["commission_pct"] = max(0.0, min(50.0, float(out["commission_pct"])))
    out["default_spots"] = max(1, min(11, int(out["default_spots"])))

    return out


async def load_settings(redis_client) -> dict:
    if not redis_client:
        return dict(DEFAULT_SETTINGS)
    try:
        raw = await redis_client.get(REDIS_KEY)
        if raw:
            return coerce_settings(json.loads(raw))
    except Exception as e:
        logger.warning(f"keno settings load failed: {e}")
    return dict(DEFAULT_SETTINGS)


async def save_settings(redis_client, patch: dict) -> dict:
    current = await load_settings(redis_client)
    current.update({k: v for k, v in patch.items() if v is not None})
    coerced = coerce_settings(current)
    if redis_client:
        await redis_client.set(REDIS_KEY, json.dumps(coerced))
    return coerced
