import { useEffect, useMemo, useRef, useState } from 'react'
import { loadBridgeSettings, loadNowPlaying, loadSettings, normalizeBridgeUrl, subscribeSettings } from '../shared/storage'
import { defaultNowPlayingState, type AudioSourceType, type NowPlayingState, type VisualizerSettings } from '../shared/types'

interface AudioFrame {
  levels: number[]
  energy: number
  status: string
  sequence: number
  timestampMs: number
}

const DEFAULT_AUDIO: AudioFrame = {
  levels: [],
  energy: 0,
  status: 'Idle',
  sequence: 0,
  timestampMs: 0,
}

function applySmoothing(rawLevels: number[], smoothed: number[], sensitivity: number, decay: number): AudioFrame {
  const next = rawLevels.map((value, index) => {
    const target = Math.min(1, Math.max(0, value * sensitivity))
    const current = smoothed[index] ?? 0
    const factor = target > current ? 0.45 : decay
    const blended = current + (target - current) * factor
    smoothed[index] = blended
    return blended
  })
  const energy = next.reduce((sum, item) => sum + item, 0) / Math.max(1, next.length)
  return { levels: next, energy, status: energy > 0.04 ? 'active' : 'idle', sequence: 0, timestampMs: performance.now() }
}

function groupBands(freqData: Uint8Array, barCount: number): number[] {
  const result = new Array(barCount).fill(0)
  const minIndex = 2
  const maxIndex = freqData.length - 1
  for (let bar = 0; bar < barCount; bar += 1) {
    const start = Math.floor(minIndex * Math.pow(maxIndex / minIndex, bar / barCount))
    const end = Math.floor(minIndex * Math.pow(maxIndex / minIndex, (bar + 1) / barCount))
    let total = 0
    let count = 0
    for (let i = start; i < Math.max(start + 1, end); i += 1) {
      total += freqData[Math.min(maxIndex, i)]
      count += 1
    }
    result[bar] = count ? total / count / 255 : 0
  }
  return result
}

function useCenterImage(dataUrl: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!dataUrl) {
      setImage(null)
      return
    }
    const next = new Image()
    next.onload = () => setImage(next)
    next.src = dataUrl
  }, [dataUrl])
  return image
}

function resizeLevels(levels: number[], bars: number): number[] {
  if (bars <= 0) return []
  if (!levels.length) return new Array(bars).fill(0)
  if (levels.length === bars) return [...levels]
  const maxIndex = Math.max(1, levels.length - 1)
  const out: number[] = []
  for (let index = 0; index < bars; index += 1) {
    const position = index * maxIndex / Math.max(1, bars - 1)
    const left = Math.floor(position)
    const right = Math.min(maxIndex, left + 1)
    const mix = position - left
    out.push(levels[left] * (1 - mix) + levels[right] * mix)
  }
  return out
}

function bridgeWebSocketUrl(httpUrl: string): string {
  const url = new URL(normalizeBridgeUrl(httpUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const port = Number(url.port || (url.protocol === 'wss:' ? '443' : '80'))
  url.port = String(port + 1)
  url.pathname = '/'
  url.search = ''
  return url.toString()
}

function detectObsMode(): boolean {
  const path = window.location.pathname.toLowerCase()
  const params = new URLSearchParams(window.location.search)
  return path.endsWith('/obs.html') || params.get('mode') === 'obs'
}

function getEffectiveSettings(settings: VisualizerSettings, nowPlaying: NowPlayingState): VisualizerSettings {
  if (!settings.autoNowPlayingEnabled || !nowPlaying.active) {
    return settings
  }
  return {
    ...settings,
    centerImageDataUrl: nowPlaying.centerImageDataUrl || settings.centerImageDataUrl,
    accentHue: nowPlaying.accentHue ?? settings.accentHue,
  }
}

function renderFrame(canvas: HTMLCanvasElement, settings: VisualizerSettings, frame: AudioFrame, image: HTMLImageElement | null, rotationRef: { current: number }) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width * dpr))
  const height = Math.max(1, Math.floor(rect.height * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.scale(dpr, dpr)

  const viewWidth = rect.width
  const viewHeight = rect.height
  const cx = viewWidth / 2
  const cy = viewHeight / 2
  const baseRadius = settings.radius
  const levels = frame.levels.length ? frame.levels : new Array(settings.barCount).fill(0)
  const energy = frame.energy
  const activeRotation = settings.audioReactiveRotation ? settings.rotationSpeed * (0.35 + energy * 1.8) : settings.rotationSpeed
  rotationRef.current += activeRotation * 0.012

  const glow = 88 + settings.glowIntensity * 132
  const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius + 240)
  radial.addColorStop(0, `hsla(${settings.accentHue}, 92%, 48%, ${0.12 + energy * 0.16})`)
  radial.addColorStop(0.3, `hsla(${settings.accentHue + 12}, 95%, 30%, ${0.11 * settings.ringOpacity})`)
  radial.addColorStop(0.55, `hsla(${settings.accentHue + 24}, 92%, 18%, ${0.07 * settings.ringOpacity})`)
  radial.addColorStop(1, 'hsla(200, 100%, 50%, 0)')
  ctx.fillStyle = radial
  ctx.fillRect(0, 0, viewWidth, viewHeight)

  levels.forEach((level, index) => {
    const angle = (Math.PI * 2 * index) / levels.length - Math.PI / 2
    const length = 14 + level * 130 * settings.barLength
    const inner = baseRadius + 10
    const outer = inner + length
    const lineWidth = Math.max(2, settings.barWidth * (0.55 + level * 0.75))
    const x1 = cx + Math.cos(angle) * inner
    const y1 = cy + Math.sin(angle) * inner
    const x2 = cx + Math.cos(angle) * outer
    const y2 = cy + Math.sin(angle) * outer
    const hue = settings.accentHue + index * 0.7
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2)
    gradient.addColorStop(0, `hsla(${hue}, 88%, 52%, ${0.18 * settings.ringOpacity})`)
    gradient.addColorStop(0.35, `hsla(${hue + 10}, 92%, 46%, ${0.36 * settings.ringOpacity})`)
    gradient.addColorStop(1, `hsla(${hue + 18}, 100%, 68%, ${0.92 * settings.ringOpacity})`)

    ctx.save()
    ctx.strokeStyle = gradient
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.shadowBlur = glow * (0.55 + level)
    ctx.shadowColor = `hsla(${hue + 8}, 100%, 64%, ${0.55 + level * 0.32})`
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.strokeStyle = `hsla(${hue + 16}, 100%, 90%, ${0.3 + level * 0.5})`
    ctx.lineWidth = Math.max(1, lineWidth * 0.28)
    ctx.shadowBlur = 0
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * (inner + length * 0.22), cy + Math.sin(angle) * (inner + length * 0.22))
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.restore()
  })

  ctx.save()
  ctx.translate(cx, cy)
  const ring = ctx.createRadialGradient(0, 0, baseRadius * 0.3, 0, 0, baseRadius + 24)
  ring.addColorStop(0, 'hsla(0, 0%, 100%, 0.08)')
  ring.addColorStop(0.5, `hsla(${settings.accentHue}, 90%, 68%, 0.08)`)
  ring.addColorStop(1, 'hsla(0, 0%, 100%, 0.14)')
  ctx.fillStyle = ring
  ctx.beginPath()
  ctx.arc(0, 0, baseRadius + 18, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(0, 0, baseRadius - 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const centerSize = baseRadius * settings.centerImageScale * 1.28
  ctx.save()
  ctx.translate(cx, cy + centerSize * 0.46)
  ctx.scale(1, 0.34)
  const shadow = ctx.createRadialGradient(0, 0, centerSize * 0.08, 0, 0, centerSize * 0.56)
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.34)')
  shadow.addColorStop(0.6, `hsla(${settings.accentHue}, 100%, 10%, 0.16)`)
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.arc(0, 0, centerSize * 0.58, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  if (image) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rotationRef.current)
    ctx.beginPath()
    ctx.arc(0, 0, centerSize / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(image, -centerSize / 2, -centerSize / 2, centerSize, centerSize)
    ctx.restore()
    ctx.save()
    ctx.translate(cx, cy)
    ctx.strokeStyle = `hsla(${settings.accentHue + 12}, 100%, 92%, 0.42)`
    ctx.lineWidth = 2
    ctx.shadowBlur = 38
    ctx.shadowColor = `hsla(${settings.accentHue + 20}, 100%, 60%, 0.32)`
    ctx.beginPath()
    ctx.arc(0, 0, centerSize / 2 + 8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  } else {
    ctx.save()
    ctx.translate(cx, cy)
    const orb = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRadius * 0.48)
    orb.addColorStop(0, `hsla(${settings.accentHue}, 100%, 82%, 0.32)`)
    orb.addColorStop(0.4, `hsla(${settings.accentHue + 10}, 92%, 44%, 0.24)`)
    orb.addColorStop(0.78, `hsla(${settings.accentHue + 24}, 90%, 18%, 0.16)`)
    orb.addColorStop(1, 'hsla(0, 0%, 100%, 0)')
    ctx.fillStyle = orb
    ctx.beginPath()
    ctx.arc(0, 0, baseRadius * 0.48, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

export function VisualizerApp() {
  const obsMode = useMemo(() => detectObsMode(), [])
  const [settings, setSettings] = useState(() => loadSettings())
  const [nowPlaying, setNowPlaying] = useState(defaultNowPlayingState)
  const [statusText, setStatusText] = useState('Loading')
  const effectiveSettings = useMemo(() => getEffectiveSettings(settings, nowPlaying), [settings, nowPlaying])
  const image = useCenterImage(effectiveSettings.centerImageDataUrl)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rotationRef = useRef(0)
  const audioFrameRef = useRef<AudioFrame>({ ...DEFAULT_AUDIO, levels: new Array(settings.barCount).fill(0) })
  const smoothedLevelsRef = useRef<number[]>(new Array(settings.barCount).fill(0))
  const settingsRef = useRef(settings)
  const effectiveSettingsRef = useRef(effectiveSettings)
  const revisionRef = useRef(settings.config_revision ?? 0)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    effectiveSettingsRef.current = effectiveSettings
  }, [effectiveSettings])

  useEffect(() => {
    const stop = subscribeSettings((next) => {
      settingsRef.current = next
      setSettings(next)
      revisionRef.current = next.config_revision ?? revisionRef.current
      smoothedLevelsRef.current = resizeLevels(smoothedLevelsRef.current, next.barCount)
      audioFrameRef.current = { ...audioFrameRef.current, levels: resizeLevels(audioFrameRef.current.levels, next.barCount) }
    })

    const sync = async () => {
      const remote = await loadBridgeSettings(settingsRef.current.pythonBridgeUrl)
      if (!remote) return
      const nextRevision = remote.config_revision ?? 0
      if (nextRevision === revisionRef.current) return
      revisionRef.current = nextRevision
      settingsRef.current = remote
      setSettings(remote)
      smoothedLevelsRef.current = resizeLevels(smoothedLevelsRef.current, remote.barCount)
      audioFrameRef.current = { ...audioFrameRef.current, levels: resizeLevels(audioFrameRef.current.levels, remote.barCount) }
    }

    void sync()
    const timer = window.setInterval(() => {
      void sync()
    }, 5000)
    return () => {
      stop()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const syncNowPlaying = async () => {
      const next = await loadNowPlaying(settingsRef.current.pythonBridgeUrl)
      setNowPlaying(next ?? defaultNowPlayingState)
    }
    void syncNowPlaying()
    const timer = window.setInterval(() => {
      void syncNowPlaying()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    let animationFrame = 0
    let timeoutId = 0
    let reconnectTimeoutId = 0
    let pollingActive = false
    let webSocket: WebSocket | null = null
    let audioContext: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null
    let audioElement: HTMLAudioElement | null = null
    let mediaStream: MediaStream | null = null

    const setFrame = (levels: number[], status: string, sequence = 0, timestampMs = Date.now()) => {
      const currentSettings = settingsRef.current
      if (smoothedLevelsRef.current.length !== currentSettings.barCount) {
        smoothedLevelsRef.current = resizeLevels(smoothedLevelsRef.current, currentSettings.barCount)
      }
      const adjusted = levels.length === currentSettings.barCount ? levels : resizeLevels(levels, currentSettings.barCount)
      const frame = applySmoothing(adjusted, smoothedLevelsRef.current, currentSettings.sensitivity, currentSettings.smoothing)
      audioFrameRef.current = { levels: frame.levels, energy: frame.energy, status, sequence, timestampMs }
    }

    const startDemo = () => {
      const startedAt = performance.now()
      const tick = () => {
        const currentSettings = settingsRef.current
        const elapsed = (performance.now() - startedAt) / 1000
        const raw = Array.from({ length: currentSettings.barCount }, (_, index) => {
          const p = index / Math.max(1, currentSettings.barCount - 1)
          const low = Math.sin(elapsed * 2.3 + p * 5.5) * 0.4 + 0.6
          const mid = Math.sin(elapsed * 4.7 + p * 11.2) * 0.3 + 0.5
          const high = Math.sin(elapsed * 7.4 + p * 16.5) * 0.18 + 0.25
          return (low * 0.5 + mid * 0.35 + high * 0.15) * (1 - p * 0.45)
        })
        setFrame(raw, 'Demo signal active')
        animationFrame = requestAnimationFrame(tick)
      }
      tick()
    }

    const stopPolling = () => {
      pollingActive = false
      window.clearTimeout(timeoutId)
    }

    const startPythonBridgeFallbackPolling = () => {
      if (pollingActive || cancelled) return
      pollingActive = true
      const poll = async () => {
        if (!pollingActive || cancelled) return
        const currentSettings = settingsRef.current
        try {
          const response = await fetch(`${normalizeBridgeUrl(currentSettings.pythonBridgeUrl)}/spectrum?bars=${currentSettings.barCount}`)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = (await response.json()) as { levels?: number[]; status?: string; sequence?: number; timestamp_ms?: number }
          setFrame(payload.levels ?? audioFrameRef.current.levels, payload.status ?? 'Python bridge polling', payload.sequence ?? audioFrameRef.current.sequence, payload.timestamp_ms ?? Date.now())
        } catch (error) {
          const faded = smoothedLevelsRef.current.map((value) => value * 0.985)
          setFrame(faded, `Bridge unavailable: ${String(error)}`)
        }
        if (pollingActive && !cancelled) {
          timeoutId = window.setTimeout(() => void poll(), 16)
        }
      }
      void poll()
    }

    const startPythonBridge = async () => {
      const currentSettings = settingsRef.current
      if (currentSettings.pythonBridgeDeviceId) {
        try {
          await fetch(`${normalizeBridgeUrl(currentSettings.pythonBridgeUrl)}/device`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: currentSettings.pythonBridgeDeviceId }),
          })
        } catch {
        }
      }

      const connect = () => {
        if (cancelled) return
        try {
          webSocket = new WebSocket(bridgeWebSocketUrl(settingsRef.current.pythonBridgeUrl))
        } catch {
          startPythonBridgeFallbackPolling()
          reconnectTimeoutId = window.setTimeout(connect, 1000)
          return
        }

        webSocket.onopen = () => {
          stopPolling()
          webSocket?.send(JSON.stringify({ bars: settingsRef.current.barCount }))
        }
        webSocket.onmessage = (event) => {
          stopPolling()
          try {
            const payload = JSON.parse(String(event.data)) as { levels?: number[]; status?: string; sequence?: number; timestamp_ms?: number }
            setFrame(payload.levels ?? audioFrameRef.current.levels, payload.status ?? 'Python bridge websocket', payload.sequence ?? audioFrameRef.current.sequence, payload.timestamp_ms ?? Date.now())
          } catch {
          }
        }
        webSocket.onerror = () => {
          startPythonBridgeFallbackPolling()
        }
        webSocket.onclose = () => {
          if (!cancelled) {
            startPythonBridgeFallbackPolling()
            reconnectTimeoutId = window.setTimeout(connect, 1000)
          }
        }
      }

      connect()
    }

    const startAnalyser = async (source: AudioSourceType) => {
      if (source === 'python-bridge') {
        await startPythonBridge()
        return
      }

      audioContext = new AudioContext()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.25

      if (source === 'microphone') {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        sourceNode = audioContext.createMediaStreamSource(mediaStream)
      } else if (source === 'audio-file' && settingsRef.current.audioFileDataUrl) {
        audioElement = new Audio(settingsRef.current.audioFileDataUrl)
        audioElement.crossOrigin = 'anonymous'
        audioElement.loop = true
        audioElement.autoplay = true
        sourceNode = audioContext.createMediaElementSource(audioElement)
        await audioElement.play().catch(() => undefined)
      } else {
        startDemo()
        return
      }

      sourceNode.connect(analyser)
      if (audioElement) analyser.connect(audioContext.destination)
      const freqData = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        if (!analyser) return
        const currentSettings = settingsRef.current
        analyser.getByteFrequencyData(freqData)
        const bars = groupBands(freqData, currentSettings.barCount)
        const label = source === 'microphone' ? 'Microphone active' : 'Audio file active'
        setFrame(bars, label)
        animationFrame = requestAnimationFrame(tick)
      }
      tick()
    }

    void startAnalyser(settings.audioSource).catch((error) => {
      audioFrameRef.current = { ...audioFrameRef.current, status: `Audio setup failed: ${String(error)}`, timestampMs: Date.now() }
    })

    return () => {
      cancelled = true
      stopPolling()
      cancelAnimationFrame(animationFrame)
      window.clearTimeout(reconnectTimeoutId)
      webSocket?.close()
      mediaStream?.getTracks().forEach((track) => track.stop())
      if (audioElement) {
        audioElement.pause()
        audioElement.src = ''
      }
      sourceNode?.disconnect()
      analyser?.disconnect()
      void audioContext?.close()
    }
  }, [settings.audioSource, settings.pythonBridgeUrl, settings.pythonBridgeDeviceId, settings.audioFileDataUrl])

  useEffect(() => {
    let animationFrame = 0
    let statusCounter = 0
    const loop = () => {
      const canvas = canvasRef.current
      if (canvas) {
        renderFrame(canvas, effectiveSettingsRef.current, audioFrameRef.current, image, rotationRef)
      }
      statusCounter += 1
      if (statusCounter >= 15) {
        statusCounter = 0
        setStatusText(audioFrameRef.current.status)
      }
      animationFrame = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(animationFrame)
  }, [image])

  const accent = useMemo(() => `hsla(${effectiveSettings.accentHue}, 95%, 74%, 0.88)`, [effectiveSettings.accentHue])
  const nowPlayingLabel = nowPlaying.active ? `${nowPlaying.title || 'Unknown Title'} - ${nowPlaying.artist || 'Unknown Artist'}` : statusText

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: 'transparent' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      {!obsMode ? <div style={{ position: 'absolute', left: 20, bottom: 18, padding: '10px 14px', color: '#dff7ff', background: 'rgba(5, 16, 24, 0.3)', border: '1px solid rgba(200, 240, 255, 0.14)', borderRadius: 16, backdropFilter: 'blur(16px)', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: accent }}>Audio Ring</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>{nowPlayingLabel}</div>
      </div> : null}
      {!obsMode ? <a href="./config.html" style={{ position: 'absolute', right: 20, bottom: 18, textDecoration: 'none', color: '#f2fbff', background: 'rgba(5, 16, 24, 0.35)', border: '1px solid rgba(200, 240, 255, 0.15)', borderRadius: 999, padding: '10px 16px', backdropFilter: 'blur(14px)' }}>
        Configure
      </a> : null}
    </div>
  )
}
