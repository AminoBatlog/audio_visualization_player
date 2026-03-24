import { type CSSProperties, type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { fetchWithTimeout, hasStoredSettings, loadBridgeSettings, loadNowPlaying, loadSettings, normalizeBridgeUrl, saveBridgeSettings, saveSettings } from '../shared/storage'
import { defaultNowPlayingState, defaultSettings, type AudioSourceType, type BridgeDevice, type BridgeHelperState, type NowPlayingState, type VisualizerSettings } from '../shared/types'

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label style={{ display: 'grid', gap: 8 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#d7ebf4' }}>
        <span>{props.label}</span>
        <span>{props.value}</span>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  )
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatBridgeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Bridge is starting or responding slowly'
  }
  return `Bridge unavailable: ${String(error)}`
}

function bridgeCandidates(rawUrl: string): string[] {
  const normalized = normalizeBridgeUrl(rawUrl)
  const candidates = [normalized]
  if (normalized.includes('127.0.0.1')) {
    candidates.push(normalized.replace('127.0.0.1', 'localhost'))
  } else if (normalized.includes('localhost')) {
    candidates.push(normalized.replace('localhost', '127.0.0.1'))
  }
  return [...new Set(candidates)]
}

function formatNowPlayingLabel(nowPlaying: NowPlayingState): string {
  if (nowPlaying.active) {
    return `${nowPlaying.title || 'Unknown Title'} - ${nowPlaying.artist || 'Unknown Artist'}`
  }
  if (nowPlaying.error) {
    return nowPlaying.error
  }
  return 'No supported music track detected'
}

const defaultHelperState: BridgeHelperState = {
  script_exists: false,
  script_path: '',
  last_error: '',
}

export function ConfigApp() {
  const [settings, setSettings] = useState<VisualizerSettings>(() => loadSettings())
  const [bridgeDevices, setBridgeDevices] = useState<BridgeDevice[]>([])
  const [bridgeStatus, setBridgeStatus] = useState('Bridge idle')
  const [bridgeDebug, setBridgeDebug] = useState('')
  const [bridgeVersion, setBridgeVersion] = useState('unknown')
  const [bridgeHelper, setBridgeHelper] = useState<BridgeHelperState>(defaultHelperState)
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState>(defaultNowPlayingState)
  const obsHint = useMemo(() => `${window.location.origin}${window.location.pathname.replace('config.html', 'obs.html')}`, [])

  const patch = async (partial: Partial<VisualizerSettings>) => {
    const next = { ...settings, ...partial }
    setSettings(next)
    saveSettings(next)
    const remote = await saveBridgeSettings(next.pythonBridgeUrl, next)
    if (remote) {
      setSettings(remote)
      saveSettings(remote)
      setBridgeStatus('Bridge config synced')
      setBridgeDebug(`config sync ok: ${normalizeBridgeUrl(next.pythonBridgeUrl)}/config`)
    } else {
      setBridgeStatus('Bridge config sync failed')
      setBridgeDebug(`config sync failed: ${normalizeBridgeUrl(next.pythonBridgeUrl)}/config`)
    }
  }

  const tryBridgeState = async (baseUrl: string) => {
    let lastError = 'unknown'
    for (const candidate of bridgeCandidates(baseUrl)) {
      try {
        const response = await fetchWithTimeout(`${candidate}/state`, 8000)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = (await response.json()) as {
          bridge_version?: string
          device_id?: string
          devices?: BridgeDevice[]
          now_playing_helper?: BridgeHelperState
        }
        return { candidate, payload }
      } catch (error) {
        lastError = `${candidate}/state -> ${formatBridgeError(error)}`
      }
    }
    throw new Error(lastError)
  }

  const refreshBridgeDevices = async (baseUrl: string) => {
    setBridgeStatus('Loading bridge devices...')
    try {
      const { candidate, payload } = await tryBridgeState(baseUrl)
      const devices = payload.devices ?? []
      setBridgeDevices(devices)
      setBridgeVersion(payload.bridge_version || 'unknown')
      setBridgeHelper(payload.now_playing_helper ?? defaultHelperState)
      setBridgeStatus(devices.length ? 'Bridge connected' : 'Bridge connected, no devices')
      setBridgeDebug(`state ok: ${candidate}/state`)
      if (normalizeBridgeUrl(settings.pythonBridgeUrl) !== candidate) {
        const next = { ...settings, pythonBridgeUrl: candidate }
        setSettings(next)
        saveSettings(next)
      }
      if (!settings.pythonBridgeDeviceId && payload.device_id) {
        const next = { ...settings, pythonBridgeUrl: candidate, pythonBridgeDeviceId: payload.device_id }
        setSettings(next)
        saveSettings(next)
      }
    } catch (error) {
      setBridgeDevices([])
      setBridgeVersion('unknown')
      setBridgeHelper(defaultHelperState)
      setBridgeStatus(formatBridgeError(error))
      setBridgeDebug(String(error))
    }
  }

  const refreshNowPlaying = async (baseUrl: string) => {
    for (const candidate of bridgeCandidates(baseUrl)) {
      const payload = await loadNowPlaying(candidate)
      if (payload) {
        setNowPlaying(payload)
        return
      }
    }
    setNowPlaying(defaultNowPlayingState)
  }

  useEffect(() => {
    const initialize = async () => {
      const local = loadSettings()
      const keepLocal = hasStoredSettings()
      setSettings(local)

      const remote = await loadBridgeSettings(local.pythonBridgeUrl)
      const next = keepLocal || !remote ? local : remote
      setSettings(next)
      saveSettings(next)

      if (!remote) {
        setBridgeStatus('Bridge config unavailable, using saved local config')
      } else if (keepLocal) {
        setBridgeStatus('Using saved local config')
      }

      await refreshBridgeDevices(next.pythonBridgeUrl)
      await refreshNowPlaying(next.pythonBridgeUrl)
    }
    void initialize()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshNowPlaying(settings.pythonBridgeUrl)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [settings.pythonBridgeUrl])

  const onImageSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await patch({ centerImageDataUrl: await fileToDataUrl(file) })
  }

  const onAudioFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await patch({ audioFileDataUrl: await fileToDataUrl(file), audioSource: 'audio-file' })
  }

  const onBridgeDeviceChange = async (deviceId: string) => {
    const next = { ...settings, pythonBridgeDeviceId: deviceId, audioSource: 'python-bridge' as AudioSourceType }
    setSettings(next)
    saveSettings(next)
    try {
      const response = await fetchWithTimeout(`${normalizeBridgeUrl(next.pythonBridgeUrl)}/device`, 8000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const remote = await saveBridgeSettings(next.pythonBridgeUrl, next)
      if (remote) {
        setSettings(remote)
        saveSettings(remote)
      }
      setBridgeStatus('Bridge device updated')
      setBridgeDebug(`device ok: ${normalizeBridgeUrl(next.pythonBridgeUrl)}/device`)
    } catch (error) {
      setBridgeStatus(`Bridge update failed: ${formatBridgeError(error)}`)
      setBridgeDebug(String(error))
    }
  }

  return (
    <div style={{ minHeight: '100vh', color: '#eef9ff', background: 'radial-gradient(circle at top, rgba(24, 80, 100, 0.55), rgba(4, 10, 16, 0.96) 55%)', padding: '28px 24px 40px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 22 }}>
        <div style={panelStyle}>
          <div style={{ fontSize: 13, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8fdcff' }}>Config</div>
          <h1 style={{ margin: '8px 0 6px', fontSize: 36 }}>Audio Ring Web Visualizer</h1>
          <p style={{ margin: 0, maxWidth: 760, color: '#bbd5e2', lineHeight: 1.6 }}>这个页面负责配置透明背景的可视化页面。后续给 OBS 使用时，建议把 `obs.html` 作为 Browser Source 入口。</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 22 }}>
          <section style={panelStyle}>
            <h2 style={sectionTitle}>Audio</h2>
            <div style={fieldGrid}>
              <label style={labelStyle}>
                Source
                <select value={settings.audioSource} onChange={(e) => void patch({ audioSource: e.target.value as AudioSourceType })} style={inputStyle}>
                  <option value="demo">Demo Signal</option>
                  <option value="microphone">Microphone</option>
                  <option value="audio-file">Audio File</option>
                  <option value="python-bridge">Python Bridge</option>
                </select>
              </label>
              <label style={labelStyle}>
                Audio File
                <input type="file" accept="audio/*" onChange={onAudioFileSelect} style={inputStyle} />
              </label>
            </div>
            <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
              <Slider label="Sensitivity" min={0.5} max={2.4} step={0.05} value={settings.sensitivity} onChange={(value) => void patch({ sensitivity: value })} />
              <Slider label="Smoothing" min={0.05} max={0.45} step={0.01} value={settings.smoothing} onChange={(value) => void patch({ smoothing: value })} />
            </div>
          </section>

          <section style={panelStyle}>
            <h2 style={sectionTitle}>OBS</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ color: '#dbeef8', fontSize: 14 }}>Recommended Browser Source URL</div>
              <code style={codeStyle}>{obsHint}</code>
              <div style={{ color: '#9db9c7', lineHeight: 1.6, fontSize: 13 }}>OBS 中的页面会优先从 Python bridge 读取共享配置，所以不依赖普通浏览器的 localStorage。</div>
              <a href="./obs.html" target="_blank" rel="noreferrer" style={buttonLinkStyle}>Open OBS Preview</a>
            </div>
            <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
              <Slider label="Title Font Size" min={0.7} max={1.6} step={0.05} value={settings.obsTitleFontScale} onChange={(value) => void patch({ obsTitleFontScale: value })} />
              <Slider label="Title Width" min={0.65} max={1.35} step={0.05} value={settings.obsTitleWidthScale} onChange={(value) => void patch({ obsTitleWidthScale: value })} />
              <Slider label="Title Hue" min={0} max={360} step={1} value={settings.obsTitleHue} onChange={(value) => void patch({ obsTitleHue: value })} />
              <Slider label="Title Lightness" min={68} max={100} step={1} value={settings.obsTitleLightness} onChange={(value) => void patch({ obsTitleLightness: value })} />
              <Slider label="Title Scroll Speed" min={0.2} max={3} step={0.05} value={settings.obsTitleScrollSpeed} onChange={(value) => void patch({ obsTitleScrollSpeed: value })} />
              <Slider label="Title Stroke Width" min={0.5} max={2.5} step={0.05} value={settings.obsTitleStrokeWidth} onChange={(value) => void patch({ obsTitleStrokeWidth: value })} />
              <label style={{ ...labelStyle, gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
                <span>Bottom Lyrics</span>
                <input type="checkbox" checked={settings.obsLyricsEnabled} onChange={(event) => void patch({ obsLyricsEnabled: event.target.checked })} style={{ width: 18, height: 18 }} />
              </label>
              <Slider label="Lyrics Bottom" min={0.04} max={0.16} step={0.005} value={settings.obsLyricsBottomOffset} onChange={(value) => void patch({ obsLyricsBottomOffset: value })} />
              <Slider label="Lyrics Width" min={0.7} max={1.2} step={0.05} value={settings.obsLyricsWidthScale} onChange={(value) => void patch({ obsLyricsWidthScale: value })} />
              <Slider label="Lyrics Current Size" min={0.7} max={1.6} step={0.05} value={settings.obsLyricsCurrentFontScale} onChange={(value) => void patch({ obsLyricsCurrentFontScale: value })} />
              <Slider label="Lyrics Next Size" min={0.5} max={1.2} step={0.05} value={settings.obsLyricsNextFontScale} onChange={(value) => void patch({ obsLyricsNextFontScale: value })} />
              <Slider label="Lyrics Hue" min={0} max={360} step={1} value={settings.obsLyricsHue} onChange={(value) => void patch({ obsLyricsHue: value })} />
              <Slider label="Lyrics Lightness" min={68} max={100} step={1} value={settings.obsLyricsLightness} onChange={(value) => void patch({ obsLyricsLightness: value })} />
              <Slider label="Lyrics Stroke" min={0.5} max={2.5} step={0.05} value={settings.obsLyricsStrokeWidth} onChange={(value) => void patch({ obsLyricsStrokeWidth: value })} />
            </div>
          </section>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          <section style={panelStyle}>
            <h2 style={sectionTitle}>Python Bridge</h2>
            <div style={fieldGrid}>
              <label style={labelStyle}>
                Bridge URL
                <input type="text" value={settings.pythonBridgeUrl} onChange={(event) => setSettings({ ...settings, pythonBridgeUrl: event.target.value })} onBlur={async () => { await patch({ pythonBridgeUrl: settings.pythonBridgeUrl }); await refreshBridgeDevices(settings.pythonBridgeUrl); await refreshNowPlaying(settings.pythonBridgeUrl) }} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Output Device
                <select value={settings.pythonBridgeDeviceId} onChange={(event) => void onBridgeDeviceChange(event.target.value)} style={inputStyle}>
                  <option value="">Select bridge device</option>
                  {bridgeDevices.filter((device) => device.kind === 'output' && device.available).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <div style={{ color: '#a9c6d4', fontSize: 13 }}>{bridgeStatus}</div>
              <button onClick={() => void refreshBridgeDevices(settings.pythonBridgeUrl)} style={buttonStyle}>Test Bridge</button>
            </div>
            <div style={{ marginTop: 10, color: '#7da1b2', fontSize: 12, wordBreak: 'break-all' }}>{bridgeDebug}</div>
            <div style={{ marginTop: 10, color: '#9bc7d8', fontSize: 12 }}>Bridge Version: {bridgeVersion || 'unknown (likely old bridge process)'}</div>
            <div style={{ marginTop: 4, color: '#7da1b2', fontSize: 12, wordBreak: 'break-all' }}>Helper: {bridgeHelper.script_exists ? 'script found' : 'script missing'}{bridgeHelper.last_error ? ` | ${bridgeHelper.last_error}` : ''}</div>

            <div style={{ marginTop: 18, padding: 16, borderRadius: 18, background: 'rgba(6, 20, 28, 0.36)', border: '1px solid rgba(204, 235, 247, 0.10)', display: 'grid', gap: 12 }}>
              <label style={{ ...labelStyle, gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
                <span>Auto Music Cover + Tone</span>
                <input type="checkbox" checked={settings.autoNowPlayingEnabled} onChange={(event) => void patch({ autoNowPlayingEnabled: event.target.checked })} style={{ width: 18, height: 18 }} />
              </label>
              <label style={labelStyle}>
                Player Filter
                <select value={settings.autoNowPlayingPlayerFilter} onChange={(event) => void patch({ autoNowPlayingPlayerFilter: event.target.value as VisualizerSettings['autoNowPlayingPlayerFilter'] })} style={inputStyle}>
                  <option value="qqmusic">QQ Music only</option>
                  <option value="netease">CloudMusic only</option>
                </select>
              </label>
              <div style={{ color: '#aac7d6', fontSize: 13, lineHeight: 1.6 }}>通过 Windows 系统媒体会话识别你当前选择的播放器，自动切换中心封面和主色调。当前模式不会同时检测两个播放器。</div>
              <div style={{ color: '#dff3fb', fontSize: 14 }}>{formatNowPlayingLabel(nowPlaying)}</div>
              <div style={{ color: '#7da1b2', fontSize: 12, wordBreak: 'break-all' }}>Source: {nowPlaying.sourceAppId || 'N/A'}</div>
            </div>
          </section>

          <section style={panelStyle}>
            <h2 style={sectionTitle}>Bars</h2>
            <div style={{ display: 'grid', gap: 14 }}>
              <Slider label="Bar Count" min={24} max={120} step={4} value={settings.barCount} onChange={(value) => void patch({ barCount: value })} />
              <Slider label="Radius" min={100} max={260} step={2} value={settings.radius} onChange={(value) => void patch({ radius: value })} />
              <Slider label="Bar Width" min={4} max={24} step={1} value={settings.barWidth} onChange={(value) => void patch({ barWidth: value })} />
              <Slider label="Bar Length" min={0.6} max={2.4} step={0.05} value={settings.barLength} onChange={(value) => void patch({ barLength: value })} />
              <Slider label="Glow" min={0.1} max={1.5} step={0.05} value={settings.glowIntensity} onChange={(value) => void patch({ glowIntensity: value })} />
              <Slider label="Ring Opacity" min={0.2} max={1} step={0.02} value={settings.ringOpacity} onChange={(value) => void patch({ ringOpacity: value })} />
              <Slider label="Accent Hue" min={160} max={230} step={1} value={settings.accentHue} onChange={(value) => void patch({ accentHue: value })} />
            </div>
          </section>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          <section style={panelStyle}>
            <h2 style={sectionTitle}>Center Image</h2>
            <div style={fieldGrid}>
              <label style={labelStyle}>
                Image
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageSelect} style={inputStyle} />
              </label>
              <label style={{ ...labelStyle, justifyContent: 'end' }}>
                <span>Audio Reactive Rotation</span>
                <input type="checkbox" checked={settings.audioReactiveRotation} onChange={(event) => void patch({ audioReactiveRotation: event.target.checked })} style={{ width: 18, height: 18 }} />
              </label>
            </div>
            <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
              <Slider label="Rotation Speed" min={0} max={4} step={0.05} value={settings.rotationSpeed} onChange={(value) => void patch({ rotationSpeed: value })} />
              <Slider label="Image Scale" min={0.45} max={1.2} step={0.01} value={settings.centerImageScale} onChange={(value) => void patch({ centerImageScale: value })} />
            </div>
            <div style={{ marginTop: 18, display: 'grid', placeItems: 'center' }}>
              <div style={previewOrbStyle}>{settings.centerImageDataUrl ? <img src={settings.centerImageDataUrl} alt="Center preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</div>
            </div>
          </section>

          <section style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div>
                <h2 style={sectionTitle}>State</h2>
                <div style={{ color: '#aac7d6', fontSize: 13 }}>配置会保存到本地浏览器和 Python bridge，共享给 OBS。自动封面和自动色调属于运行时状态，不会覆盖你手动保存的默认图。</div>
              </div>
              <button onClick={() => void patch(defaultSettings)} style={buttonStyle}>Reset To Defaults</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

const panelStyle: CSSProperties = { padding: 24, borderRadius: 24, background: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))', border: '1px solid rgba(201, 237, 251, 0.12)', backdropFilter: 'blur(24px)', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.24)' }
const sectionTitle: CSSProperties = { margin: '0 0 18px', fontSize: 22 }
const fieldGrid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }
const labelStyle: CSSProperties = { display: 'grid', gap: 8, color: '#d7ebf4', fontSize: 13 }
const inputStyle: CSSProperties = { width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(204, 235, 247, 0.14)', background: 'rgba(6, 20, 28, 0.48)', color: '#eef8ff' }
const codeStyle: CSSProperties = { display: 'block', padding: '14px 16px', borderRadius: 14, background: 'rgba(6, 20, 28, 0.62)', border: '1px solid rgba(204, 235, 247, 0.12)', color: '#a6e8ff', overflowX: 'auto' }
const buttonStyle: CSSProperties = { padding: '12px 18px', borderRadius: 999, border: '1px solid rgba(201, 237, 251, 0.12)', background: 'rgba(255, 255, 255, 0.08)', color: '#eef8ff', cursor: 'pointer' }
const buttonLinkStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 'fit-content', padding: '12px 18px', borderRadius: 999, border: '1px solid rgba(201, 237, 251, 0.12)', background: 'rgba(255, 255, 255, 0.08)', color: '#eef8ff', textDecoration: 'none' }
const previewOrbStyle: CSSProperties = { width: 170, height: 170, borderRadius: '50%', overflow: 'hidden', border: '1px solid rgba(218, 244, 255, 0.22)', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25), 0 0 40px rgba(105, 228, 255, 0.18)', background: 'radial-gradient(circle, rgba(204,239,255,0.24), rgba(204,239,255,0.03))' }







