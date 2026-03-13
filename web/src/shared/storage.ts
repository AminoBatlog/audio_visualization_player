import { defaultSettings, type VisualizerSettings } from './types'

const STORAGE_KEY = 'audio-ring-visualizer-settings'

export function loadSettings(): VisualizerSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw) as Partial<VisualizerSettings>
    return { ...defaultSettings, ...parsed }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: VisualizerSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent('visualizer-settings-updated', { detail: settings }))
}

export async function loadBridgeSettings(baseUrl: string): Promise<VisualizerSettings | null> {
  try {
    const response = await fetchWithTimeout(`${normalizeBridgeUrl(baseUrl)}/config`, 8000)
    if (!response.ok) return null
    const payload = (await response.json()) as { config?: Partial<VisualizerSettings> }
    if (!payload.config) return null
    const merged = { ...defaultSettings, ...payload.config }
    saveSettings(merged)
    return merged
  } catch {
    return null
  }
}

export async function saveBridgeSettings(baseUrl: string, settings: VisualizerSettings): Promise<VisualizerSettings | null> {
  try {
    const response = await fetchWithTimeout(`${normalizeBridgeUrl(baseUrl)}/config`, 8000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { config?: Partial<VisualizerSettings> }
    if (!payload.config) return null
    return { ...defaultSettings, ...payload.config }
  } catch {
    return null
  }
}

export function subscribeSettings(listener: (settings: VisualizerSettings) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key) listener(loadSettings())
  }
  const onCustom = (event: Event) => {
    const custom = event as CustomEvent<VisualizerSettings>
    listener(custom.detail ?? loadSettings())
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener('visualizer-settings-updated', onCustom as EventListener)

  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('visualizer-settings-updated', onCustom as EventListener)
  }
}

export function normalizeBridgeUrl(raw: string): string {
  return raw.replace(/\/$/, '')
}

export async function fetchWithTimeout(input: RequestInfo | URL, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}
