export type AudioSourceType = 'demo' | 'microphone' | 'audio-file' | 'python-bridge'

export interface VisualizerSettings {
  audioSource: AudioSourceType
  sensitivity: number
  smoothing: number
  barCount: number
  radius: number
  barWidth: number
  barLength: number
  glowIntensity: number
  rotationSpeed: number
  audioReactiveRotation: boolean
  centerImageDataUrl: string
  centerImageScale: number
  ringOpacity: number
  accentHue: number
  obsTitleFontScale: number
  obsTitleWidthScale: number
  obsTitleHue: number
  obsTitleLightness: number
  obsTitleScrollSpeed: number
  obsTitleStrokeWidth: number
  obsLyricsEnabled: boolean
  obsLyricsBottomOffset: number
  obsLyricsWidthScale: number
  obsLyricsCurrentFontScale: number
  obsLyricsNextFontScale: number
  obsLyricsHue: number
  obsLyricsLightness: number
  obsLyricsStrokeWidth: number
  audioFileDataUrl: string
  pythonBridgeUrl: string
  pythonBridgeDeviceId: string
  autoNowPlayingEnabled: boolean
  autoNowPlayingProvider: 'windows-media-session'
  autoNowPlayingPlayerFilter: 'qqmusic' | 'netease'
  autoNowPlayingFallbackImage: 'default-center-image'
  bridge_version?: string
  config_revision?: number
}

export interface BridgeDevice {
  id: string
  name: string
  kind: string
  available: boolean
  is_default: boolean
}

export interface NowPlayingState {
  active: boolean
  matchedPlayer: boolean
  sourceAppId: string
  title: string
  artist: string
  albumTitle: string
  centerImageDataUrl: string
  accentHue: number | null
  artHash: string
  trackKey: string
  positionMs: number
  durationMs: number
  playbackState: string
  timelineUpdatedAtMs: number
  updatedAtMs: number
  error: string
}

export interface LyricsLine {
  startMs: number
  endMs: number
  text: string
}

export interface LyricsState {
  trackKey: string
  source: 'qqmusic'
  status: 'ok' | 'not_found' | 'unsupported' | 'unavailable'
  format: 'lrc' | 'qrc' | ''
  lines: LyricsLine[]
  error: string
}

export interface BridgeHelperState {
  script_exists: boolean
  script_path: string
  last_error: string
}

export const defaultSettings: VisualizerSettings = {
  audioSource: 'demo',
  sensitivity: 1.15,
  smoothing: 0.18,
  barCount: 72,
  radius: 168,
  barWidth: 10,
  barLength: 1.2,
  glowIntensity: 0.72,
  rotationSpeed: 0.8,
  audioReactiveRotation: true,
  centerImageDataUrl: '',
  centerImageScale: 0.92,
  ringOpacity: 0.88,
  accentHue: 191,
  obsTitleFontScale: 1,
  obsTitleWidthScale: 1,
  obsTitleHue: 210,
  obsTitleLightness: 98,
  obsTitleScrollSpeed: 1,
  obsTitleStrokeWidth: 1,
  obsLyricsEnabled: true,
  obsLyricsBottomOffset: 0.08,
  obsLyricsWidthScale: 1,
  obsLyricsCurrentFontScale: 1,
  obsLyricsNextFontScale: 0.74,
  obsLyricsHue: 210,
  obsLyricsLightness: 98,
  obsLyricsStrokeWidth: 1.05,
  audioFileDataUrl: '',
  pythonBridgeUrl: 'http://127.0.0.1:8765',
  pythonBridgeDeviceId: '',
  autoNowPlayingEnabled: false,
  autoNowPlayingProvider: 'windows-media-session',
  autoNowPlayingPlayerFilter: 'qqmusic',
  autoNowPlayingFallbackImage: 'default-center-image',
  bridge_version: '',
  config_revision: 0,
}

export const defaultNowPlayingState: NowPlayingState = {
  active: false,
  matchedPlayer: false,
  sourceAppId: '',
  title: '',
  artist: '',
  albumTitle: '',
  centerImageDataUrl: '',
  accentHue: null,
  artHash: '',
  trackKey: '',
  positionMs: 0,
  durationMs: 0,
  playbackState: '',
  timelineUpdatedAtMs: 0,
  updatedAtMs: 0,
  error: '',
}

export const defaultLyricsState: LyricsState = {
  trackKey: '',
  source: 'qqmusic',
  status: 'unsupported',
  format: '',
  lines: [],
  error: '',
}
