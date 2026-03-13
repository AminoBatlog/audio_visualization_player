from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path


CONFIG_PATH = Path(__file__).resolve().parent.parent / "settings.json"


@dataclass
class AppSettings:
    device_id: str = "demo"
    band_count: int = 64
    radius: int = 150
    sensitivity: float = 1.15
    smoothing: float = 0.18
    running: bool = True


def load_settings() -> AppSettings:
    if not CONFIG_PATH.exists():
        return AppSettings()

    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return AppSettings()

    defaults = AppSettings()
    return AppSettings(
        device_id=str(data.get("device_id", defaults.device_id)),
        band_count=_clamp_int(data.get("band_count", defaults.band_count), 24, 120, 64),
        radius=_clamp_int(data.get("radius", defaults.radius), 90, 230, 150),
        sensitivity=_clamp_float(data.get("sensitivity", defaults.sensitivity), 0.6, 2.2, 1.15),
        smoothing=_clamp_float(data.get("smoothing", defaults.smoothing), 0.05, 0.45, 0.18),
        running=bool(data.get("running", defaults.running)),
    )


def save_settings(settings: AppSettings) -> None:
    CONFIG_PATH.write_text(
        json.dumps(asdict(settings), ensure_ascii=True, indent=2),
        encoding="utf-8",
    )


def _clamp_int(value: object, minimum: int, maximum: int, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))


def _clamp_float(value: object, minimum: float, maximum: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))
