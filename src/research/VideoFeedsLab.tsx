import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './research.css'
import {
  LIVE_HEX_DOCUMENT_CHANNEL,
  drawHexFrame,
  isHexFrameMsg,
  luminanceHexFromImageData,
  normalizeFeedKey,
  type HexFrameMsg,
} from './liveHexCodec'
import { ffmpegCdnStreamUrlForVideoId } from '../util/ffmpegStreamUrl'
import { parseYouTubeVideoId, stripYouTubePasteDecorators } from '../util/youtube'
import { applyDepthSpatialStack, applyDitherPass, type DitherPass } from './videoLabEffects'
import './video-feeds-lab.css'

export type VideoFeedsLabProps = {
  onBack: () => void
}

const CAMERA_FEED = '__camera__'
const DEFAULT_FEED = '__default__'

function ytHexFeedKey(videoId: string): string {
  return `yt:${videoId}`
}
const STAGE_PX = 480
const CAMERA_GRID = 72
const TRAIL_THUMB = 40

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

function formatMediaClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

type LabVariation = {
  id: string
  label: string
  decodeMode: string
  invert: boolean
  scanlines: boolean
  dither: DitherPass
}

/** Preset “{…}” strings + decode / CRT-ish passes + built-in dither modes (CPU). */
const VARIATIONS: LabVariation[] = [
  { id: 'clean', label: '{decode:"color",dither:"none"}', decodeMode: 'color', invert: false, scanlines: false, dither: 'none' },
  { id: 'bayer5', label: '{decode:"gray",dither:"bayer4",levels:5}', decodeMode: 'gray', invert: false, scanlines: false, dither: 'bayer4' },
  { id: 'bayer8', label: '{dither:"bayer8",scan:1}', decodeMode: 'gray', invert: false, scanlines: true, dither: 'bayer8' },
  { id: 'halftone', label: '{dither:"halftone",cell:6}', decodeMode: 'gray', invert: false, scanlines: false, dither: 'halftone' },
  { id: 'ascii', label: '{dither:"ascii",cell:7}', decodeMode: 'color', invert: false, scanlines: false, dither: 'ascii' },
  { id: 'faxCRT', label: '{decode:"fax",invert:1,scan:1}', decodeMode: 'fax', invert: true, scanlines: true, dither: 'none' },
  { id: 'signalDots', label: '{decode:"signal",dither:"halftone"}', decodeMode: 'signal', invert: false, scanlines: false, dither: 'halftone' },
  { id: 'thermalBayer', label: '{decode:"color",dither:"bayer4"}', decodeMode: 'color', invert: false, scanlines: false, dither: 'bayer4' },
]

function postProcessCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  invert: boolean,
  scanlines: boolean,
): void {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    const dimRow = scanlines && y % 2 === 1
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (invert) {
        d[i] = 255 - d[i]
        d[i + 1] = 255 - d[i + 1]
        d[i + 2] = 255 - d[i + 2]
      }
      if (dimRow) {
        d[i] = Math.floor(d[i] * 0.55)
        d[i + 1] = Math.floor(d[i + 1] * 0.55)
        d[i + 2] = Math.floor(d[i + 2] * 0.55)
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

function noiseHex(res: number, seed: number): number[] {
  const len = res * res
  const o: number[] = new Array(len)
  let s = seed >>> 0
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    o[i] = s % 256
  }
  return o
}

function effectiveFeedKey(feedOrder: string[], activeIdx: number, pinnedKey: string | null): string {
  if (feedOrder.length === 0) return DEFAULT_FEED
  const at = feedOrder[Math.max(0, Math.min(activeIdx, feedOrder.length - 1))]!
  if (pinnedKey && feedOrder.includes(pinnedKey)) return pinnedKey
  return at
}

const BUMP_MOSAIC_COLS = 4
const BUMP_MOSAIC_ROWS = 7
const TRAIL_SLOTS = BUMP_MOSAIC_COLS * BUMP_MOSAIC_ROWS

type TrailRing = { canvases: HTMLCanvasElement[]; write: number; filled: number }

function createTrailRing(): TrailRing {
  return {
    canvases: Array.from({ length: TRAIL_SLOTS }, () => {
      const c = document.createElement('canvas')
      c.width = TRAIL_THUMB
      c.height = TRAIL_THUMB
      return c
    }),
    write: 0,
    filled: 0,
  }
}

function snapSlotForTile(tileIndex: number, write: number, filled: number): number | null {
  if (tileIndex >= filled) return null
  const newest = (write - 1 + TRAIL_SLOTS) % TRAIL_SLOTS
  return (newest - tileIndex + TRAIL_SLOTS * 2) % TRAIL_SLOTS
}

const BUMP_TILE_TOPO = (() => {
  const tiles: { key: string; nx: number; ny: number; i: number; zSlot: number }[] = []
  const cx = Math.max(1, BUMP_MOSAIC_COLS - 1)
  const cy = Math.max(1, BUMP_MOSAIC_ROWS - 1)
  let i = 0
  for (let r = 0; r < BUMP_MOSAIC_ROWS; r++) {
    for (let c = 0; c < BUMP_MOSAIC_COLS; c++) {
      const nx = (c / cx) * 2 - 1
      const ny = (r / cy) * 2 - 1
      const dc = Math.hypot(c - (BUMP_MOSAIC_COLS - 1) / 2, r - (BUMP_MOSAIC_ROWS - 1) / 2)
      const zSlot = dc < 0.95 ? 2 : dc < 1.85 ? 1 : 0
      tiles.push({ key: `${r}-${c}`, nx, ny, i, zSlot })
      i++
    }
  }
  return tiles
})()

function VflBumpRail({
  trailRingRef,
  trailSeq,
}: {
  trailRingRef: RefObject<TrailRing | null>
  trailSeq: number
}) {
  const ref = useRef<HTMLElement>(null)
  const tileDisplayRefs = useRef<(HTMLCanvasElement | null)[]>([])

  useLayoutEffect(() => {
    const ring = trailRingRef.current
    const g = getComputedStyle(document.documentElement)
    const emptyFill = g.getPropertyValue('--code-bg').trim() || '#f4f4f5'
    for (const t of BUMP_TILE_TOPO) {
      const dest = tileDisplayRefs.current[t.i]
      if (!dest) continue
      const dctx = dest.getContext('2d')
      if (!dctx) continue
      const slot = ring ? snapSlotForTile(t.i, ring.write, ring.filled) : null
      if (slot == null || !ring) {
        dctx.fillStyle = emptyFill
        dctx.fillRect(0, 0, TRAIL_THUMB, TRAIL_THUMB)
      } else {
        dctx.imageSmoothingEnabled = false
        dctx.clearRect(0, 0, TRAIL_THUMB, TRAIL_THUMB)
        dctx.drawImage(ring.canvases[slot]!, 0, 0, TRAIL_THUMB, TRAIL_THUMB, 0, 0, TRAIL_THUMB, TRAIL_THUMB)
      }
    }
  }, [trailSeq, trailRingRef])

  const onMove = (e: ReactMouseEvent<HTMLElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2
    const ny = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2
    el.style.setProperty('--vfl-mx', nx.toFixed(4))
    el.style.setProperty('--vfl-my', ny.toFixed(4))
  }
  const onLeave = () => {
    ref.current?.style.setProperty('--vfl-mx', '0')
    ref.current?.style.setProperty('--vfl-my', '0')
  }
  return (
    <aside
      ref={ref}
      className="vfl-bump-rail"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      aria-label="Trailing snapshots of the rendered stage"
    >
      <div
        className="vfl-bump-mosaic"
        role="presentation"
        title="Newest snapshot first; older frames trail through the grid. Tiles react to pointer movement."
      >
        {BUMP_TILE_TOPO.map((t) => (
          <div
            key={t.key}
            className="vfl-bump-tile-outer"
            style={
              {
                '--vfl-px': t.nx,
                '--vfl-py': t.ny,
                '--vfl-bump-z': t.zSlot,
              } as CSSProperties
            }
            aria-hidden
          >
            <canvas
              ref={(el) => {
                tileDisplayRefs.current[t.i] = el
              }}
              className="vfl-bump-tile vfl-bump-tile--snap"
              width={TRAIL_THUMB}
              height={TRAIL_THUMB}
            />
          </div>
        ))}
      </div>
    </aside>
  )
}

export default function VideoFeedsLab({ onBack }: VideoFeedsLabProps) {
  const [feedOrder, setFeedOrder] = useState<string[]>([DEFAULT_FEED])
  const [activeIdx, setActiveIdx] = useState(0)
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [variationIdx, setVariationIdx] = useState(0)
  const [demoPeers, setDemoPeers] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user')
  const [cameraFeedMode, setCameraFeedMode] = useState<'gray' | 'color'>('gray')
  const [cameraErr, setCameraErr] = useState<string | null>(null)
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false)
  const cameraMenuId = useId()
  const cameraMenuTriggerId = `${cameraMenuId}-trigger`
  const trailRingRef = useRef<TrailRing | null>(null)
  const [trailSeq, setTrailSeq] = useState(0)
  const [depthZones, setDepthZones] = useState(false)
  const [ytUrlInput, setYtUrlInput] = useState('')
  const [ytFeedId, setYtFeedId] = useState<string | null>(null)
  const [ytStreamErr, setYtStreamErr] = useState<string | null>(null)

  const displayIdx =
    feedOrder.length === 0 ? 0 : Math.min(Math.max(0, activeIdx), feedOrder.length - 1)

  const framesRef = useRef<Record<string, HexFrameMsg>>({})
  const selectionRef = useRef({ feedOrder, activeIdx, pinnedKey })
  useLayoutEffect(() => {
    selectionRef.current = { feedOrder, activeIdx, pinnedKey }
  }, [feedOrder, activeIdx, pinnedKey])

  const stageRef = useRef<HTMLCanvasElement>(null)
  const offHexRef = useRef<HTMLCanvasElement | null>(null)
  const layerWorkRef = useRef<HTMLCanvasElement | null>(null)
  const cameraMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const capRef = useRef<HTMLCanvasElement>(null)
  const camRaf = useRef(0)
  const ytVideoRef = useRef<HTMLVideoElement>(null)
  const ytCapRef = useRef<HTMLCanvasElement>(null)
  const ytRafRef = useRef(0)
  const stackLightRef = useRef({ nx: 0.25, ny: -0.2 })
  const stackT0Ref = useRef(0)

  const [streamAudioOn, setStreamAudioOn] = useState(false)
  const [showWaveform, setShowWaveform] = useState(true)
  const [audioVol, setAudioVol] = useState(1)
  const [audioMuted, setAudioMuted] = useState(false)
  const [captionsOn, setCaptionsOn] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const [imageBrightness, setImageBrightness] = useState(100)
  const [imageContrast, setImageContrast] = useState(100)

  const [ytUiTime, setYtUiTime] = useState(0)
  const [ytUiDur, setYtUiDur] = useState(0)
  const [ytUiPaused, setYtUiPaused] = useState(true)
  const [ytScrubDisplay, setYtScrubDisplay] = useState<number | null>(null)
  const ytScrubbingRef = useRef(false)
  const [ytLoop, setYtLoop] = useState(false)
  const [ytRate, setYtRate] = useState(1)
  const [showYtPreview, setShowYtPreview] = useState(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioNodesRef = useRef<{
    src: MediaElementAudioSourceNode
    gain: GainNode
    analyser: AnalyserNode
  } | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  const wfRafRef = useRef(0)
  const audioSetupGenRef = useRef(0)

  const teardownAudioGraph = useCallback(() => {
    audioSetupGenRef.current++
    const n = audioNodesRef.current
    if (n) {
      try {
        n.src.disconnect()
        n.gain.disconnect()
        n.analyser.disconnect()
      } catch {
        /* already disconnected */
      }
      audioNodesRef.current = null
    }
    analyserRef.current = null
    const v = ytVideoRef.current
    if (v) {
      v.muted = true
    }
  }, [])

  const variation = VARIATIONS[variationIdx % VARIATIONS.length]!

  const redrawStage = useCallback(() => {
    const canvas = stageRef.current
    if (!canvas) return
    canvas.width = STAGE_PX
    canvas.height = STAGE_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const sel = selectionRef.current
    const idx = Math.min(Math.max(0, sel.activeIdx), Math.max(0, sel.feedOrder.length - 1))
    const eff = effectiveFeedKey(sel.feedOrder, idx, sel.pinnedKey)
    const msg = framesRef.current[eff]
    if (!msg) {
      const g = getComputedStyle(document.documentElement)
      const fill = g.getPropertyValue('--code-bg').trim() || '#f4f4f5'
      const fg = g.getPropertyValue('--text').trim() || '#6b6375'
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, STAGE_PX, STAGE_PX)
      ctx.fillStyle = fg
      ctx.font = '13px ui-monospace, monospace'
      ctx.fillText('No frame for ' + eff, 16, 28)
      return
    }
    const res = Math.floor(msg.res)
    const hex = Uint8Array.from(msg.hex)
    if (hex.length !== res * res) return
    let off = offHexRef.current
    if (!off) {
      off = document.createElement('canvas')
      offHexRef.current = off
    }
    drawHexFrame(
      canvas,
      off,
      hex,
      res,
      eff === CAMERA_FEED ? (cameraFeedMode === 'color' ? 'color' : 'gray') : variation.decodeMode,
      STAGE_PX,
    )
    postProcessCanvas(ctx, STAGE_PX, STAGE_PX, variation.invert, variation.scanlines)
    if (depthZones) {
      let work = layerWorkRef.current
      if (!work) {
        work = document.createElement('canvas')
        layerWorkRef.current = work
      }
      if (stackT0Ref.current === 0) stackT0Ref.current = performance.now()
      applyDepthSpatialStack(canvas, work, variation.dither, {
        lightNx: stackLightRef.current.nx,
        lightNy: stackLightRef.current.ny,
        timeSec: (performance.now() - stackT0Ref.current) / 1000,
        thermalAmp: eff === CAMERA_FEED && cameraFeedMode === 'color' ? 1 : 0.72,
      })
    } else {
      applyDitherPass(ctx, STAGE_PX, STAGE_PX, variation.dither)
    }

    const ring = trailRingRef.current ?? createTrailRing()
    if (!trailRingRef.current) trailRingRef.current = ring
    const tctx = ring.canvases[ring.write]?.getContext('2d')
    if (tctx) {
      tctx.imageSmoothingEnabled = false
      tctx.drawImage(canvas, 0, 0, STAGE_PX, STAGE_PX, 0, 0, TRAIL_THUMB, TRAIL_THUMB)
    }
    ring.write = (ring.write + 1) % TRAIL_SLOTS
    ring.filled = Math.min(TRAIL_SLOTS, ring.filled + 1)
    setTrailSeq((n) => n + 1)
  }, [variation, depthZones, cameraFeedMode])

  const ingest = useCallback(
    (msg: HexFrameMsg) => {
      const res = Math.floor(msg.res)
      if (res < 8 || res > 512) return
      const hex = Uint8Array.from(msg.hex)
      if (hex.length !== res * res) return
      const fk = normalizeFeedKey(msg.feedKey)
      framesRef.current[fk] = {
        type: 'hexframe',
        hex: Array.from(hex),
        res,
        mode: typeof msg.mode === 'string' ? msg.mode : 'gray',
        t: typeof msg.t === 'number' ? msg.t : performance.now(),
        feedKey: fk,
      }
      setFeedOrder((prev) => (prev.includes(fk) ? prev : [...prev, fk]))
      redrawStage()
    },
    [redrawStage],
  )

  useEffect(() => {
    const ch = new BroadcastChannel(LIVE_HEX_DOCUMENT_CHANNEL)
    const onMsg = (ev: MessageEvent) => {
      if (!isHexFrameMsg(ev.data)) return
      ingest(ev.data)
    }
    ch.addEventListener('message', onMsg)
    return () => {
      ch.removeEventListener('message', onMsg)
      ch.close()
    }
  }, [ingest])

  useLayoutEffect(() => {
    redrawStage()
  }, [feedOrder, displayIdx, pinnedKey, variationIdx, depthZones, cameraFeedMode, redrawStage])

  useEffect(() => {
    if (!demoPeers) return
    const ch = new BroadcastChannel(LIVE_HEX_DOCUMENT_CHANNEL)
    let t = 0
    const id = window.setInterval(() => {
      t += 1
      const res = 48
      ch.postMessage({
        type: 'hexframe',
        hex: noiseHex(res, t * 9973),
        res,
        mode: 'gray',
        feedKey: 'demo-alpha',
        t: performance.now(),
      })
      ch.postMessage({
        type: 'hexframe',
        hex: noiseHex(res, t * 7919 + 2048),
        res,
        mode: 'gray',
        feedKey: 'demo-beta',
        t: performance.now(),
      })
    }, 380)
    return () => {
      window.clearInterval(id)
      ch.close()
    }
  }, [demoPeers])

  useEffect(() => {
    let stream: MediaStream | null = null
    if (!cameraOn) {
      const v = videoRef.current
      const so = v?.srcObject
      if (so && typeof (so as MediaStream).getTracks === 'function') {
        for (const t of (so as MediaStream).getTracks()) t.stop()
      }
      if (v) v.srcObject = null
      return
    }
    const video = videoRef.current
    if (!video) {
      setCameraErr('No video element')
      setCameraOn(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: cameraFacing }, width: { ideal: 720 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) {
          for (const t of s.getTracks()) t.stop()
          return
        }
        stream = s
        video.srcObject = s
        await video.play()
        setCameraErr(null)
        setFeedOrder((prev) => [CAMERA_FEED, ...prev.filter((k) => k !== CAMERA_FEED)])
        setActiveIdx(0)
      } catch (e) {
        if (!cancelled) {
          setCameraErr(e instanceof Error ? e.message : 'Camera failed')
          setCameraOn(false)
          setFeedOrder((prev) => prev.filter((k) => k !== CAMERA_FEED))
          setPinnedKey((p) => (p === CAMERA_FEED ? null : p))
          setActiveIdx(0)
        }
      }
    })()
    return () => {
      cancelled = true
      if (stream) {
        for (const t of stream.getTracks()) t.stop()
      }
      video.srcObject = null
    }
  }, [cameraOn, cameraFacing])

  useEffect(() => {
    if (!cameraOn) return
    const v = videoRef.current
    const cap = capRef.current
    if (!v || !cap) return
    cap.width = CAMERA_GRID
    cap.height = CAMERA_GRID
    const ctx = cap.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    let ch: BroadcastChannel
    try {
      ch = new BroadcastChannel(LIVE_HEX_DOCUMENT_CHANNEL)
    } catch {
      return
    }
    let stopped = false
    const tick = () => {
      if (stopped) return
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        ctx.drawImage(v, 0, 0, CAMERA_GRID, CAMERA_GRID)
        try {
          const id = ctx.getImageData(0, 0, CAMERA_GRID, CAMERA_GRID)
          const hex = luminanceHexFromImageData(id)
          ch.postMessage({
            type: 'hexframe',
            hex,
            res: CAMERA_GRID,
            mode: cameraFeedMode,
            feedKey: CAMERA_FEED,
            t: performance.now(),
          })
        } catch {
          /* skip */
        }
      }
      camRaf.current = requestAnimationFrame(tick)
    }
    camRaf.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(camRaf.current)
      ch.close()
    }
  }, [cameraOn, cameraFeedMode])

  useEffect(() => {
    const v = ytVideoRef.current
    if (!ytFeedId) {
      teardownAudioGraph()
      if (v) {
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
      return
    }
    const streamUrl = ffmpegCdnStreamUrlForVideoId(ytFeedId)
    if (!streamUrl || !v) return

    let cancelled = false
    v.crossOrigin = 'anonymous'
    v.src = streamUrl
    void v.play().then(
      () => {
        if (!cancelled) setYtStreamErr(null)
      },
      (e: unknown) => {
        if (!cancelled) {
          setYtStreamErr(e instanceof Error ? e.message : 'Stream refused playback')
          setYtFeedId(null)
          setFeedOrder((prev) => prev.filter((k) => !k.startsWith('yt:')))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [ytFeedId, teardownAudioGraph])

  useEffect(() => {
    if (!streamAudioOn || !ytFeedId) {
      teardownAudioGraph()
      return
    }
    const v = ytVideoRef.current
    if (!v) return
    let cancelled = false
    const genAtStart = audioSetupGenRef.current
    ;(async () => {
      try {
        await v.play()
        if (cancelled || genAtStart !== audioSetupGenRef.current) return
        const ctx = audioCtxRef.current ?? new AudioContext()
        audioCtxRef.current = ctx
        if (ctx.state === 'suspended') await ctx.resume()
        if (cancelled || genAtStart !== audioSetupGenRef.current) return
        if (!audioNodesRef.current) {
          const src = ctx.createMediaElementSource(v)
          const gain = ctx.createGain()
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 512
          analyser.smoothingTimeConstant = 0.62
          src.connect(gain)
          gain.connect(analyser)
          analyser.connect(ctx.destination)
          audioNodesRef.current = { src, gain, analyser }
          analyserRef.current = analyser
        }
        v.muted = false
        const g = audioNodesRef.current?.gain
        if (g) g.gain.value = audioMuted ? 0 : audioVol
      } catch {
        /* autoplay / CORS — keep decoding muted for hex pipeline */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [streamAudioOn, ytFeedId, teardownAudioGraph])

  useEffect(() => {
    const g = audioNodesRef.current?.gain
    if (!g || !streamAudioOn) return
    g.gain.value = audioMuted ? 0 : audioVol
  }, [audioMuted, audioVol, streamAudioOn])

  useEffect(() => {
    if (!showWaveform) {
      cancelAnimationFrame(wfRafRef.current)
      const c = waveformCanvasRef.current
      const ctx = c?.getContext('2d')
      if (c && ctx && c.width > 0 && c.height > 0) ctx.clearRect(0, 0, c.width, c.height)
      return
    }

    const canvas = waveformCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cssBg =
      getComputedStyle(document.documentElement).getPropertyValue('--code-bg').trim() || '#f4f4f5'
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--ro-accent').trim() || '#6366f1'

    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth))
      const h = Math.max(1, Math.floor(canvas.clientHeight))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    let stopped = false
    const bufferFallback = new Uint8Array(128)
    let freqBuf: Uint8Array | null = null

    const draw = () => {
      if (stopped) return
      resize()
      const analyser = analyserRef.current
      const w = canvas.width
      const h = canvas.height
      let data: Uint8Array
      if (analyser && streamAudioOn) {
        if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
          freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
        }
        analyser.getByteFrequencyData(freqBuf as Uint8Array<ArrayBuffer>)
        data = freqBuf
      } else {
        data = bufferFallback
      }

      ctx.fillStyle = cssBg
      ctx.fillRect(0, 0, w, h)

      const barCount = Math.min(data.length, Math.max(16, Math.floor(w / 4)))
      const step = w / barCount
      ctx.fillStyle = accent
      for (let i = 0; i < barCount; i++) {
        const vi = data[i]!
        const norm = analyser && streamAudioOn ? vi / 255 : 0.04
        const bh = Math.max(1, norm * h * 0.94)
        ctx.fillRect(Math.floor(i * step), h - bh, Math.max(1, Math.ceil(step) - 1), bh)
      }
      wfRafRef.current = requestAnimationFrame(draw)
    }
    wfRafRef.current = requestAnimationFrame(draw)
    return () => {
      stopped = true
      cancelAnimationFrame(wfRafRef.current)
    }
  }, [showWaveform, streamAudioOn])

  useEffect(() => {
    if (!ytFeedId) return
    const v = ytVideoRef.current
    const cap = ytCapRef.current
    if (!v || !cap) return
    cap.width = CAMERA_GRID
    cap.height = CAMERA_GRID
    const ctx = cap.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    let ch: BroadcastChannel
    try {
      ch = new BroadcastChannel(LIVE_HEX_DOCUMENT_CHANNEL)
    } catch {
      return
    }
    const fk = ytHexFeedKey(ytFeedId)
    let stopped = false
    const tick = () => {
      if (stopped) return
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        ctx.drawImage(v, 0, 0, CAMERA_GRID, CAMERA_GRID)
        try {
          const id = ctx.getImageData(0, 0, CAMERA_GRID, CAMERA_GRID)
          const hex = luminanceHexFromImageData(id)
          ch.postMessage({
            type: 'hexframe',
            hex,
            res: CAMERA_GRID,
            mode: 'gray',
            feedKey: fk,
            t: performance.now(),
          })
        } catch {
          /* tainted canvas / CORS */
        }
      }
      ytRafRef.current = requestAnimationFrame(tick)
    }
    ytRafRef.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(ytRafRef.current)
      ch.close()
    }
  }, [ytFeedId])

  useEffect(() => {
    const v = ytVideoRef.current
    if (!v || !ytFeedId) {
      setYtUiTime(0)
      setYtUiDur(0)
      setYtUiPaused(true)
      setYtScrubDisplay(null)
      return
    }
    const syncFromVideo = () => {
      if (ytScrubbingRef.current) return
      setYtUiTime(v.currentTime)
      const d = v.duration
      setYtUiDur(Number.isFinite(d) ? d : 0)
      setYtUiPaused(v.paused)
    }
    const onPlay = () => setYtUiPaused(false)
    const onPause = () => setYtUiPaused(true)
    v.addEventListener('timeupdate', syncFromVideo)
    v.addEventListener('seeked', syncFromVideo)
    v.addEventListener('loadedmetadata', syncFromVideo)
    v.addEventListener('durationchange', syncFromVideo)
    v.addEventListener('progress', syncFromVideo)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onPause)
    syncFromVideo()
    return () => {
      v.removeEventListener('timeupdate', syncFromVideo)
      v.removeEventListener('seeked', syncFromVideo)
      v.removeEventListener('loadedmetadata', syncFromVideo)
      v.removeEventListener('durationchange', syncFromVideo)
      v.removeEventListener('progress', syncFromVideo)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onPause)
    }
  }, [ytFeedId])

  useEffect(() => {
    const endScrub = () => {
      if (!ytScrubbingRef.current) return
      ytScrubbingRef.current = false
      const el = ytVideoRef.current
      setYtScrubDisplay((scrub) => {
        if (el != null && scrub != null) {
          const cap = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : scrub + 1
          try {
            el.currentTime = Math.max(0, Math.min(scrub, cap))
          } catch {
            /* noop */
          }
        }
        return null
      })
    }
    window.addEventListener('pointerup', endScrub)
    window.addEventListener('pointercancel', endScrub)
    return () => {
      window.removeEventListener('pointerup', endScrub)
      window.removeEventListener('pointercancel', endScrub)
    }
  }, [])

  useEffect(() => {
    const v = ytVideoRef.current
    if (v) v.loop = ytLoop
  }, [ytLoop, ytFeedId])

  useEffect(() => {
    const v = ytVideoRef.current
    if (v) v.playbackRate = ytRate
  }, [ytRate, ytFeedId])

  const nFeeds = feedOrder.length
  const atKey = feedOrder[displayIdx] ?? DEFAULT_FEED
  const displayKey = effectiveFeedKey(feedOrder, displayIdx, pinnedKey)
  const pinActive = pinnedKey !== null && pinnedKey === atKey

  const cycleFeed = (d: number) => {
    if (nFeeds <= 1) return
    setActiveIdx((i) => {
      const clamped = Math.min(Math.max(0, i), feedOrder.length - 1)
      return (clamped + d + feedOrder.length) % feedOrder.length
    })
  }

  const chips = useMemo(() => feedOrder, [feedOrder])

  const ytSeekable =
    ytFeedId != null && ytUiDur > 0.25 && Number.isFinite(ytUiDur)

  const pipSupported =
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true

  const ytTogglePlay = useCallback(() => {
    const v = ytVideoRef.current
    if (!v || !ytFeedId) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }, [ytFeedId])

  const ytSeekRel = useCallback(
    (deltaSec: number) => {
      const v = ytVideoRef.current
      if (!v || !ytFeedId) return
      const cap = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Number.POSITIVE_INFINITY
      try {
        v.currentTime = Math.max(0, Math.min(v.currentTime + deltaSec, cap))
      } catch {
        /* noop */
      }
    },
    [ytFeedId],
  )

  const ytRestart = useCallback(() => {
    const v = ytVideoRef.current
    if (!v || !ytFeedId) return
    try {
      v.currentTime = 0
    } catch {
      /* noop */
    }
  }, [ytFeedId])

  const ytTogglePip = useCallback(async () => {
    const v = ytVideoRef.current
    if (!v || !ytFeedId || !pipSupported) return
    try {
      if (document.pictureInPictureElement === v) {
        await document.exitPictureInPicture()
      } else {
        await v.requestPictureInPicture()
      }
    } catch {
      /* noop */
    }
  }, [pipSupported, ytFeedId])

  const addYtStreamFeed = useCallback(() => {
    const raw = stripYouTubePasteDecorators(ytUrlInput)
    const id = parseYouTubeVideoId(raw)
    if (!id) {
      setYtStreamErr('Paste a YouTube watch URL, youtu.be link, or bare 11-character id.')
      return
    }
    const streamUrl = ffmpegCdnStreamUrlForVideoId(id)
    if (!streamUrl) {
      setYtStreamErr(
        'Set VITE_FFMPEG_STREAM_URL_TEMPLATE at build time (must include {id} or {videoId}) so the lab can open a CORS-friendly mirror URL.',
      )
      return
    }
    setYtStreamErr(null)
    setYtFeedId(id)
    const fk = ytHexFeedKey(id)
    setFeedOrder((prev) => [fk, ...prev.filter((k) => !k.startsWith('yt:'))])
    setActiveIdx(0)
  }, [ytUrlInput])

  const removeYtStreamFeed = useCallback(() => {
    setYtFeedId(null)
    setYtStreamErr(null)
    setStreamAudioOn(false)
    setYtLoop(false)
    setYtRate(1)
    setShowYtPreview(false)
    setYtScrubDisplay(null)
    ytScrubbingRef.current = false
    setFeedOrder((prev) => prev.filter((k) => !k.startsWith('yt:')))
    setPinnedKey((p) => (p != null && p.startsWith('yt:') ? null : p))
    setActiveIdx(0)
  }, [])

  const toggleCamera = useCallback(() => {
    if (cameraOn) {
      setFeedOrder((prev) => prev.filter((k) => k !== CAMERA_FEED))
      setPinnedKey((p) => (p === CAMERA_FEED ? null : p))
      setActiveIdx(0)
      setCameraOn(false)
      return
    }
    setCameraErr(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraErr('No getUserMedia')
      return
    }
    setCameraOn(true)
  }, [cameraOn])

  useEffect(() => {
    if (!cameraMenuOpen) return
    const onDoc = (e: globalThis.MouseEvent) => {
      const w = cameraMenuWrapRef.current
      if (w && !w.contains(e.target as Node)) setCameraMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCameraMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [cameraMenuOpen])

  const closeCameraMenu = useCallback(() => {
    setCameraMenuOpen(false)
  }, [])

  const onStackPointer = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const c = stageRef.current
      if (!c) return
      const r = c.getBoundingClientRect()
      stackLightRef.current = {
        nx: ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2,
        ny: ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2,
      }
      if (depthZones) redrawStage()
    },
    [depthZones, redrawStage],
  )

  useEffect(() => {
    if (!depthZones) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const id = window.setInterval(() => redrawStage(), 90)
    return () => clearInterval(id)
  }, [depthZones, redrawStage])

  return (
    <div className="ro-shell vfl-page">
      <header className="vfl-header">
        <button type="button" className="ro-btn ro-btn-ghost" onClick={onBack}>
          ← Workspace
        </button>
        <div className="vfl-header-text">
          <div className="vfl-header-kicker-effects">
            <p className="ro-kicker">Overview</p>
            <div className="vfl-header-camera-wrap">
              <div ref={cameraMenuWrapRef} className="ro-ingest-live-hex-details">
                <button
                  type="button"
                  id={cameraMenuTriggerId}
                  className={`ro-btn ro-btn-ghost ro-ingest-live-hex-menu-summary${cameraOn ? ' is-lit' : ''}`}
                  aria-label="Camera menu"
                  aria-expanded={cameraMenuOpen}
                  aria-haspopup="menu"
                  aria-controls={cameraMenuOpen ? cameraMenuId : undefined}
                  onClick={() => setCameraMenuOpen((o) => !o)}
                >
                  Camera
                </button>
                {cameraMenuOpen ? (
                  <div
                    id={cameraMenuId}
                    className="ro-ingest-live-hex-menu-panel"
                    role="menu"
                    aria-labelledby={cameraMenuTriggerId}
                  >
                    <div className="ro-ingest-live-hex-menu-row">
                      <span className="ro-ingest-live-hex-menu-label">Camera</span>
                      <button
                        type="button"
                        role="menuitem"
                        className="ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action"
                        onClick={() => {
                          toggleCamera()
                          closeCameraMenu()
                        }}
                      >
                        {cameraOn ? 'Stop' : 'Start'}
                      </button>
                    </div>
                    <div className="ro-ingest-live-hex-menu-row">
                      <span className="ro-ingest-live-hex-menu-label">Lens</span>
                      <button
                        type="button"
                        role="menuitem"
                        className={`ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action${cameraFacing === 'user' ? ' is-active' : ''}`}
                        onClick={() => {
                          setCameraFacing('user')
                          closeCameraMenu()
                        }}
                      >
                        Selfie
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={`ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action${cameraFacing === 'environment' ? ' is-active' : ''}`}
                        onClick={() => {
                          setCameraFacing('environment')
                          closeCameraMenu()
                        }}
                      >
                        Rear
                      </button>
                    </div>
                    <div className="ro-ingest-live-hex-menu-row">
                      <span className="ro-ingest-live-hex-menu-label">Look</span>
                      <button
                        type="button"
                        role="menuitem"
                        className={`ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action${cameraFeedMode === 'color' ? ' is-active' : ''}`}
                        onClick={() => {
                          setCameraFeedMode((m) => (m === 'gray' ? 'color' : 'gray'))
                          closeCameraMenu()
                        }}
                      >
                        Thermal
                      </button>
                    </div>
                    <p className="ro-ingest-live-hex-menu-hint muted">
                      Publishes <code className="ro-drawer-code">{CAMERA_FEED}</code> on{' '}
                      <code className="ro-drawer-code">{LIVE_HEX_DOCUMENT_CHANNEL}</code>.
                    </p>
                  </div>
                ) : null}
              </div>
              {cameraErr ? (
                <span className="ro-ingest-live-hex-camera-err muted" role="status">
                  {cameraErr}
                </span>
              ) : null}
            </div>
          </div>
          <div className="vfl-header-demo-bar">
            <section className="vfl-panel vfl-header-demo-panel" aria-label="Demo peers and stream URL">
              <h2 className="vfl-panel-title">Demo peers</h2>
              <label className="vfl-check">
                <input type="checkbox" checked={demoPeers} onChange={(e) => setDemoPeers(e.target.checked)} />
                Stream synthetic <code className="ro-drawer-code">demo-alpha</code> /{' '}
                <code className="ro-drawer-code">demo-beta</code>
              </label>
              <div className="vfl-yt-stream">
                <h3 className="vfl-yt-stream-title">YouTube → hex feed</h3>
                <p className="vfl-yt-stream-hint muted">
                  Paste a URL (braces optional, e.g.{' '}
                  <code className="ro-drawer-code">{'{https://www.youtube.com/watch?v=…}'}</code>). The in-page
                  YouTube player cannot be pixel-sampled; this path uses{' '}
                  <code className="ro-drawer-code">VITE_FFMPEG_STREAM_URL_TEMPLATE</code> to load a mirror you control
                  (same-origin or CORS-enabled MP4/HLS), same idea as the transcript dock.
                </p>
                <div className="vfl-yt-stream-row">
                  <input
                    type="text"
                    className="vfl-yt-stream-input"
                    placeholder="https://www.youtube.com/watch?v=… or {…}"
                    value={ytUrlInput}
                    onChange={(e) => setYtUrlInput(e.target.value)}
                    aria-label="YouTube URL for stream feed"
                  />
                  <button type="button" className="ro-btn ro-btn-ghost" onClick={addYtStreamFeed}>
                    Add feed
                  </button>
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    disabled={!ytFeedId}
                    onClick={removeYtStreamFeed}
                  >
                    Remove
                  </button>
                </div>
                {ytFeedId ? (
                  <p className="vfl-yt-stream-status muted" role="status">
                    Streaming <code className="ro-drawer-code">{ytHexFeedKey(ytFeedId)}</code>
                  </p>
                ) : null}
                {ytStreamErr ? (
                  <p className="vfl-yt-stream-err muted" role="alert">
                    {ytStreamErr}
                  </p>
                ) : null}
              </div>
            </section>
          </div>
          <h1 className="vfl-title">Video feeds lab</h1>
          <p className="vfl-lead">
            Live hex frames on <code className="ro-drawer-code">{LIVE_HEX_DOCUMENT_CHANNEL}</code>, carousel + pin,
            and built-in <strong>ordered dither</strong>, <strong>halftone</strong>, and <strong>ASCII-density</strong>{' '}
            passes (CPU canvas — same spirit as tools like{' '}
            <a href="https://efecto.app/fx" target="_blank" rel="noreferrer">
              Efecto
            </a>
            ,{' '}
            <a href="https://antlii.work/DITHR-Tool" target="_blank" rel="noreferrer">
              DITHR
            </a>
            ). Optional <strong>depth stack</strong> layers roto-style falloff, a thermal plane that sweeps and
            pulls forward in z, then dither weighted toward edges so dots read closest to the glass. Move the
            mouse on the <strong>stage</strong> for key light; trail tiles use parallax depth.
          </p>
          <div className="vfl-credits">
            <span>Inspiration</span>
            <a href="https://efecto.app/fx?v=1&in=media&media=%252Fassets%252Fclose-up-of-young-woman-with-glasses.mp4&mpx=0&mpy=0&ms=1&ss=0" target="_blank" rel="noreferrer">
              Efecto FX
            </a>
            <a
              href="https://tympanus.net/codrops/2026/01/04/efecto-building-real-time-ascii-and-dithering-effects-with-webgl-shaders/"
              target="_blank"
              rel="noreferrer"
            >
              Codrops · Efecto
            </a>
            <a href="https://antlii.work/DITHR-Tool" target="_blank" rel="noreferrer">
              DITHR
            </a>
            <a
              href="https://www.figma.com/community/file/1530841599105376021/razis-3d-ascii-dither-lab"
              target="_blank"
              rel="noreferrer"
            >
              Figma · ASCII dither lab
            </a>
            <a href="https://gmunk.com/Information" target="_blank" rel="noreferrer">
              GMUNK · Information
            </a>
          </div>
        </div>
      </header>

      <div className="vfl-layout">
        <main className="vfl-main">
          <div className="vfl-stage-bump">
            <div className="vfl-stage-column">
              <section className="vfl-panel vfl-stage-effects" aria-label="Effects preset">
                <div className="vfl-effects-row">
                  <h2 className="vfl-panel-title">Effects</h2>
                  <div className="vfl-var-row">
                    <button
                      type="button"
                      className="ro-btn ro-btn-ghost"
                      aria-label="Previous preset"
                      onClick={() => setVariationIdx((i) => (i - 1 + VARIATIONS.length) % VARIATIONS.length)}
                    >
                      ◀
                    </button>
                    <code className="vfl-var-code">{variation.label}</code>
                    <button
                      type="button"
                      className="ro-btn ro-btn-ghost"
                      aria-label="Next preset"
                      onClick={() => setVariationIdx((i) => (i + 1) % VARIATIONS.length)}
                    >
                      ▶
                    </button>
                  </div>
                </div>
                <label className="vfl-header-depth-check muted">
                  <input
                    type="checkbox"
                    checked={depthZones}
                    onChange={(e) => setDepthZones(e.target.checked)}
                  />
                  Depth stack — roto lighting (back), thermal sweep + float plane (mid), dither on
                  edges / near plane (front). Pointer on stage moves the key light; ~3× CPU.
                </label>
              </section>
              <section
                className="vfl-panel vfl-media-controls"
                aria-label="Video transport, waveform, captions, image, and stream audio"
              >
                <div className="vfl-media-grid">
                  <div className="vfl-media-block vfl-media-block--video">
                    <h3 className="vfl-media-block-title">Video</h3>
                    <p className="vfl-media-hint muted">
                      Controls the hidden mirror element used for hex sampling; optional preview shows the same decode as the
                      stage source.
                    </p>
                    <div className="vfl-video-toolbar" role="toolbar" aria-label="Stream playback">
                      <button
                        type="button"
                        className="ro-btn ro-btn-ghost"
                        disabled={!ytFeedId}
                        aria-label={ytUiPaused ? 'Play' : 'Pause'}
                        onClick={ytTogglePlay}
                      >
                        {ytUiPaused ? 'Play' : 'Pause'}
                      </button>
                      <button type="button" className="ro-btn ro-btn-ghost" disabled={!ytFeedId} onClick={ytRestart}>
                        Restart
                      </button>
                      <button
                        type="button"
                        className="ro-btn ro-btn-ghost"
                        disabled={!ytFeedId}
                        aria-label="Back ten seconds"
                        onClick={() => ytSeekRel(-10)}
                      >
                        −10s
                      </button>
                      <button
                        type="button"
                        className="ro-btn ro-btn-ghost"
                        disabled={!ytFeedId}
                        aria-label="Forward ten seconds"
                        onClick={() => ytSeekRel(10)}
                      >
                        +10s
                      </button>
                      <button type="button" className="ro-btn ro-btn-ghost" disabled={!pipSupported || !ytFeedId} onClick={ytTogglePip}>
                        PiP
                      </button>
                    </div>
                    <div className="vfl-video-seek-wrap">
                      <label className="vfl-media-label vfl-video-seek-label" htmlFor="vfl-seek">
                        Seek
                      </label>
                      <input
                        id="vfl-seek"
                        type="range"
                        className="vfl-video-seek"
                        disabled={!ytSeekable}
                        min={0}
                        max={Math.max(ytUiDur, 0.001)}
                        step={Math.min(0.25, Math.max(0.05, ytUiDur / 800 || 0.05))}
                        value={ytScrubDisplay ?? ytUiTime}
                        aria-valuemin={0}
                        aria-valuemax={Math.round(ytUiDur * 1000) / 1000}
                        aria-valuenow={Math.round((ytScrubDisplay ?? ytUiTime) * 1000) / 1000}
                        aria-valuetext={`${formatMediaClock(ytScrubDisplay ?? ytUiTime)} of ${formatMediaClock(ytUiDur)}`}
                        onPointerDown={() => {
                          ytScrubbingRef.current = true
                        }}
                        onChange={(e) => setYtScrubDisplay(Number(e.target.value))}
                      />
                      <span className="vfl-video-time muted" aria-live="polite">
                        {formatMediaClock(ytScrubDisplay ?? ytUiTime)} /{' '}
                        {ytSeekable ? formatMediaClock(ytUiDur) : ytFeedId ? '…' : '—'}
                      </span>
                    </div>
                    <div className="vfl-media-row vfl-media-row--rate">
                      <label className="vfl-media-label" htmlFor="vfl-rate">
                        Speed
                      </label>
                      <select
                        id="vfl-rate"
                        className="vfl-video-rate-select"
                        disabled={!ytFeedId}
                        value={ytRate}
                        onChange={(e) => setYtRate(Number(e.target.value))}
                      >
                        {PLAYBACK_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r === 1 ? '1×' : `${r}×`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="vfl-check">
                      <input
                        type="checkbox"
                        checked={ytLoop}
                        disabled={!ytFeedId}
                        onChange={(e) => setYtLoop(e.target.checked)}
                      />
                      Loop
                    </label>
                    <label className="vfl-check">
                      <input
                        type="checkbox"
                        checked={showYtPreview}
                        disabled={!ytFeedId}
                        onChange={(e) => setShowYtPreview(e.target.checked)}
                      />
                      Show mirror preview (same element as sampling)
                    </label>
                    <video
                      ref={ytVideoRef}
                      className={showYtPreview ? 'vfl-source-preview' : 'vfl-hidden-video'}
                      playsInline
                      muted={!streamAudioOn}
                      preload="auto"
                      aria-label={showYtPreview ? 'Mirror stream preview' : undefined}
                    />
                  </div>
                  <div className="vfl-media-block">
                    <h3 className="vfl-media-block-title">Audio</h3>
                    <p className="vfl-media-hint muted">
                      Routes the YouTube mirror element through Web Audio (needs an active stream feed). Hex sampling stays on the same element.
                    </p>
                    <label className="vfl-check">
                      <input
                        type="checkbox"
                        checked={streamAudioOn}
                        disabled={!ytFeedId}
                        onChange={(e) => setStreamAudioOn(e.target.checked)}
                      />
                      Stream audio (speakers)
                    </label>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-vol">
                        Volume
                      </label>
                      <input
                        id="vfl-vol"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(audioVol * 100)}
                        disabled={!streamAudioOn || !ytFeedId || audioMuted}
                        onChange={(e) => setAudioVol(Number(e.target.value) / 100)}
                        aria-valuetext={`${Math.round(audioVol * 100)} percent`}
                      />
                    </div>
                    <label className="vfl-check">
                      <input
                        type="checkbox"
                        checked={audioMuted}
                        disabled={!streamAudioOn || !ytFeedId}
                        onChange={(e) => setAudioMuted(e.target.checked)}
                      />
                      Mute
                    </label>
                  </div>
                  <div className="vfl-media-block">
                    <h3 className="vfl-media-block-title">Waveform</h3>
                    <label className="vfl-check">
                      <input type="checkbox" checked={showWaveform} onChange={(e) => setShowWaveform(e.target.checked)} />
                      Show spectrum analyzer
                    </label>
                    <canvas
                      ref={waveformCanvasRef}
                      className="vfl-waveform-canvas"
                      aria-label={streamAudioOn ? 'Stream frequency spectrum' : 'Spectrum idle — enable stream audio for live bins'}
                    />
                  </div>
                  <div className="vfl-media-block">
                    <h3 className="vfl-media-block-title">Captions</h3>
                    <label className="vfl-check">
                      <input type="checkbox" checked={captionsOn} onChange={(e) => setCaptionsOn(e.target.checked)} />
                      Overlay on stage
                    </label>
                    <textarea
                      className="vfl-caption-input"
                      rows={3}
                      placeholder="Caption lines shown over the stage (preview / burn-in style)"
                      value={captionText}
                      onChange={(e) => setCaptionText(e.target.value)}
                      aria-label="Caption overlay text"
                    />
                  </div>
                  <div className="vfl-media-block">
                    <h3 className="vfl-media-block-title">Image</h3>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-bri">
                        Brightness
                      </label>
                      <input
                        id="vfl-bri"
                        type="range"
                        min={40}
                        max={160}
                        step={1}
                        value={imageBrightness}
                        onChange={(e) => setImageBrightness(Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{imageBrightness}%</span>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-con">
                        Contrast
                      </label>
                      <input
                        id="vfl-con"
                        type="range"
                        min={40}
                        max={160}
                        step={1}
                        value={imageContrast}
                        onChange={(e) => setImageContrast(Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{imageContrast}%</span>
                    </div>
                  </div>
                </div>
              </section>
              <div className="vfl-stage-wrap">
                <div className="vfl-stage-toolbar">
                  <button type="button" className="ro-btn ro-btn-ghost" disabled={nFeeds <= 1} onClick={() => cycleFeed(-1)}>
                    ◀ Feeds
                  </button>
                  <button type="button" className="ro-btn ro-btn-ghost" disabled={nFeeds <= 1} onClick={() => cycleFeed(1)}>
                    Feeds ▶
                  </button>
                  <button
                    type="button"
                    className={`ro-btn ro-btn-ghost${pinnedKey ? ' is-lit' : ''}`}
                    onClick={() => {
                      if (pinActive) setPinnedKey(null)
                      else setPinnedKey(atKey)
                    }}
                  >
                    {pinActive ? 'Unpin' : 'Pin'} {atKey}
                  </button>
                </div>
                <div className="vfl-stage-visual-stack">
                  <div
                    className="vfl-stage-filter-wrap"
                    style={{
                      filter: `brightness(${imageBrightness}%) contrast(${imageContrast}%)`,
                    }}
                  >
                    <canvas
                      ref={stageRef}
                      className={`vfl-stage${depthZones ? ' vfl-stage--depth-stack' : ''}`}
                      width={STAGE_PX}
                      height={STAGE_PX}
                      onPointerMove={onStackPointer}
                    />
                  </div>
                  {captionsOn && captionText.trim() ? (
                    <div className="vfl-caption-overlay" aria-live="polite">
                      {captionText}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <VflBumpRail trailRingRef={trailRingRef} trailSeq={trailSeq} />
          </div>

          <div className="vfl-chips" role="tablist" aria-label="Known feeds">
            {chips.map((k) => {
              const browsing = k === atKey
              const onStage = k === displayKey
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={browsing}
                  title={onStage ? 'On main stage' : undefined}
                  className={`vfl-chip${browsing ? ' is-active' : ''}${onStage ? ' is-on-stage' : ''}`}
                  onClick={() => setActiveIdx(Math.max(0, feedOrder.indexOf(k)))}
                >
                  {k}
                  {pinnedKey === k ? ' · pinned' : ''}
                </button>
              )
            })}
          </div>
        </main>
      </div>

      <video ref={videoRef} className="vfl-hidden-video" playsInline muted autoPlay />
      <canvas ref={capRef} className="vfl-hidden-cap" width={CAMERA_GRID} height={CAMERA_GRID} aria-hidden />
      <canvas ref={ytCapRef} className="vfl-hidden-cap" width={CAMERA_GRID} height={CAMERA_GRID} aria-hidden />
    </div>
  )
}
