from __future__ import annotations

from dataclasses import dataclass
import math
import random
import time
from typing import Protocol
import warnings

import numpy as np

try:
    import soundcard as sc
except ImportError:
    sc = None


@dataclass(frozen=True)
class AudioDevice:
    id: str
    name: str
    kind: str
    available: bool = True
    is_default: bool = False


class AudioSource(Protocol):
    def read_levels(self, band_count: int) -> list[float]:
        ...

    def close(self) -> None:
        ...


class DemoAudioSource:
    """Generates stable pseudo music-like band levels for UI prototyping."""

    def __init__(self) -> None:
        self._phase = random.random() * math.tau
        self._started_at = time.perf_counter()

    def read_levels(self, band_count: int) -> list[float]:
        now = time.perf_counter() - self._started_at
        levels: list[float] = []
        for index in range(band_count):
            position = index / max(1, band_count - 1)
            low_wave = math.sin(now * 2.4 + position * 4.8 + self._phase)
            mid_wave = math.sin(now * 4.9 + position * 11.5)
            high_wave = math.sin(now * 8.2 + position * 18.0)
            pulse = math.sin(now * 1.7) * 0.5 + 0.5
            envelope = (1.0 - position * 0.55) * 0.65 + 0.35
            noise = random.random() * 0.12
            value = (
                (low_wave * 0.45 + 0.55) * 0.42
                + (mid_wave * 0.5 + 0.5) * 0.33
                + (high_wave * 0.5 + 0.5) * 0.15
                + pulse * 0.10
                + noise
            ) * envelope
            levels.append(max(0.0, min(1.0, value)))
        return levels

    def close(self) -> None:
        return None


class WindowsLoopbackPlaceholder:
    def __init__(self, device: AudioDevice) -> None:
        self.device = device

    def read_levels(self, band_count: int) -> list[float]:
        return [0.0] * band_count

    def close(self) -> None:
        return None


class SoundcardLoopbackSource:
    def __init__(
        self,
        device: AudioDevice,
        samplerate: int = 48000,
        blocksize: int = 1024,
    ) -> None:
        if sc is None:
            raise RuntimeError('soundcard is not installed')

        self.device = device
        self.samplerate = samplerate
        self.blocksize = blocksize
        self._microphone = sc.get_microphone(device.id, include_loopback=True)
        if self._microphone is None:
            raise RuntimeError(f'Loopback microphone not found for {device.name}')
        self._recorder = self._microphone.recorder(
            samplerate=self.samplerate,
            channels=None,
            blocksize=self.blocksize,
        )
        self._recorder.__enter__()

    def read_levels(self, band_count: int) -> list[float]:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                'ignore',
                message='data discontinuity in recording',
                category=sc.SoundcardRuntimeWarning if sc is not None else RuntimeWarning,
            )
            frames = self._recorder.record(numframes=self.blocksize)
        if frames.size == 0:
            return [0.0] * band_count

        mono = np.mean(frames, axis=1, dtype=np.float64)
        if not np.any(mono):
            return [0.0] * band_count

        window = np.hanning(len(mono))
        spectrum = np.abs(np.fft.rfft(mono * window))
        frequencies = np.fft.rfftfreq(len(mono), d=1.0 / self.samplerate)
        return _spectrum_to_bands(spectrum, frequencies, band_count)

    def close(self) -> None:
        recorder = getattr(self, '_recorder', None)
        if recorder is not None:
            recorder.__exit__(None, None, None)
            self._recorder = None


def list_output_devices() -> list[AudioDevice]:
    devices = [AudioDevice(id='demo', name='Demo Signal', kind='virtual')]
    if sc is None:
        devices.append(
            AudioDevice(
                id='soundcard-missing',
                name='Windows Output (install soundcard to enable)',
                kind='output',
                available=False,
            )
        )
        return devices

    default_speaker = sc.default_speaker()
    default_id = default_speaker.id if default_speaker is not None else None
    for speaker in sc.all_speakers():
        display_name = speaker.name
        if speaker.id == default_id:
            display_name = f'{display_name} [Default]'
        devices.append(
            AudioDevice(
                id=speaker.id,
                name=display_name,
                kind='output',
                available=True,
                is_default=speaker.id == default_id,
            )
        )
    return devices


def create_audio_source(device_id: str) -> AudioSource:
    if device_id == 'demo':
        return DemoAudioSource()

    for device in list_output_devices():
        if device.id != device_id:
            continue
        if not device.available or device.kind != 'output':
            return WindowsLoopbackPlaceholder(device)
        return SoundcardLoopbackSource(device)

    return DemoAudioSource()


def _spectrum_to_bands(
    spectrum: np.ndarray,
    frequencies: np.ndarray,
    band_count: int,
) -> list[float]:
    if band_count <= 0:
        return []

    min_freq = 30.0
    max_freq = min(16000.0, float(frequencies[-1]))
    if max_freq <= min_freq:
        return [0.0] * band_count

    edges = np.geomspace(min_freq, max_freq, band_count + 1)
    levels: list[float] = []
    for start, end in zip(edges[:-1], edges[1:]):
        mask = (frequencies >= start) & (frequencies < end)
        if not np.any(mask):
            levels.append(0.0)
            continue
        band_energy = float(np.mean(spectrum[mask]))
        scaled = np.log1p(band_energy * 30.0) / np.log1p(30.0)
        levels.append(max(0.0, min(1.0, scaled)))
    return levels
