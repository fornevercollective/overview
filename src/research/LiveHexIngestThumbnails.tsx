import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type HexFrameMsg,
  isHexFrameMsg,
  drawHexFrame,
  luminanceHexFromImageData,
  normalizeFeedKey,
  shiftCanvases,
} from './liveHexCodec'
import {
  decodeVflRoomSharePayload,
  encodeVflRoomShare,
  generatePeerFeedKey,
  generateRoomId,
  liveHexChannelForRoom,
  stashPendingFeedPaste,
  stashPendingRoomPaste,
  VFL_ROOM_HASH_PREFIX,
} from './vfl-room-share'

const LEGACY_HEXCAST_CHANNEL = 'hexcast-stream'

const CAMERA_FEED = '__camera__'
const DEFAULT_FEED = '__default__'

/** Downsampled grid for camera → hex strip (matches thumb size for a square pipeline). */
const CAMERA_GRID = 36

/** Match hero Go control height (~36px ingest row). */
const THUMB_PX = 36
const MIN_FRAME_INTERVAL_MS = 100
const HISTORY_SHIFT_MS = 2000
const STALE_MS = 6000

export type OverviewLiveHexPublishInput = {
  hex: number[] | Uint8Array
  res: number
  mode?: string
  feedKey?: string
}

export type OverviewLiveHexApi = {
  /** Same-tab: push one frame into the ingest thumbnail strip (no BroadcastChannel). */
  publishFrame: (input: OverviewLiveHexPublishInput) => void
}

declare global {
  interface Window {
    __OVERVIEW_LIVE_HEX__?: OverviewLiveHexApi
  }
}

function effectiveFeedKey(feedOrder: string[], activeIdx: number, pinnedKey: string | null): string {
  if (feedOrder.length === 0) return DEFAULT_FEED
  const at = feedOrder[Math.max(0, Math.min(activeIdx, feedOrder.length - 1))]!
  if (pinnedKey && feedOrder.includes(pinnedKey)) return pinnedKey
  return at
}

export type LiveHexIngestThumbnailsProps = {
  /** Opens the full-page video / hex feeds playground (optional). */
  onOpenVideoLab?: () => void
}

/**
 * Live + rolling stills from **document-local** sources:
 * - `BroadcastChannel('overview-live-hex')` — optional `feedKey` per collaborator for carousel + pin.
 * - `window.__OVERVIEW_LIVE_HEX__.publishFrame({ hex, res, mode?, feedKey? })`.
 *
 * Optional: **`VITE_RELAY_HEXCAST_STREAM=1`** listens on `hexcast-stream` (mueee legacy).
 */
export default function LiveHexIngestThumbnails({ onOpenVideoLab }: LiveHexIngestThumbnailsProps) {
  const [active, setActive] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user')
  const [cameraHexMode, setCameraHexMode] = useState<'gray' | 'color'>('gray')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [feedOrder, setFeedOrder] = useState<string[]>([DEFAULT_FEED])
  const [activeIdx, setActiveIdx] = useState(0)
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [feedPaste, setFeedPaste] = useState('')
  const [roomPaste, setRoomPaste] = useState('')
  const [roomIdFromHash, setRoomIdFromHash] = useState<string | null>(null)

  const displayIdx =
    feedOrder.length === 0 ? 0 : Math.min(Math.max(0, activeIdx), feedOrder.length - 1)

  const liveRef = useRef<HTMLCanvasElement>(null)
  const h1Ref = useRef<HTMLCanvasElement>(null)
  const h2Ref = useRef<HTMLCanvasElement>(null)
  const h3Ref = useRef<HTMLCanvasElement>(null)
  const offRef = useRef<HTMLCanvasElement | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement>(null)
  const cameraRafRef = useRef(0)

  const framesRef = useRef<Record<string, HexFrameMsg>>({})
  const selectionRef = useRef({ feedOrder, activeIdx, pinnedKey })
  useLayoutEffect(() => {
    selectionRef.current = { feedOrder, activeIdx, pinnedKey }
  }, [feedOrder, activeIdx, pinnedKey])

  const lastFrameAt = useRef(0)
  const staleTimer = useRef<number | undefined>(undefined)

  const touchStale = useCallback(() => {
    if (staleTimer.current !== undefined) window.clearTimeout(staleTimer.current)
    staleTimer.current = window.setTimeout(() => {
      staleTimer.current = undefined
      setActive(false)
    }, STALE_MS)
  }, [])

  const drawStoredFrame = useCallback((msg: HexFrameMsg) => {
    const res = Math.floor(msg.res)
    if (res < 8 || res > 512) return
    const hex = Uint8Array.from(msg.hex)
    if (hex.length !== res * res) return
    const mode = typeof msg.mode === 'string' ? msg.mode : 'gray'

    const live = liveRef.current
    let off = offRef.current
    if (!live) return
    if (!off && typeof document !== 'undefined') {
      off = document.createElement('canvas')
      offRef.current = off
    }
    if (!off) return
    drawHexFrame(live, off, hex, res, mode, THUMB_PX)
    setActive(true)
    touchStale()
  }, [touchStale])

  const applyFrame = useCallback(
    (msg: HexFrameMsg) => {
      const res = Math.floor(msg.res)
      if (res < 8 || res > 512) return
      const hex = Uint8Array.from(msg.hex)
      if (hex.length !== res * res) return
      const fk = normalizeFeedKey(msg.feedKey)
      const now = performance.now()
      if (now - lastFrameAt.current < MIN_FRAME_INTERVAL_MS) return
      lastFrameAt.current = now

      const normalized: HexFrameMsg = {
        type: 'hexframe',
        hex: Array.from(hex),
        res,
        mode: typeof msg.mode === 'string' ? msg.mode : 'gray',
        t: typeof msg.t === 'number' ? msg.t : now,
        feedKey: fk,
      }
      framesRef.current[fk] = normalized

      setFeedOrder((prev) => {
        if (prev.includes(fk)) return prev
        if (fk === DEFAULT_FEED && prev.length === 1 && prev[0] === DEFAULT_FEED) return prev
        return [...prev, fk]
      })

      const sel = selectionRef.current
      const eff = effectiveFeedKey(sel.feedOrder, sel.activeIdx, sel.pinnedKey)
      const drawMsg = framesRef.current[eff]
      if (!drawMsg) return
      drawStoredFrame(drawMsg)
    },
    [drawStoredFrame],
  )

  useLayoutEffect(() => {
    const eff = effectiveFeedKey(feedOrder, displayIdx, pinnedKey)
    const drawMsg = framesRef.current[eff]
    if (drawMsg) drawStoredFrame(drawMsg)
  }, [feedOrder, displayIdx, pinnedKey, drawStoredFrame])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (!hash.startsWith(VFL_ROOM_HASH_PREFIX)) return
    const payload = hash.slice(VFL_ROOM_HASH_PREFIX.length)
    void decodeVflRoomSharePayload(payload).then((data) => {
      if (data?.room) setRoomIdFromHash(data.room)
    })
  }, [])

  useEffect(() => {
    const channels: BroadcastChannel[] = []
    const onMsg = (ev: MessageEvent) => {
      if (!isHexFrameMsg(ev.data)) return
      applyFrame(ev.data)
    }

    const open = (name: string) => {
      try {
        const ch = new BroadcastChannel(name)
        ch.addEventListener('message', onMsg)
        channels.push(ch)
      } catch {
        /* ignore */
      }
    }

    open(liveHexChannelForRoom(roomIdFromHash))
    if (import.meta.env.VITE_RELAY_HEXCAST_STREAM === '1') {
      open(LEGACY_HEXCAST_CHANNEL)
    }

    const api: OverviewLiveHexApi = {
      publishFrame(input) {
        const raw = input.hex
        const hex = raw instanceof Uint8Array ? Array.from(raw) : raw
        applyFrame({
          type: 'hexframe',
          hex,
          res: input.res,
          mode: input.mode,
          feedKey: normalizeFeedKey(input.feedKey),
          t: performance.now(),
        })
      },
    }
    window.__OVERVIEW_LIVE_HEX__ = api

    const hist = window.setInterval(() => {
      const live = liveRef.current
      const a = h1Ref.current
      const b = h2Ref.current
      const c = h3Ref.current
      if (!live || !a || !b || !c) return
      shiftCanvases(live, a, b, c, THUMB_PX)
    }, HISTORY_SHIFT_MS)

    return () => {
      for (const ch of channels) {
        ch.removeEventListener('message', onMsg)
        ch.close()
      }
      if (window.__OVERVIEW_LIVE_HEX__ === api) {
        delete window.__OVERVIEW_LIVE_HEX__
      }
      window.clearInterval(hist)
      if (staleTimer.current !== undefined) window.clearTimeout(staleTimer.current)
    }
  }, [applyFrame, roomIdFromHash])

  const clearStaleTimer = useCallback(() => {
    if (staleTimer.current !== undefined) {
      window.clearTimeout(staleTimer.current)
      staleTimer.current = undefined
    }
  }, [])

  const stopCamera = useCallback(() => {
    setCameraOn(false)
    setCameraError(null)
    setFeedOrder((prev) => prev.filter((k) => k !== CAMERA_FEED))
    setPinnedKey((p) => (p === CAMERA_FEED ? null : p))
    setActiveIdx(0)
    setActive(false)
    clearStaleTimer()
  }, [clearStaleTimer])

  const startCamera = useCallback(() => {
    setCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API not available in this browser.')
      return
    }
    setFeedOrder((prev) => {
      const rest = prev.filter((k) => k !== CAMERA_FEED)
      return [CAMERA_FEED, ...rest]
    })
    setActiveIdx(0)
    setCameraOn(true)
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null

    const stopTracks = () => {
      if (!stream) return
      for (const t of stream.getTracks()) {
        t.stop()
      }
      stream = null
    }

    if (!cameraOn) {
      const v = videoRef.current
      const so = v?.srcObject
      if (so && typeof (so as MediaStream).getTracks === 'function') {
        for (const t of (so as MediaStream).getTracks()) {
          t.stop()
        }
      }
      if (v) {
        v.srcObject = null
      }
      return
    }

    const video = videoRef.current
    if (!video) {
      setCameraError('Video element missing.')
      setCameraOn(false)
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: cameraFacing },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        })
        if (cancelled) {
          for (const t of s.getTracks()) {
            t.stop()
          }
          return
        }
        stream = s
        video.srcObject = s
        try {
          await video.play()
        } catch (playErr) {
          for (const t of s.getTracks()) {
            t.stop()
          }
          stream = null
          video.srcObject = null
          throw playErr
        }
        setCameraError(null)
      } catch (e) {
        if (!cancelled) {
          setCameraError(e instanceof Error ? e.message : 'Could not open camera')
          setCameraOn(false)
          setFeedOrder((prev) => prev.filter((k) => k !== CAMERA_FEED))
          setPinnedKey((p) => (p === CAMERA_FEED ? null : p))
          setActiveIdx(0)
          setActive(false)
          clearStaleTimer()
        }
      }
    })()

    return () => {
      cancelled = true
      stopTracks()
      video.srcObject = null
    }
  }, [cameraOn, cameraFacing, clearStaleTimer])

  useEffect(() => {
    if (!cameraOn) return
    const v = videoRef.current
    const cap = captureCanvasRef.current
    if (!v || !cap) return
    cap.width = CAMERA_GRID
    cap.height = CAMERA_GRID
    const ctx = cap.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let stopped = false
    const tick = () => {
      if (stopped) return
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        ctx.drawImage(v, 0, 0, CAMERA_GRID, CAMERA_GRID)
        try {
          const id = ctx.getImageData(0, 0, CAMERA_GRID, CAMERA_GRID)
          const hex = luminanceHexFromImageData(id)
          applyFrame({
            type: 'hexframe',
            hex,
            res: CAMERA_GRID,
            mode: cameraHexMode,
            feedKey: CAMERA_FEED,
            t: performance.now(),
          })
        } catch {
          /* tainted or blocked read — skip frame */
        }
      }
      cameraRafRef.current = requestAnimationFrame(tick)
    }
    cameraRafRef.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      if (cameraRafRef.current) {
        cancelAnimationFrame(cameraRafRef.current)
        cameraRafRef.current = 0
      }
    }
  }, [cameraOn, applyFrame, cameraHexMode])

  const showStrip = active || cameraOn
  const nFeeds = feedOrder.length
  const atKey = feedOrder[displayIdx] ?? DEFAULT_FEED
  const pinActive = pinnedKey !== null && pinnedKey === atKey

  const cycleFeed = (delta: number) => {
    if (feedOrder.length <= 1) return
    setActiveIdx((i) => {
      const clamped = Math.min(Math.max(0, i), feedOrder.length - 1)
      return (clamped + delta + feedOrder.length) % feedOrder.length
    })
  }

  const onPinToggle = () => {
    if (pinActive) setPinnedKey(null)
    else setPinnedKey(atKey)
  }

  const thumbProps = {
    width: THUMB_PX,
    height: THUMB_PX,
    className: 'ro-ingest-live-hex-thumb',
    role: 'img' as const,
  }

  const menuDetailsRef = useRef<HTMLDetailsElement>(null)
  const closeMenu = () => {
    const d = menuDetailsRef.current
    if (d) d.open = false
  }

  return (
    <div className="ro-ingest-live-hex-bar">
      <button
        type="button"
        className="ro-btn ro-btn-ghost ro-ingest-live-hex-nav"
        aria-label="Previous feed"
        disabled={nFeeds <= 1}
        onClick={() => cycleFeed(-1)}
      >
        ◀
      </button>
      {showStrip ? (
        <div
          className="ro-ingest-live-hex-strip"
          aria-label="Live hex preview thumbnails"
          title="Camera, overview-live-hex channel, or window.__OVERVIEW_LIVE_HEX__.publishFrame"
        >
          <canvas ref={liveRef} {...thumbProps} aria-label="Live hex frame" />
          <canvas ref={h1Ref} {...thumbProps} aria-hidden />
          <canvas ref={h2Ref} {...thumbProps} aria-hidden />
          <canvas ref={h3Ref} {...thumbProps} aria-hidden />
        </div>
      ) : null}
      <button
        type="button"
        className="ro-btn ro-btn-ghost ro-ingest-live-hex-nav"
        aria-label="Next feed"
        disabled={nFeeds <= 1}
        onClick={() => cycleFeed(1)}
      >
        ▶
      </button>
      <button
        type="button"
        className={`ro-btn ro-btn-ghost ro-ingest-live-hex-nav${pinnedKey ? ' is-lit' : ''}`}
        aria-pressed={pinActive}
        aria-label={pinActive ? 'Unpin feed' : pinnedKey ? 'Pin this feed instead' : 'Pin current feed'}
        onClick={onPinToggle}
        title={pinnedKey ? `Pinned: ${pinnedKey}` : 'Pin current feed for multi-source chat'}
      >
        {pinActive ? 'Unpin' : 'Pin'}
      </button>

      <details ref={menuDetailsRef} className="ro-ingest-live-hex-details">
        <summary className="ro-btn ro-btn-ghost ro-ingest-live-hex-menu-summary">Live</summary>
        <div className="ro-ingest-live-hex-menu-panel" role="menu">
          <div className="ro-ingest-live-hex-menu-row">
            <span className="ro-ingest-live-hex-menu-label">Camera</span>
            <button
              type="button"
              role="menuitem"
              className="ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action"
              onClick={() => {
                if (cameraOn) stopCamera()
                else startCamera()
                closeMenu()
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
                closeMenu()
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
                closeMenu()
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
              className={`ro-btn ro-btn-ghost ro-ingest-live-hex-menu-action${cameraHexMode === 'color' ? ' is-active' : ''}`}
              onClick={() => {
                setCameraHexMode((m) => (m === 'gray' ? 'color' : 'gray'))
                closeMenu()
              }}
            >
              Thermal
            </button>
          </div>
          <div className="ro-ingest-live-hex-menu-row ro-ingest-live-hex-menu-row--block">
            <label className="ro-ingest-live-hex-menu-label" htmlFor="live-feed-paste">
              Video feed link
            </label>
            <input
              id="live-feed-paste"
              type="text"
              className="ro-ingest-live-hex-paste-input"
              placeholder="YouTube URL, peer:…, demo-alpha"
              value={feedPaste}
              onChange={(e) => setFeedPaste(e.target.value)}
            />
          </div>
          <div className="ro-ingest-live-hex-menu-row ro-ingest-live-hex-menu-row--block">
            <label className="ro-ingest-live-hex-menu-label" htmlFor="live-room-paste">
              Room link
            </label>
            <div className="ro-ingest-live-hex-paste-row">
              <input
                id="live-room-paste"
                type="text"
                className="ro-ingest-live-hex-paste-input"
                placeholder="#vfl-room=… or full lab URL"
                value={roomPaste}
                onChange={(e) => setRoomPaste(e.target.value)}
              />
              <button
                type="button"
                className="ro-btn ro-btn-ghost ro-ingest-live-hex-paste-btn"
                title="Generate a new room invite link"
                onClick={() => {
                  void (async () => {
                    const enc = await encodeVflRoomShare({
                      v: 1,
                      room: generateRoomId(),
                      peer: generatePeerFeedKey(),
                    })
                    if (enc.ok) setRoomPaste(enc.shareUrl)
                  })()
                }}
              >
                Make
              </button>
            </div>
          </div>
          {onOpenVideoLab ? (
            <div className="ro-ingest-live-hex-menu-row ro-ingest-live-hex-menu-row--block">
              <button
                type="button"
                role="menuitem"
                className="ro-btn ro-btn-ghost ro-ingest-live-hex-menu-wide"
                onClick={() => {
                  if (feedPaste.trim()) stashPendingFeedPaste(feedPaste)
                  if (roomPaste.trim()) stashPendingRoomPaste(roomPaste)
                  closeMenu()
                  onOpenVideoLab()
                }}
              >
                Open video feeds lab…
              </button>
            </div>
          ) : null}
          <p className="ro-ingest-live-hex-menu-hint muted">
            Room links use random <code className="ro-drawer-code">#vfl-room=</code> hashes. Channel{' '}
            <code className="ro-drawer-code">{liveHexChannelForRoom(roomIdFromHash)}</code>. Feed:{' '}
            <strong>{effectiveFeedKey(feedOrder, displayIdx, pinnedKey)}</strong>
          </p>
        </div>
      </details>

      {cameraError ? (
        <span className="ro-ingest-live-hex-camera-err muted" role="status">
          {cameraError}
        </span>
      ) : null}
      <video ref={videoRef} className="ro-ingest-live-hex-video" playsInline muted autoPlay />
      <canvas
        ref={captureCanvasRef}
        className="ro-ingest-live-hex-capture"
        width={CAMERA_GRID}
        height={CAMERA_GRID}
        aria-hidden
      />
    </div>
  )
}
