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
  audioFileDataUrl: string
  pythonBridgeUrl: string
  pythonBridgeDeviceId: string
  config_revision?: number
}

export interface BridgeDevice {
  id: string
  name: string
  kind: string
  available: boolean
  is_default: boolean
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
  audioFileDataUrl: '',
  pythonBridgeUrl: 'http://127.0.0.1:8765',
  pythonBridgeDeviceId: '',
  config_revision: 0,
}
