import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './research.css'
import {
  drawHexFrame,
  luminanceHexFromImageData,
  normalizeFeedKey,
  type HexFrameMsg,
} from './liveHexCodec'
import { ffmpegCdnStreamUrlForVideoId } from '../util/ffmpegStreamUrl'
import { useLiveHexRoom } from './liveHexRoom'
import { RoomLinkStatusLight } from './RoomLinkStatusLight'
import { VflBumpRail, VflFeedMosaic } from './VflFeedMosaic'
import { useRoomChannelActivity } from './vflRoomLinkStatus'
import { consumePendingFeedPaste, consumePendingRoomPaste, liveHexChannelForRoom } from './vfl-room-share'
import { parseFeedLinkPaste, ytHexFeedKey } from './vfl-feed-paste'
import {
  getVwallGoogleCredentials,
  loadVwallUniverse,
  saveVwallGoogleCredentials,
  vwallFeedKey,
} from './vwallFeeds'
import {
  applyDepthSpatialStack,
  applyDitherPass,
  DEFAULT_GSPLAT_DEPTH,
  type DitherPass,
  type GsplatDepthTune,
} from './videoLabEffects'
import { videoLabChatCompletion } from './videoLabOllama'
import { drawPoseSkeleton, getPoseLandmarker } from './videoLabMediaPipePose'
import './video-feeds-lab.css'

export type VideoFeedsLabProps = {
  onBack: () => void
}

const CAMERA_FEED = '__camera__'
const DEFAULT_FEED = '__default__'

const STAGE_PX = 480
const CAMERA_GRID = 72
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
  const [vwallMenuOpen, setVwallMenuOpen] = useState(false)
  const cameraMenuId = useId()
  const vwallMenuId = useId()
  const cameraMenuTriggerId = `${cameraMenuId}-trigger`
  const vwallMenuTriggerId = `${vwallMenuId}-trigger`
  const [feedThumbSeq, setFeedThumbSeq] = useState(0)
  const bumpOffRef = useRef<HTMLCanvasElement | null>(null)
  const [depthZones, setDepthZones] = useState(false)
  const [feedLinkPaste, setFeedLinkPaste] = useState(() => consumePendingFeedPaste() ?? '')
  const [roomLinkPaste, setRoomLinkPaste] = useState(() => consumePendingRoomPaste() ?? '')
  const [chatDraft, setChatDraft] = useState('')
  const [vwallSearch, setVwallSearch] = useState('')
  const [vwallCount, setVwallCount] = useState(48)
  const [vwallSeed, setVwallSeed] = useState(0)
  const [vwallBusy, setVwallBusy] = useState(false)
  const [vwallErr, setVwallErr] = useState<string | null>(null)
  const [vwallShowSettings, setVwallShowSettings] = useState(false)
  const [vwallApiKey, setVwallApiKey] = useState(() => getVwallGoogleCredentials().apiKey)
  const [vwallCx, setVwallCx] = useState(() => getVwallGoogleCredentials().cx)
  const [vwallTiles, setVwallTiles] = useState<{ feedKey: string; url: string; title: string }[]>([])
  const vwallImagesRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const [labView, setLabView] = useState<'stage' | 'vwall'>('stage')
  const [vwallWallLayout, setVwallWallLayout] = useState<'dense' | 'checker'>('dense')
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
  const vwallMenuWrapRef = useRef<HTMLDivElement | null>(null)
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

  /** Camera microphone + presence lab */
  const [cameraMicOn, setCameraMicOn] = useState(false)
  const [gsplatTune, setGsplatTune] = useState<Partial<GsplatDepthTune>>({})
  const [poseEnabled, setPoseEnabled] = useState(false)
  const [poseErr, setPoseErr] = useState<string | null>(null)

  const [voicePrompt, setVoicePrompt] = useState(
    'In one short question, ask if my lighting and framing look OK for research video.',
  )
  const [voiceLog, setVoiceLog] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)

  const [spectrumSource, setSpectrumSource] = useState<'stream' | 'mic'>('stream')
  const [acousticFft, setAcousticFft] = useState<256 | 512 | 1024 | 2048>(512)
  const [acousticSmooth, setAcousticSmooth] = useState(0.62)

  const poseCanvasRef = useRef<HTMLCanvasElement>(null)
  const poseRafRef = useRef(0)
  const landmarkerRef = useRef<Awaited<ReturnType<typeof getPoseLandmarker>> | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const micSetupGenRef = useRef(0)

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
  /** Gain node only — updated imperatively (volume/mute); kept separate for react-hooks/immutability. */
  const streamGainRef = useRef<GainNode | null>(null)
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
    streamGainRef.current = null
    analyserRef.current = null
    const v = ytVideoRef.current
    if (v) {
      v.muted = true
    }
  }, [])

  const variation = VARIATIONS[variationIdx % VARIATIONS.length]!

  const gsplatEffective = useMemo(() => ({ ...DEFAULT_GSPLAT_DEPTH, ...gsplatTune }), [gsplatTune])

  const setGsplatField = useCallback((key: keyof GsplatDepthTune, value: number) => {
    setGsplatTune((prev) => ({ ...prev, [key]: value }))
  }, [])

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
        gsplat: gsplatTune,
      })
    } else {
      applyDitherPass(ctx, STAGE_PX, STAGE_PX, variation.dither)
    }

  }, [variation, depthZones, cameraFeedMode, gsplatTune])

  const ingestRef = useRef<(msg: HexFrameMsg) => void>(() => {})

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
      setFeedThumbSeq((n) => n + 1)
      redrawStage()
    },
    [redrawStage],
  )

  useEffect(() => {
    ingestRef.current = ingest
  }, [ingest])

  const onRoomApplied = useCallback((data: { room: string; peer: string }) => {
    setFeedOrder((prev) => (prev.includes(data.peer) ? prev : [data.peer, ...prev]))
  }, [])

  const room = useLiveHexRoom({
    onHexFrame: (msg) => {
      ingestRef.current(msg)
    },
    onRoomApplied,
  })
  const {
    roomId,
    peerId,
    isInRoom,
    publishHexToRoom,
    joinRoomFromPaste,
    startNewRoom,
    copyRoomLink,
    postChat,
    chatLog,
    roomShareUrl,
    roomErr,
  } = room
  const roomLinkStatus = useRoomChannelActivity(roomId, peerId)

  useLayoutEffect(() => {
    redrawStage()
  }, [feedOrder, displayIdx, pinnedKey, variationIdx, depthZones, cameraFeedMode, redrawStage])

  useEffect(() => {
    if (!demoPeers) return
    const ch = new BroadcastChannel(liveHexChannelForRoom(roomId))
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
  }, [demoPeers, roomId])

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
          audio: cameraMicOn,
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
  }, [cameraOn, cameraFacing, cameraMicOn])

  useEffect(() => {
    if (!cameraOn) return
    const v = videoRef.current
    const cap = capRef.current
    if (!v || !cap) return
    cap.width = CAMERA_GRID
    cap.height = CAMERA_GRID
    const ctx = cap.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const channelName = liveHexChannelForRoom(roomId)
    let ch: BroadcastChannel
    try {
      ch = new BroadcastChannel(channelName)
    } catch {
      return
    }
    const camFeedKey = isInRoom ? peerId : CAMERA_FEED
    let stopped = false
    const tick = () => {
      if (stopped) return
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        ctx.drawImage(v, 0, 0, CAMERA_GRID, CAMERA_GRID)
        try {
          const id = ctx.getImageData(0, 0, CAMERA_GRID, CAMERA_GRID)
          const hex = luminanceHexFromImageData(id)
          const frame: HexFrameMsg = {
            type: 'hexframe',
            hex,
            res: CAMERA_GRID,
            mode: cameraFeedMode,
            feedKey: camFeedKey,
            t: performance.now(),
          }
          ch.postMessage(frame)
          if (isInRoom) publishHexToRoom(frame)
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
  }, [cameraOn, cameraFeedMode, isInRoom, peerId, publishHexToRoom, roomId])

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
          streamGainRef.current = gain
          analyserRef.current = analyser
        }
        v.muted = false
        const g = streamGainRef.current
        if (g) g.gain.value = audioMuted ? 0 : audioVol
      } catch {
        /* autoplay / CORS — keep decoding muted for hex pipeline */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [streamAudioOn, ytFeedId, teardownAudioGraph, audioMuted, audioVol])

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
      const analyser =
        spectrumSource === 'mic' ? micAnalyserRef.current : analyserRef.current
      const active =
        spectrumSource === 'mic'
          ? cameraMicOn && !!micAnalyserRef.current
          : streamAudioOn && !!analyserRef.current
      const w = canvas.width
      const h = canvas.height
      let data: Uint8Array
      if (analyser && active) {
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
        const norm = analyser && active ? vi / 255 : 0.04
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
  }, [showWaveform, streamAudioOn, spectrumSource, cameraMicOn])

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
      ch = new BroadcastChannel(liveHexChannelForRoom(roomId))
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
  }, [ytFeedId, roomId])

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

  const applyFeedFromPaste = useCallback(
    (raw: string) => {
      const parsed = parseFeedLinkPaste(raw)
      if (parsed.kind === 'youtube') {
        setFeedLinkPaste(parsed.raw)
        const streamUrl = ffmpegCdnStreamUrlForVideoId(parsed.videoId)
        if (!streamUrl) {
          setYtStreamErr(
            'YouTube id ok — set VITE_FFMPEG_STREAM_URL_TEMPLATE ({id}) for a CORS mirror stream.',
          )
          return
        }
        setYtStreamErr(null)
        setYtFeedId(parsed.videoId)
        const fk = ytHexFeedKey(parsed.videoId)
        setFeedOrder((prev) => [fk, ...prev.filter((k) => !k.startsWith('yt:'))])
        setActiveIdx(0)
        return
      }
      if (parsed.kind === 'feedKey') {
        setFeedOrder((prev) => {
          if (prev.includes(parsed.feedKey)) {
            setActiveIdx(prev.indexOf(parsed.feedKey))
            return prev
          }
          const next = [...prev, parsed.feedKey]
          setActiveIdx(next.length - 1)
          return next
        })
        return
      }
      if (parsed.kind === 'http') {
        setYtStreamErr('HTTP URLs need a mirror template or open as a custom feedKey alias.')
        return
      }
      setYtStreamErr('Unrecognized feed link — use YouTube URL, peer:… id, or demo-alpha style key.')
    },
    [],
  )

  const pendingFeedApplied = useRef(false)
  useEffect(() => {
    if (pendingFeedApplied.current || !feedLinkPaste.trim()) return
    pendingFeedApplied.current = true
    applyFeedFromPaste(feedLinkPaste)
  }, [applyFeedFromPaste, feedLinkPaste])

  const pendingRoomApplied = useRef(false)
  useEffect(() => {
    if (pendingRoomApplied.current || !roomLinkPaste.trim()) return
    pendingRoomApplied.current = true
    void joinRoomFromPaste(roomLinkPaste)
  }, [joinRoomFromPaste, roomLinkPaste])

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

  const clearVwallFeeds = useCallback(() => {
    setVwallTiles([])
    vwallImagesRef.current.clear()
    setFeedOrder((prev) => prev.filter((k) => !k.startsWith('vwall:')))
    setPinnedKey((p) => (p != null && p.startsWith('vwall:') ? null : p))
    setVwallErr(null)
  }, [])

  const loadVwallFeeds = useCallback(async (seedOverride?: number) => {
    setVwallBusy(true)
    setVwallErr(null)
    const seed = seedOverride ?? vwallSeed
    try {
      const q = vwallSearch.trim() || null
      const items = await loadVwallUniverse(q, vwallCount, seed)
      const creds = getVwallGoogleCredentials()
      const tiles = items.map((item, i) => ({
        feedKey: vwallFeedKey(q, i, item.url),
        url: item.url,
        title: item.title,
      }))
      setVwallTiles(tiles)
      const keys = tiles.map((t) => t.feedKey)
      setFeedOrder((prev) => {
        const rest = prev.filter((k) => !k.startsWith('vwall:'))
        return [...keys, ...rest]
      })
      setActiveIdx(0)
      if (q && !creds.apiKey) {
        setVwallErr('No Google API keys — loaded picsum placeholders. Open VWall settings to add keys.')
      } else if (q && creds.apiKey && !creds.cx) {
        setVwallErr('Missing Custom Search Engine ID — using picsum fallback.')
      }
    } catch (e) {
      setVwallErr(e instanceof Error ? e.message : 'VWall load failed')
    } finally {
      setVwallBusy(false)
    }
  }, [vwallSearch, vwallCount, vwallSeed])

  useEffect(() => {
    const map = vwallImagesRef.current
    map.clear()
    for (const t of vwallTiles) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.referrerPolicy = 'no-referrer'
      img.src = t.url
      map.set(t.feedKey, img)
    }
  }, [vwallTiles])

  useEffect(() => {
    if (vwallTiles.length === 0) return
    const cap = document.createElement('canvas')
    cap.width = CAMERA_GRID
    cap.height = CAMERA_GRID
    const ctx = cap.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    let ch: BroadcastChannel
    try {
      ch = new BroadcastChannel(liveHexChannelForRoom(roomId))
    } catch {
      return
    }
    const sample = () => {
      for (const t of vwallTiles) {
        const img = vwallImagesRef.current.get(t.feedKey)
        if (!img?.complete || img.naturalWidth < 1) continue
        ctx.drawImage(img, 0, 0, CAMERA_GRID, CAMERA_GRID)
        try {
          const id = ctx.getImageData(0, 0, CAMERA_GRID, CAMERA_GRID)
          const hex = luminanceHexFromImageData(id)
          const frame: HexFrameMsg = {
            type: 'hexframe',
            hex,
            res: CAMERA_GRID,
            mode: 'gray',
            feedKey: t.feedKey,
            t: performance.now(),
          }
          ingestRef.current(frame)
          ch.postMessage(frame)
          if (isInRoom) publishHexToRoom(frame)
        } catch {
          /* cross-origin taint */
        }
      }
      setFeedThumbSeq((n) => n + 1)
    }
    const id = window.setInterval(sample, 280)
    sample()
    return () => {
      window.clearInterval(id)
      ch.close()
    }
  }, [vwallTiles, roomId, isInRoom, publishHexToRoom])

  useEffect(() => {
    const a = analyserRef.current
    if (!a || !streamAudioOn) return
    a.fftSize = acousticFft
    a.smoothingTimeConstant = acousticSmooth
  }, [acousticFft, acousticSmooth, streamAudioOn])

  useEffect(() => {
    const a = micAnalyserRef.current
    if (!a || !cameraMicOn) return
    a.fftSize = acousticFft
    a.smoothingTimeConstant = acousticSmooth
  }, [acousticFft, acousticSmooth, cameraMicOn])

  useEffect(() => {
    micSetupGenRef.current++
    const gen = micSetupGenRef.current
    if (!cameraOn || !cameraMicOn) {
      try {
        micSourceRef.current?.disconnect()
      } catch {
        /* noop */
      }
      micSourceRef.current = null
      micAnalyserRef.current = null
      return
    }
    const v = videoRef.current
    const stream = v?.srcObject as MediaStream | null
    if (!stream?.getAudioTracks()[0]) return
    void (async () => {
      const ctx = audioCtxRef.current ?? new AudioContext()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()
      if (gen !== micSetupGenRef.current) return
      try {
        micSourceRef.current?.disconnect()
      } catch {
        /* noop */
      }
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = acousticFft
      an.smoothingTimeConstant = acousticSmooth
      src.connect(an)
      micSourceRef.current = src
      micAnalyserRef.current = an
    })()
    return () => {
      micSetupGenRef.current = gen + 1
      try {
        micSourceRef.current?.disconnect()
      } catch {
        /* noop */
      }
      micSourceRef.current = null
      micAnalyserRef.current = null
    }
  }, [cameraOn, cameraMicOn, acousticFft, acousticSmooth])

  useEffect(() => {
    if (!poseEnabled || !cameraOn) {
      cancelAnimationFrame(poseRafRef.current)
      landmarkerRef.current = null
      const pc = poseCanvasRef.current
      const ctx = pc?.getContext('2d')
      if (pc && ctx) ctx.clearRect(0, 0, pc.width, pc.height)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        landmarkerRef.current = await getPoseLandmarker()
      } catch (e) {
        if (!cancelled) setPoseErr(e instanceof Error ? e.message : 'Pose init failed')
      }
    })()
    const loop = () => {
      if (cancelled) return
      const v = videoRef.current
      const pc = poseCanvasRef.current
      const lm = landmarkerRef.current
      if (pc && (pc.width !== STAGE_PX || pc.height !== STAGE_PX)) {
        pc.width = STAGE_PX
        pc.height = STAGE_PX
      }
      const ctx = pc?.getContext('2d')
      if (ctx && pc) ctx.clearRect(0, 0, pc.width, pc.height)
      if (lm && v && ctx && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const res = lm.detectForVideo(v, performance.now())
          const pts = res?.landmarks?.[0]
          if (pts) drawPoseSkeleton(ctx, pts, STAGE_PX, STAGE_PX)
        } catch {
          /* dropout */
        }
      }
      poseRafRef.current = requestAnimationFrame(loop)
    }
    poseRafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelled = true
      cancelAnimationFrame(poseRafRef.current)
    }
  }, [poseEnabled, cameraOn])

  const speakText = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (!text.trim()) {
        resolve()
        return
      }
      const u = new SpeechSynthesisUtterance(text)
      u.onend = () => resolve()
      u.onerror = () => resolve()
      window.speechSynthesis.speak(u)
    })
  }, [])

  const runVoiceAsk = useCallback(async () => {
    setVoiceBusy(true)
    setVoiceLog('')
    try {
      const reply = await videoLabChatCompletion(
        'You will be read aloud with speech synthesis. Be brief: one short paragraph, plain English.',
        voicePrompt.trim() ||
          'Ask me one clear question I can answer about my camera or lighting setup.',
      )
      setVoiceLog(reply)
      await speakText(reply)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Voice ask failed'
      setVoiceLog(msg)
      await speakText(`Sorry. ${msg}`)
    } finally {
      setVoiceBusy(false)
    }
  }, [speakText, voicePrompt])

  const runListenOnce = useCallback(() => {
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognition
      webkitSpeechRecognition?: new () => SpeechRecognition
    }
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) {
      setVoiceLog('No SpeechRecognition in this browser.')
      return
    }
    const r = new Ctor()
    r.lang = 'en-US'
    r.interimResults = false
    r.maxAlternatives = 1
    r.onresult = (ev: SpeechRecognitionEvent) => {
      const t = ev.results[0]?.[0]?.transcript?.trim()
      setVoiceLog(t ? `Heard: ${t}` : '(empty)')
    }
    r.onerror = () => setVoiceLog('Speech recognition error — check mic permission.')
    r.start()
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

  useEffect(() => {
    if (!vwallMenuOpen) return
    const onDoc = (e: globalThis.MouseEvent) => {
      const w = vwallMenuWrapRef.current
      if (w && !w.contains(e.target as Node)) setVwallMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVwallMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [vwallMenuOpen])

  const closeVwallMenu = useCallback(() => {
    setVwallMenuOpen(false)
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
                      <span className="ro-ingest-live-hex-menu-label">Mic</span>
                      <button
                        type="button"
                        role="menuitem"
                        className={`ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action${cameraMicOn ? ' is-active' : ''}`}
                        onClick={() => {
                          setCameraMicOn((m) => !m)
                          closeCameraMenu()
                        }}
                      >
                        {cameraMicOn ? 'On' : 'Off'}
                      </button>
                    </div>
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
                    <div
                      className="ro-ingest-live-hex-menu-row ro-ingest-live-hex-menu-row--block vfl-camera-image-tune"
                      role="group"
                      aria-label="Stage image brightness and contrast"
                    >
                      <span className="ro-ingest-live-hex-menu-label">Image</span>
                      <div className="vfl-media-row">
                        <label className="vfl-media-label" htmlFor="vfl-cam-bri">
                          Brightness
                        </label>
                        <input
                          id="vfl-cam-bri"
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
                        <label className="vfl-media-label" htmlFor="vfl-cam-con">
                          Contrast
                        </label>
                        <input
                          id="vfl-cam-con"
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
                    <p className="ro-ingest-live-hex-menu-hint muted">
                      Publishes{' '}
                      <code className="ro-drawer-code">{isInRoom ? peerId : CAMERA_FEED}</code> on{' '}
                      <code className="ro-drawer-code">{liveHexChannelForRoom(roomId)}</code>.
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
            <div ref={vwallMenuWrapRef} className="vfl-header-vwall-wrap">
              <div className="ro-ingest-live-hex-details">
                <button
                  type="button"
                  id={vwallMenuTriggerId}
                  className={`ro-btn ro-btn-ghost ro-ingest-live-hex-menu-summary${vwallTiles.length > 0 ? ' is-lit' : ''}`}
                  aria-label="VWall feeds menu"
                  aria-expanded={vwallMenuOpen}
                  aria-haspopup="menu"
                  aria-controls={vwallMenuOpen ? vwallMenuId : undefined}
                  onClick={() => setVwallMenuOpen((o) => !o)}
                >
                  VWall
                </button>
                {vwallMenuOpen ? (
                  <div
                    id={vwallMenuId}
                    className="ro-ingest-live-hex-menu-panel vfl-header-vwall-menu"
                    role="menu"
                    aria-labelledby={vwallMenuTriggerId}
                  >
                    <div className="ro-ingest-live-hex-menu-row ro-ingest-live-hex-menu-row--block">
                      <label className="ro-ingest-live-hex-menu-label" htmlFor="vfl-header-vwall-search">
                        Search
                      </label>
                      <input
                        id="vfl-header-vwall-search"
                        type="text"
                        className="ro-ingest-live-hex-paste-input"
                        placeholder="Images (empty = picsum)"
                        value={vwallSearch}
                        onChange={(e) => setVwallSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void loadVwallFeeds().then(() => closeVwallMenu())
                          }
                        }}
                      />
                    </div>
                    <div className="ro-ingest-live-hex-menu-row">
                      <button
                        type="button"
                        role="menuitem"
                        className="ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action"
                        disabled={vwallBusy}
                        onClick={() => {
                          void loadVwallFeeds().then(() => closeVwallMenu())
                        }}
                      >
                        {vwallBusy ? 'Loading…' : 'Load feeds'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action"
                        disabled={vwallTiles.length === 0}
                        onClick={() => {
                          clearVwallFeeds()
                          closeVwallMenu()
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="ro-ingest-live-hex-menu-row ro-ingest-live-hex-menu-row--block">
                      <a
                        href="https://fornevercollective.github.io/vwall/"
                        target="_blank"
                        rel="noreferrer"
                        className="ro-btn ro-btn-ghost ro-ingest-live-hex-menu-wide"
                      >
                        Open VWall wall…
                      </a>
                    </div>
                    {vwallTiles.length > 0 ? (
                      <p className="ro-ingest-live-hex-menu-hint muted" role="status">
                        {vwallTiles.length} feeds on the wall
                      </p>
                    ) : null}
                    {vwallErr ? (
                      <p className="ro-ingest-live-hex-menu-hint muted" role="alert">
                        {vwallErr}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <section className="vfl-panel vfl-stage-effects vfl-header-effects" aria-label="Effects preset">
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
                {depthZones ? (
                  <div className="vfl-gsplat-tune" aria-label="Depth proxy tuning">
                    <p className="vfl-media-hint muted vfl-gsplat-tune-intro">
                      CPU depth proxy (gsplat-inspired weights) — optimizable for experiments.
                    </p>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-gs-r">
                        Radial
                      </label>
                      <input
                        id="vfl-gs-r"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={gsplatEffective.radial}
                        onChange={(e) => setGsplatField('radial', Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{gsplatEffective.radial.toFixed(2)}</span>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-gs-v">
                        Vertical
                      </label>
                      <input
                        id="vfl-gs-v"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={gsplatEffective.vertical}
                        onChange={(e) => setGsplatField('vertical', Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{gsplatEffective.vertical.toFixed(2)}</span>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-gs-l">
                        Luminance
                      </label>
                      <input
                        id="vfl-gs-l"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={gsplatEffective.luminance}
                        onChange={(e) => setGsplatField('luminance', Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{gsplatEffective.luminance.toFixed(2)}</span>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-gs-zp">
                        zPow
                      </label>
                      <input
                        id="vfl-gs-zp"
                        type="range"
                        min={0.4}
                        max={2.8}
                        step={0.02}
                        value={gsplatEffective.zPow}
                        onChange={(e) => setGsplatField('zPow', Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{gsplatEffective.zPow.toFixed(2)}</span>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-gs-sh">
                        Sweep Hz
                      </label>
                      <input
                        id="vfl-gs-sh"
                        type="range"
                        min={0.2}
                        max={3.5}
                        step={0.05}
                        value={gsplatEffective.sweepHz}
                        onChange={(e) => setGsplatField('sweepHz', Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{gsplatEffective.sweepHz.toFixed(2)}</span>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-gs-sm">
                        Sweep zM
                      </label>
                      <input
                        id="vfl-gs-sm"
                        type="range"
                        min={1}
                        max={9}
                        step={0.05}
                        value={gsplatEffective.sweepZM}
                        onChange={(e) => setGsplatField('sweepZM', Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{gsplatEffective.sweepZM.toFixed(2)}</span>
                    </div>
                    <button type="button" className="ro-btn ro-btn-ghost vfl-gsplat-reset" onClick={() => setGsplatTune({})}>
                      Reset depth proxy
                    </button>
                  </div>
                ) : null}
            </section>
          </div>
          <section className="vfl-panel vfl-feeds-hub" aria-label="Add and share video feeds for the wall">
            <h2 className="vfl-panel-title vfl-feeds-hub-title">Add feeds</h2>
            <p className="vfl-feeds-lead muted">
              Stack camera, streams, and image tiles into one interactive wall — browse with the feed strip,
              pin a source on the stage, and share a <code className="ro-drawer-code">#vfl-room=</code> link so other
              tabs can post hex frames on{' '}
              <code className="ro-drawer-code">{liveHexChannelForRoom(roomId)}</code>.
            </p>
            <div className="vfl-feeds-grid">
              <div className="vfl-feeds-block">
                <h3 className="vfl-feeds-block-title vfl-room-link-label">
                  <RoomLinkStatusLight status={roomLinkStatus} />
                  Room
                </h3>
                {isInRoom ? (
                  <p className="vfl-feeds-status muted" role="status">
                    In <code className="ro-drawer-code">{roomId}</code> as{' '}
                    <code className="ro-drawer-code">{peerId}</code>
                  </p>
                ) : (
                  <p className="vfl-feeds-status muted">Solo — global hex channel until you create or join a room.</p>
                )}
                <div className="vfl-feeds-actions">
                  <button type="button" className="ro-btn ro-btn-ghost" onClick={() => void startNewRoom()}>
                    New room
                  </button>
                  <button type="button" className="ro-btn ro-btn-ghost" onClick={() => void copyRoomLink()}>
                    Copy invite link
                  </button>
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    disabled={feedOrder.length <= 1}
                    onClick={() => {
                      if (feedOrder.length <= 1) return
                      setActiveIdx(Math.floor(Math.random() * feedOrder.length))
                    }}
                    title="Jump carousel to a random feed on the wall"
                  >
                    Shuffle feed
                  </button>
                </div>
                <div className="vfl-yt-stream-row">
                  <input
                    type="text"
                    className="vfl-yt-stream-input"
                    placeholder="Paste #vfl-room=… or full lab URL"
                    value={roomLinkPaste}
                    onChange={(e) => setRoomLinkPaste(e.target.value)}
                    aria-label="Room invite link"
                  />
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    title="Create a new room and put its invite link here"
                    onClick={() => {
                      void (async () => {
                        const url = await startNewRoom()
                        if (url) setRoomLinkPaste(url)
                      })()
                    }}
                  >
                    Make
                  </button>
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    onClick={() => void joinRoomFromPaste(roomLinkPaste)}
                  >
                    Join room
                  </button>
                </div>
                {roomShareUrl ? (
                  <input
                    type="text"
                    className="vfl-yt-stream-input vfl-feeds-share-url"
                    readOnly
                    value={roomShareUrl}
                    aria-label="Current room share URL"
                    onFocus={(e) => e.target.select()}
                  />
                ) : null}
                {roomErr ? (
                  <p className="vfl-yt-stream-err muted" role="alert">
                    {roomErr}
                  </p>
                ) : null}
              </div>
              <div className="vfl-feeds-block">
                <h3 className="vfl-feeds-block-title">Video feeds</h3>
                <p className="vfl-yt-stream-hint muted">
                  YouTube, <code className="ro-drawer-code">peer:…</code>, or{' '}
                  <code className="ro-drawer-code">demo-alpha</code> keys. Mirror stream needs{' '}
                  <code className="ro-drawer-code">VITE_FFMPEG_STREAM_URL_TEMPLATE</code>.
                </p>
                <div className="vfl-yt-stream-row">
                  <input
                    type="text"
                    className="vfl-yt-stream-input"
                    placeholder="https://youtube.com/watch?v=… or peer:abc12"
                    value={feedLinkPaste}
                    onChange={(e) => setFeedLinkPaste(e.target.value)}
                    aria-label="Video feed link"
                  />
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    onClick={() => applyFeedFromPaste(feedLinkPaste)}
                  >
                    Add feed
                  </button>
                  {ytFeedId ? (
                    <button type="button" className="ro-btn ro-btn-ghost" onClick={removeYtStreamFeed}>
                      Remove YT
                    </button>
                  ) : null}
                </div>
                <label className="vfl-check">
                  <input type="checkbox" checked={demoPeers} onChange={(e) => setDemoPeers(e.target.checked)} />
                  Synthetic peers <code className="ro-drawer-code">demo-alpha</code> /{' '}
                  <code className="ro-drawer-code">demo-beta</code>
                </label>
                {ytFeedId ? (
                  <p className="vfl-yt-stream-status muted" role="status">
                    Active <code className="ro-drawer-code">{ytHexFeedKey(ytFeedId)}</code>
                  </p>
                ) : null}
                {ytStreamErr ? (
                  <p className="vfl-yt-stream-err muted" role="alert">
                    {ytStreamErr}
                  </p>
                ) : null}
              </div>
              <div className="vfl-feeds-block vfl-feeds-block--vwall">
                <h3 className="vfl-feeds-block-title">
                  VWall feeds{' '}
                  <a
                    href="https://fornevercollective.github.io/vwall/"
                    target="_blank"
                    rel="noreferrer"
                    className="vfl-feeds-vwall-link"
                  >
                    (open VWall)
                  </a>
                </h3>
                <p className="vfl-yt-stream-hint muted">
                  Image wall search from{' '}
                  <a href="https://github.com/fornevercollective/vwall" target="_blank" rel="noreferrer">
                    fornevercollective/vwall
                  </a>
                  — Google image search when API + CX are set, else picsum tiles. Each tile becomes a{' '}
                  <code className="ro-drawer-code">vwall:…</code> hex feed on the bump rail.
                </p>
                <div className="vfl-yt-stream-row">
                  <input
                    type="text"
                    className="vfl-yt-stream-input"
                    placeholder="Search images (empty = picsum batch)"
                    value={vwallSearch}
                    onChange={(e) => setVwallSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void loadVwallFeeds()
                    }}
                    aria-label="VWall image search"
                  />
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    disabled={vwallBusy}
                    onClick={() => void loadVwallFeeds()}
                  >
                    {vwallBusy ? 'Loading…' : 'Load feeds'}
                  </button>
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    disabled={vwallTiles.length === 0}
                    onClick={clearVwallFeeds}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="ro-btn ro-btn-ghost"
                    onClick={() => {
                      const next = vwallSeed + 1
                      setVwallSeed(next)
                      void loadVwallFeeds(next)
                    }}
                    title="New picsum seed (VWall Reseed)"
                  >
                    Reseed
                  </button>
                </div>
                <div className="vfl-vwall-count-row">
                  <label className="vfl-media-label" htmlFor="vfl-vwall-count">
                    Count {vwallCount}
                  </label>
                  <input
                    id="vfl-vwall-count"
                    type="range"
                    min={8}
                    max={120}
                    step={4}
                    value={vwallCount}
                    onChange={(e) => setVwallCount(Number(e.target.value))}
                  />
                </div>
                {vwallTiles.length > 0 ? (
                  <p className="vfl-yt-stream-status muted" role="status">
                    {vwallTiles.length} VWall feeds active
                  </p>
                ) : null}
                {vwallErr ? (
                  <p className="vfl-yt-stream-err muted" role="alert">
                    {vwallErr}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="ro-btn ro-btn-ghost vfl-vwall-settings-toggle"
                  aria-expanded={vwallShowSettings}
                  onClick={() => setVwallShowSettings((o) => !o)}
                >
                  {vwallShowSettings ? 'Hide' : 'Show'} Google API settings
                </button>
                {vwallShowSettings ? (
                  <div className="vfl-vwall-settings">
                    <label>
                      API key
                      <input
                        type="text"
                        className="vfl-yt-stream-input"
                        placeholder="AIza…"
                        value={vwallApiKey}
                        onChange={(e) => setVwallApiKey(e.target.value)}
                      />
                    </label>
                    <label>
                      Search engine ID (cx)
                      <input
                        type="text"
                        className="vfl-yt-stream-input"
                        placeholder="0123456789:abc…"
                        value={vwallCx}
                        onChange={(e) => setVwallCx(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="ro-btn ro-btn-ghost"
                      onClick={() => {
                        saveVwallGoogleCredentials(vwallApiKey, vwallCx)
                        setVwallErr(null)
                      }}
                    >
                      Save (localStorage)
                    </button>
                    <p className="vfl-yt-stream-hint muted">
                      Same keys as VWall. Optional build-time{' '}
                      <code className="ro-drawer-code">VITE_VWALL_GOOGLE_API_KEY</code> /{' '}
                      <code className="ro-drawer-code">VITE_VWALL_GOOGLE_CX</code>. Dev uses{' '}
                      <code className="ro-drawer-code">/vwall-google-proxy</code>.
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="vfl-feeds-block vfl-feeds-chat">
                <h3 className="vfl-feeds-block-title">Room chat</h3>
                <div className="vfl-chat-log" role="log" aria-live="polite" aria-relevant="additions">
                  {!isInRoom ? (
                    <p className="muted vfl-chat-empty">Join or create a room to chat with peers on the same link.</p>
                  ) : chatLog.length === 0 ? (
                    <p className="muted vfl-chat-empty">No messages yet — say hi.</p>
                  ) : (
                    chatLog.map((m) => (
                      <div key={`${m.from}-${m.t}-${m.text}`} className="vfl-chat-line">
                        <code className="ro-drawer-code vfl-chat-from">{m.from}</code>
                        <span>{m.text}</span>
                      </div>
                    ))
                  )}
                </div>
                <form
                  className="vfl-chat-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!chatDraft.trim() || !isInRoom) return
                    postChat(chatDraft)
                    setChatDraft('')
                  }}
                >
                  <input
                    type="text"
                    className="vfl-yt-stream-input"
                    placeholder={isInRoom ? 'Message room…' : 'Join a room to chat'}
                    value={chatDraft}
                    disabled={!isInRoom}
                    onChange={(e) => setChatDraft(e.target.value)}
                    aria-label="Room chat message"
                  />
                  <button type="submit" className="ro-btn ro-btn-ghost" disabled={!isInRoom || !chatDraft.trim()}>
                    Send
                  </button>
                </form>
              </div>
            </div>
          </section>
          <h1 className="vfl-title">Video feeds lab</h1>
          <p className="vfl-lead">
            An interactive wall of live video feeds — hex tiles on the rail, one feed on the main stage. Channel{' '}
            <code className="ro-drawer-code">{liveHexChannelForRoom(roomId)}</code>, carousel + pin,
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

      <nav className="vfl-lab-view-nav" aria-label="Lab view">
        <button
          type="button"
          role="tab"
          aria-selected={labView === 'stage'}
          className={`ro-btn ro-btn-ghost${labView === 'stage' ? ' is-active' : ''}`}
          onClick={() => setLabView('stage')}
        >
          Stage
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={labView === 'vwall'}
          className={`ro-btn ro-btn-ghost${labView === 'vwall' ? ' is-active' : ''}`}
          onClick={() => setLabView('vwall')}
        >
          VWall
        </button>
        <span className="vfl-lab-view-meta muted">
          {feedOrder.length} feed{feedOrder.length === 1 ? '' : 's'} · mosaic shows latest hex per source
        </span>
      </nav>

      <div className={`vfl-layout${labView === 'vwall' ? ' vfl-layout--vwall' : ''}`}>
        <main className="vfl-main">
          {labView === 'vwall' ? (
            <section className="vfl-vwall-pane" aria-label="VWall — all live feeds">
              <div className="vfl-vwall-toolbar">
                <input
                  type="text"
                  className="vfl-yt-stream-input"
                  placeholder="Image search (empty = picsum batch)"
                  value={vwallSearch}
                  onChange={(e) => setVwallSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loadVwallFeeds()
                  }}
                  aria-label="VWall image search"
                />
                <button
                  type="button"
                  className="ro-btn ro-btn-ghost"
                  disabled={vwallBusy}
                  onClick={() => void loadVwallFeeds()}
                >
                  {vwallBusy ? 'Loading…' : 'Load images'}
                </button>
                <label className="vfl-check">
                  <span className="vfl-media-label">Count {vwallCount}</span>
                  <input
                    type="range"
                    min={8}
                    max={120}
                    step={4}
                    value={vwallCount}
                    onChange={(e) => setVwallCount(Number(e.target.value))}
                  />
                </label>
                <div className="vfl-vwall-layout-toggle" role="group" aria-label="Wall layout">
                  <button
                    type="button"
                    className={`ro-btn ro-btn-ghost${vwallWallLayout === 'dense' ? ' is-active' : ''}`}
                    onClick={() => setVwallWallLayout('dense')}
                  >
                    Dense
                  </button>
                  <button
                    type="button"
                    className={`ro-btn ro-btn-ghost${vwallWallLayout === 'checker' ? ' is-active' : ''}`}
                    onClick={() => setVwallWallLayout('checker')}
                  >
                    Checker
                  </button>
                </div>
                <a
                  href="https://fornevercollective.github.io/vwall/"
                  target="_blank"
                  rel="noreferrer"
                  className="ro-btn ro-btn-ghost"
                >
                  Open GPU VWall
                </a>
              </div>
              {vwallErr ? (
                <p className="vfl-yt-stream-err muted" role="alert">
                  {vwallErr}
                </p>
              ) : null}
              <VflFeedMosaic
                variant="wall"
                wallLayout={vwallWallLayout}
                framesRef={framesRef}
                feedKeys={feedOrder}
                thumbSeq={feedThumbSeq}
                activeFeedKey={displayKey}
                offThumbRef={bumpOffRef}
                onSelectFeed={(fk) => {
                  const idx = feedOrder.indexOf(fk)
                  if (idx >= 0) setActiveIdx(idx)
                  setLabView('stage')
                }}
              />
              <p className="vfl-vwall-hint muted">
                One tile per feed (camera, peers, YouTube, VWall images, demos). Click a tile to focus it on the
                stage. Same hex pipeline as{' '}
                <a href="https://github.com/fornevercollective/vwall" target="_blank" rel="noreferrer">
                  fornevercollective/vwall
                </a>
                , optimized for live updates in-page.
              </p>
            </section>
          ) : (
          <div className="vfl-stage-bump">
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
                  <canvas
                    ref={poseCanvasRef}
                    className="vfl-pose-overlay"
                    width={STAGE_PX}
                    height={STAGE_PX}
                    aria-hidden
                  />
                </div>
                {captionsOn && captionText.trim() ? (
                  <div className="vfl-caption-overlay" aria-live="polite">
                    {captionText}
                  </div>
                ) : null}
              </div>
            </div>
            <VflBumpRail
              framesRef={framesRef}
              feedKeys={feedOrder}
              thumbSeq={feedThumbSeq}
              offThumbRef={bumpOffRef}
            />
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
                        onChange={(e) => {
                          const vol = Number(e.target.value) / 100
                          setAudioVol(vol)
                          const g = streamGainRef.current
                          if (g) g.gain.value = audioMuted ? 0 : vol
                        }}
                        aria-valuetext={`${Math.round(audioVol * 100)} percent`}
                      />
                    </div>
                    <label className="vfl-check">
                      <input
                        type="checkbox"
                        checked={audioMuted}
                        disabled={!streamAudioOn || !ytFeedId}
                        onChange={(e) => {
                          const muted = e.target.checked
                          setAudioMuted(muted)
                          const g = streamGainRef.current
                          if (g) g.gain.value = muted ? 0 : audioVol
                        }}
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
                    <div className="vfl-media-row vfl-media-row--spectrum-source">
                      <label className="vfl-media-label" htmlFor="vfl-spec-src">
                        Source
                      </label>
                      <select
                        id="vfl-spec-src"
                        className="vfl-video-rate-select"
                        value={spectrumSource}
                        onChange={(e) => setSpectrumSource(e.target.value as 'stream' | 'mic')}
                        aria-label="Spectrum analyzer source"
                      >
                        <option value="stream">YouTube stream</option>
                        <option value="mic">Camera mic</option>
                      </select>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-fft">
                        FFT size
                      </label>
                      <select
                        id="vfl-fft"
                        className="vfl-video-rate-select"
                        value={acousticFft}
                        onChange={(e) => setAcousticFft(Number(e.target.value) as 256 | 512 | 1024 | 2048)}
                      >
                        {[256, 512, 1024, 2048].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="vfl-media-row">
                      <label className="vfl-media-label" htmlFor="vfl-ac-sm">
                        Smoothing
                      </label>
                      <input
                        id="vfl-ac-sm"
                        type="range"
                        min={0}
                        max={0.99}
                        step={0.01}
                        value={acousticSmooth}
                        onChange={(e) => setAcousticSmooth(Number(e.target.value))}
                      />
                      <span className="vfl-media-val">{acousticSmooth.toFixed(2)}</span>
                    </div>
                    <canvas
                      ref={waveformCanvasRef}
                      className="vfl-waveform-canvas"
                      aria-label={
                        spectrumSource === 'mic'
                          ? cameraMicOn
                            ? 'Camera microphone frequency spectrum'
                            : 'Spectrum idle — turn on camera mic'
                          : streamAudioOn
                            ? 'Stream frequency spectrum'
                            : 'Spectrum idle — enable stream audio'
                      }
                    />
                  </div>
                  <div className="vfl-media-block vfl-media-block--camera-lab">
                    <h3 className="vfl-media-block-title">Camera + voice</h3>
                    <p className="vfl-media-hint muted">
                      Pose overlay uses MediaPipe (CDN). Voice uses the same chat route as Overview; TTS uses the browser{' '}
                      <code className="ro-drawer-code">speechSynthesis</code> API. Turn on Camera → Mic for spectrum and
                      speech recognition.
                    </p>
                    <label className="vfl-check">
                      <input
                        type="checkbox"
                        checked={poseEnabled}
                        disabled={!cameraOn}
                        onChange={(e) => {
                          const on = e.target.checked
                          setPoseEnabled(on)
                          if (on) setPoseErr(null)
                        }}
                      />
                      Pose skeleton overlay (needs camera)
                    </label>
                    {poseErr ? (
                      <p className="vfl-pose-err muted" role="alert">
                        {poseErr}
                      </p>
                    ) : null}
                    <label className="vfl-voice-prompt-label muted" htmlFor="vfl-voice-prompt">
                      Prompt for the model (then speak)
                    </label>
                    <textarea
                      id="vfl-voice-prompt"
                      className="vfl-caption-input"
                      rows={2}
                      value={voicePrompt}
                      onChange={(e) => setVoicePrompt(e.target.value)}
                      disabled={voiceBusy}
                    />
                    <div className="vfl-voice-actions">
                      <button type="button" className="ro-btn ro-btn-ghost" disabled={voiceBusy} onClick={runVoiceAsk}>
                        {voiceBusy ? 'Asking…' : 'Ask (speak reply)'}
                      </button>
                      <button type="button" className="ro-btn ro-btn-ghost" disabled={voiceBusy} onClick={runListenOnce}>
                        Listen once
                      </button>
                    </div>
                    {voiceLog.trim() ? (
                      <p className="vfl-voice-log muted" aria-live="polite">
                        {voiceLog}
                      </p>
                    ) : null}
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
                </div>
              </section>
          </div>
          )}

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
