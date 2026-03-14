from __future__ import annotations

import argparse
from dataclasses import asdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import locale
import json
from pathlib import Path
import subprocess
import threading
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

from websockets.sync.server import serve

from src.audio import AudioDevice, create_audio_source, list_output_devices


CONFIG_PATH = Path(__file__).resolve().parent / 'bridge_visualizer_settings.json'
NOW_PLAYING_HELPER_PATH = Path(__file__).resolve().parent / 'tools' / 'windows_media_session.ps1'
BRIDGE_VERSION = '2026-03-13.music-select.1'
DEFAULT_BRIDGE_CONFIG: dict[str, Any] = {
    'audioSource': 'python-bridge',
    'sensitivity': 1.15,
    'smoothing': 0.18,
    'barCount': 72,
    'radius': 168,
    'barWidth': 10,
    'barLength': 1.2,
    'glowIntensity': 0.72,
    'rotationSpeed': 0.8,
    'audioReactiveRotation': True,
    'centerImageDataUrl': '',
    'centerImageScale': 0.92,
    'ringOpacity': 0.88,
    'accentHue': 191,
    'audioFileDataUrl': '',
    'pythonBridgeUrl': 'http://127.0.0.1:8765',
    'pythonBridgeDeviceId': '',
    'autoNowPlayingEnabled': False,
    'autoNowPlayingProvider': 'windows-media-session',
    'autoNowPlayingPlayerFilter': 'qqmusic',
    'autoNowPlayingFallbackImage': 'default-center-image',
}
DEFAULT_NOW_PLAYING_STATE: dict[str, Any] = {
    'active': False,
    'matchedPlayer': False,
    'sourceAppId': '',
    'title': '',
    'artist': '',
    'albumTitle': '',
    'centerImageDataUrl': '',
    'accentHue': None,
    'artHash': '',
    'updatedAtMs': 0,
    'error': '',
}


class SpectrumBridge:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._devices = list_output_devices()
        self._selected_device_id = self._pick_default_device_id(self._devices)
        self._source = create_audio_source(self._selected_device_id)
        self._visualizer_config = self._load_config()
        self._config_revision = int(self._visualizer_config.pop('config_revision', 0) or 0)
        if not self._visualizer_config.get('pythonBridgeDeviceId'):
            self._visualizer_config['pythonBridgeDeviceId'] = self._selected_device_id
        self._latest_levels = [0.0] * int(self._visualizer_config.get('barCount', 72))
        self._latest_energy = 0.0
        self._latest_status = 'Bridge warming up'
        self._latest_timestamp_ms = int(time.time() * 1000)
        self._latest_sequence = 0
        self._now_playing = dict(DEFAULT_NOW_PLAYING_STATE)
        self._started_at_ms = int(time.time() * 1000)
        self._running = True
        self._capture_thread = threading.Thread(target=self._capture_loop, name='audio-ring-capture', daemon=True)
        self._now_playing_thread = threading.Thread(target=self._now_playing_loop, name='audio-ring-now-playing', daemon=True)
        self._capture_thread.start()
        self._now_playing_thread.start()
        self._save_config()

    def list_devices(self) -> list[dict[str, Any]]:
        with self._lock:
            self._devices = list_output_devices()
            return [self._serialize_device(device) for device in self._devices]

    def get_state(self) -> dict[str, Any]:
        with self._lock:
            self._devices = list_output_devices()
            return {
                'bridge_version': BRIDGE_VERSION,
                'started_at_ms': self._started_at_ms,
                'device_id': self._selected_device_id,
                'device': self._serialize_device(self._get_selected_device()),
                'devices': [self._serialize_device(device) for device in self._devices],
                'now_playing': dict(self._now_playing),
                'now_playing_helper': {
                    'script_exists': NOW_PLAYING_HELPER_PATH.exists(),
                    'script_path': str(NOW_PLAYING_HELPER_PATH),
                    'last_error': str(self._now_playing.get('error', '') or ''),
                },
            }

    def get_now_playing(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._now_playing)

    def get_config(self) -> dict[str, Any]:
        with self._lock:
            config = dict(self._visualizer_config)
            config['pythonBridgeDeviceId'] = self._selected_device_id
            config['pythonBridgeUrl'] = config.get('pythonBridgeUrl') or 'http://127.0.0.1:8765'
            config['config_revision'] = self._config_revision
            config['bridge_version'] = BRIDGE_VERSION
            return config

    def update_config(self, partial: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            next_config = {**self._visualizer_config, **partial}
            next_config['pythonBridgeDeviceId'] = str(next_config.get('pythonBridgeDeviceId') or self._selected_device_id)
            next_config['pythonBridgeUrl'] = str(next_config.get('pythonBridgeUrl') or 'http://127.0.0.1:8765')
            if next_config.get('autoNowPlayingPlayerFilter') not in {'qqmusic', 'netease'}:
                next_config['autoNowPlayingPlayerFilter'] = 'qqmusic'
            next_config.pop('config_revision', None)
            self._visualizer_config = next_config
            self._config_revision += 1
            self._save_config()
            return {
                **self._visualizer_config,
                'pythonBridgeDeviceId': self._selected_device_id,
                'pythonBridgeUrl': self._visualizer_config.get('pythonBridgeUrl') or 'http://127.0.0.1:8765',
                'config_revision': self._config_revision,
            }

    def set_device(self, device_id: str) -> dict[str, Any]:
        with self._lock:
            self._devices = list_output_devices()
            target = next((device for device in self._devices if device.id == device_id), None)
            if target is None:
                raise ValueError(f'Unknown device id: {device_id}')

            self._source.close()
            self._source = create_audio_source(device_id)
            self._selected_device_id = device_id
            self._visualizer_config['pythonBridgeDeviceId'] = device_id
            self._config_revision += 1
            self._save_config()
            return self._serialize_device(target)

    def read_spectrum(self, bars: int) -> dict[str, Any]:
        with self._lock:
            levels = list(self._latest_levels)
            device = self._get_selected_device()
            if len(levels) != bars:
                levels = self._resize_levels(levels, bars)
            return {
                'levels': levels,
                'energy': self._latest_energy,
                'device_id': self._selected_device_id,
                'device': self._serialize_device(device),
                'status': self._latest_status,
                'sequence': self._latest_sequence,
                'timestamp_ms': self._latest_timestamp_ms,
            }

    def close(self) -> None:
        self._running = False
        self._capture_thread.join(timeout=1.5)
        self._now_playing_thread.join(timeout=1.5)
        with self._lock:
            self._source.close()

    @property
    def running(self) -> bool:
        return self._running

    def _capture_loop(self) -> None:
        while self._running:
            try:
                with self._lock:
                    bars = int(self._visualizer_config.get('barCount', 72))
                    source = self._source
                    device = self._get_selected_device()
                levels = source.read_levels(bars)
                energy = sum(levels) / max(1, len(levels))
                status = self._status_label(device, energy)
                now_ms = int(time.time() * 1000)
                with self._lock:
                    self._latest_levels = levels
                    self._latest_energy = energy
                    self._latest_status = status
                    self._latest_timestamp_ms = now_ms
                    self._latest_sequence += 1
            except Exception as exc:
                with self._lock:
                    self._latest_status = f'Bridge capture issue: {exc}'
                    self._latest_timestamp_ms = int(time.time() * 1000)
                time.sleep(0.05)

    def _now_playing_loop(self) -> None:
        while self._running:
            with self._lock:
                enabled = bool(self._visualizer_config.get('autoNowPlayingEnabled', False))
                player_filter = str(self._visualizer_config.get('autoNowPlayingPlayerFilter') or 'qqmusic')
                if player_filter not in {'qqmusic', 'netease'}:
                    player_filter = 'qqmusic'
            if not enabled:
                with self._lock:
                    self._now_playing = dict(DEFAULT_NOW_PLAYING_STATE)
                time.sleep(1.0)
                continue

            state = self._read_now_playing(player_filter)
            with self._lock:
                self._now_playing = state
            time.sleep(3.0)

    def _read_now_playing(self, player_filter: str) -> dict[str, Any]:
        if not NOW_PLAYING_HELPER_PATH.exists():
            return {
                **DEFAULT_NOW_PLAYING_STATE,
                'updatedAtMs': int(time.time() * 1000),
                'error': 'now playing helper script is missing',
            }
        try:
            completed = subprocess.run(
                [
                    'powershell.exe',
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    str(NOW_PLAYING_HELPER_PATH),
                    '-PlayerFilter',
                    player_filter,
                ],
                capture_output=True,
                timeout=8,
                check=False,
            )
        except FileNotFoundError:
            return {
                **DEFAULT_NOW_PLAYING_STATE,
                'updatedAtMs': int(time.time() * 1000),
                'error': 'powershell.exe was not found',
            }
        except subprocess.TimeoutExpired:
            return {
                **DEFAULT_NOW_PLAYING_STATE,
                'updatedAtMs': int(time.time() * 1000),
                'error': 'now playing helper timed out',
            }

        payload_text = _decode_subprocess_output(completed.stdout).strip()
        if not payload_text:
            return {
                **DEFAULT_NOW_PLAYING_STATE,
                'updatedAtMs': int(time.time() * 1000),
                'error': (_decode_subprocess_output(completed.stderr) or 'now playing helper returned no data').strip(),
            }
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            return {
                **DEFAULT_NOW_PLAYING_STATE,
                'updatedAtMs': int(time.time() * 1000),
                'error': f'invalid helper output: {payload_text[:120]}',
            }

        if not isinstance(payload, dict):
            return {
                **DEFAULT_NOW_PLAYING_STATE,
                'updatedAtMs': int(time.time() * 1000),
                'error': 'now playing helper returned an invalid payload',
            }

        accent_raw = payload.get('accent_hue')
        accent_hue = None
        if isinstance(accent_raw, int):
            accent_hue = accent_raw
        elif isinstance(accent_raw, float):
            accent_hue = int(accent_raw)

        return {
            **DEFAULT_NOW_PLAYING_STATE,
            'active': bool(payload.get('active', False)),
            'matchedPlayer': bool(payload.get('matched_player', False)),
            'sourceAppId': str(payload.get('source_app_id', '') or ''),
            'title': str(payload.get('title', '') or ''),
            'artist': str(payload.get('artist', '') or ''),
            'albumTitle': str(payload.get('album_title', '') or ''),
            'centerImageDataUrl': str(payload.get('art_data_url', '') or ''),
            'accentHue': accent_hue,
            'artHash': str(payload.get('art_hash', '') or ''),
            'updatedAtMs': _coerce_int(str(payload.get('updated_at_ms', int(time.time() * 1000))), minimum=0, maximum=9999999999999, fallback=int(time.time() * 1000)),
            'error': str(payload.get('error', '') or ''),
        }

    def _get_selected_device(self) -> AudioDevice | None:
        for device in self._devices:
            if device.id == self._selected_device_id:
                return device
        return None

    def _load_config(self) -> dict[str, Any]:
        if not CONFIG_PATH.exists():
            return dict(DEFAULT_BRIDGE_CONFIG)
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            return dict(DEFAULT_BRIDGE_CONFIG)
        merged = {**DEFAULT_BRIDGE_CONFIG, **data}
        if merged.get('autoNowPlayingPlayerFilter') not in {'qqmusic', 'netease'}:
            merged['autoNowPlayingPlayerFilter'] = DEFAULT_BRIDGE_CONFIG['autoNowPlayingPlayerFilter']
        return merged

    def _save_config(self) -> None:
        payload = dict(self._visualizer_config)
        payload['config_revision'] = self._config_revision
        CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')

    @staticmethod
    def _resize_levels(levels: list[float], bars: int) -> list[float]:
        if bars <= 0:
            return []
        if not levels:
            return [0.0] * bars
        if len(levels) == bars:
            return levels
        last_index = max(1, len(levels) - 1)
        resized: list[float] = []
        for index in range(bars):
            position = index * last_index / max(1, bars - 1)
            left = int(position)
            right = min(last_index, left + 1)
            mix = position - left
            resized.append(levels[left] * (1.0 - mix) + levels[right] * mix)
        return resized

    @staticmethod
    def _pick_default_device_id(devices: list[AudioDevice]) -> str:
        for device in devices:
            if device.kind == 'output' and device.is_default:
                return device.id
        for device in devices:
            if device.kind == 'output' and device.available:
                return device.id
        return 'demo'

    @staticmethod
    def _serialize_device(device: AudioDevice | None) -> dict[str, Any] | None:
        if device is None:
            return None
        return asdict(device)

    @staticmethod
    def _status_label(device: AudioDevice | None, energy: float) -> str:
        if device is None:
            return 'No device selected'
        active = 'active' if energy > 0.04 else 'idle'
        if device.kind == 'output':
            return f'{device.name} {active}'
        if device.id == 'demo':
            return 'Demo signal active'
        return f'{device.name} {active}'


class BridgeHandler(BaseHTTPRequestHandler):
    bridge: SpectrumBridge

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            self._send_json({'ok': True})
            return
        if parsed.path == '/devices':
            self._send_json({'devices': self.bridge.list_devices()})
            return
        if parsed.path == '/state':
            self._send_json(self.bridge.get_state())
            return
        if parsed.path == '/now-playing':
            self._send_json({'now_playing': self.bridge.get_now_playing()})
            return
        if parsed.path == '/config':
            self._send_json({'config': self.bridge.get_config()})
            return
        if parsed.path == '/spectrum':
            params = parse_qs(parsed.query)
            bars = _coerce_int(params.get('bars', ['72'])[0], minimum=8, maximum=256, fallback=72)
            self._send_json(self.bridge.read_spectrum(bars))
            return
        self._send_json({'error': 'Not found'}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in {'/device', '/config'}:
            self._send_json({'error': 'Not found'}, status=HTTPStatus.NOT_FOUND)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', '0') or '0'))
        try:
            payload = json.loads(body.decode('utf-8') or '{}')
        except json.JSONDecodeError:
            self._send_json({'error': 'Invalid JSON'}, status=HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == '/config':
            if not isinstance(payload, dict):
                self._send_json({'error': 'Config payload must be an object'}, status=HTTPStatus.BAD_REQUEST)
                return
            config = self.bridge.update_config(payload)
            self._send_json({'ok': True, 'config': config})
            return
        device_id = str(payload.get('device_id', '')).strip()
        if not device_id:
            self._send_json({'error': 'device_id is required'}, status=HTTPStatus.BAD_REQUEST)
            return
        try:
            device = self.bridge.set_device(device_id)
        except ValueError as exc:
            self._send_json({'error': str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        except Exception as exc:
            self._send_json({'error': str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self._send_json({'ok': True, 'device': device})

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return None

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self._send_cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self) -> None:
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')


class WebSocketBridgeServer:
    def __init__(self, bridge: SpectrumBridge, host: str, port: int) -> None:
        self.bridge = bridge
        self.host = host
        self.port = port
        self._server = None
        self._thread = threading.Thread(target=self._run, name='audio-ring-ws', daemon=True)

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        if self._server is not None:
            self._server.shutdown()
        self._thread.join(timeout=1.5)

    def _run(self) -> None:
        def handler(connection) -> None:
            bars = 72
            last_sequence = -1
            while self.bridge.running:
                try:
                    try:
                        message = connection.recv(timeout=0.02)
                    except TimeoutError:
                        message = None
                    if message:
                        try:
                            payload = json.loads(message)
                            if isinstance(payload, dict):
                                bars = _coerce_int(str(payload.get('bars', bars)), minimum=8, maximum=256, fallback=bars)
                        except json.JSONDecodeError:
                            pass
                    frame = self.bridge.read_spectrum(bars)
                    if int(frame.get('sequence', -1)) != last_sequence:
                        connection.send(json.dumps(frame))
                        last_sequence = int(frame.get('sequence', -1))
                except Exception:
                    break
            try:
                connection.close()
            except Exception:
                return None

        server = serve(handler, self.host, self.port, ping_interval=20, ping_timeout=20)
        self._server = server
        server.serve_forever()


def _coerce_int(raw: str, minimum: int, maximum: int, fallback: int) -> int:
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return max(minimum, min(maximum, value))


def _decode_subprocess_output(raw: bytes | str | None) -> str:
    if raw is None:
        return ''
    if isinstance(raw, str):
        return raw
    candidates: list[str] = []
    preferred = locale.getpreferredencoding(False)
    if preferred:
        candidates.append(preferred)
    candidates.extend(['utf-8', 'gbk', 'cp936', 'utf-16'])
    seen: set[str] = set()
    for encoding in candidates:
        key = encoding.lower()
        if key in seen:
            continue
        seen.add(key)
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        except LookupError:
            continue
    return raw.decode(preferred or 'utf-8', errors='replace')


def _safe_print(message: str) -> None:
    try:
        print(message)
    except OSError:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description='Audio Ring Python bridge')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--ws-port', type=int, default=None)
    args = parser.parse_args()

    ws_port = args.ws_port if args.ws_port is not None else args.port + 1
    bridge = SpectrumBridge()
    BridgeHandler.bridge = bridge
    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    ws_server = WebSocketBridgeServer(bridge, args.host, ws_port)
    ws_server.start()
    _safe_print(f'Audio bridge listening on http://{args.host}:{args.port}')
    _safe_print(f'Audio bridge websocket on ws://{args.host}:{ws_port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        ws_server.close()
        bridge.close()


if __name__ == '__main__':
    main()




