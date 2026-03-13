from __future__ import annotations


class LevelSmoother:
    def __init__(self, band_count: int, rise: float = 0.55, decay: float = 0.18) -> None:
        self._levels = [0.0] * band_count
        self.rise = rise
        self.decay = decay

    def resize(self, band_count: int) -> None:
        current = len(self._levels)
        if current == band_count:
            return
        if current < band_count:
            self._levels.extend([0.0] * (band_count - current))
            return
        self._levels = self._levels[:band_count]

    def update(self, raw_levels: list[float], sensitivity: float) -> list[float]:
        self.resize(len(raw_levels))
        output: list[float] = []
        for index, raw in enumerate(raw_levels):
            target = max(0.0, min(1.0, raw * sensitivity))
            current = self._levels[index]
            speed = self.rise if target >= current else self.decay
            current += (target - current) * speed
            self._levels[index] = current
            output.append(current)
        return output
