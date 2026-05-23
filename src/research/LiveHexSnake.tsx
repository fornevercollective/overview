import { useCallback, useEffect, useRef, useState } from 'react'
import {
  drawHexFrame,
  HEX_CAMERA_LOOKS,
  isHexFrameMsg,
  luminanceHexFromImageData,
  type HexDecodeMode,
  type HexFrameMsg,
  LIVE_HEX_DOCUMENT_CHANNEL,
} from './liveHexCodec'
import { liveHexChannelForRoom } from './vfl-room-share'
import {
  createSnakeState,
  queueSnakeDir,
  stepSnake,
  type SnakeDir,
} from './liveHexSnakeEngine'
import './live-hex-snake.css'

const CELL_PX = 36
const COLS = 18
const ROWS = 14
const CAMERA_GRID = 36
const MIN_FRAME_MS = 100
const SNAKE_TICK_MS = 110
const MAX_TRAIL = 512
const CAMERA_FEED = '__snake_cam__'

export type LiveHexSnakeProps = {
  onBack: () => void
  onOpenVideoLab?: () => void
}

type TrailFrame = {
  hex: number[]
  res: number
  mode: string
}

function dirFromKey(key: string): SnakeDir | null {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up'
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down'
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left'
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right'
    default:
      return null
  }
}

export default function LiveHexSnake({ onBack, onOpenVideoLab }: LiveHexSnakeProps) {
  const [snake, setSnake] = useState(() => createSnakeState(COLS, ROWS))
  const [paused, setPaused] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)
  const [look, setLook] = useState<HexDecodeMode>('gray')
  const [cameraErr, setCameraErr] = useState<string | null>(null)
  const [trailLen, setTrailLen] = useState(0)
  const [liveActive, setLiveActive] = useState(false)

  const boardRef = useRef<HTMLCanvasElement>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const offHexRef = useRef<HTMLCanvasElement | null>(null)
  const trailRef = useRef<TrailFrame[]>([])
  const snakeRef = useRef(snake)
  const videoRef = useRef<HTMLVideoElement>(null)
  const capRef = useRef<HTMLCanvasElement>(null)
  const camRafRef = useRef(0)
  const lastFrameAt = useRef(0)
  const liveThumbRef = useRef<HTMLCanvasElement>(null)
  const histRef = useRef<(HTMLCanvasElement | null)[]>([null, null, null])

  useEffect(() => {
    snakeRef.current = snake
  }, [snake])

  const pushTrail = useCallback((msg: HexFrameMsg) => {
    const res = Math.floor(msg.res)
    const hex = Uint8Array.from(msg.hex)
    if (hex.length !== res * res) return
    const buf = trailRef.current
    buf.push({ hex: Array.from(hex), res, mode: typeof msg.mode === 'string' ? msg.mode : 'gray' })
    if (buf.length > MAX_TRAIL) buf.splice(0, buf.length - MAX_TRAIL)
    setTrailLen(buf.length)
    setLiveActive(true)

    const live = liveThumbRef.current
    const off = offHexRef.current
    if (live && off) {
      drawHexFrame(live, off, hex, res, look, CELL_PX)
    }
    const [h1, h2, h3] = histRef.current
    if (live && h1 && h2 && h3) {
      const h1ctx = h1.getContext('2d')
      const h2ctx = h2.getContext('2d')
      const h3ctx = h3.getContext('2d')
      if (h1ctx && h2ctx && h3ctx) {
        h3ctx.clearRect(0, 0, CELL_PX, CELL_PX)
        h3ctx.drawImage(h2, 0, 0)
        h2ctx.clearRect(0, 0, CELL_PX, CELL_PX)
        h2ctx.drawImage(h1, 0, 0)
        h1ctx.clearRect(0, 0, CELL_PX, CELL_PX)
        h1ctx.drawImage(live, 0, 0)
      }
    }
  }, [look])

  const applyChannelFrame = useCallback(
    (data: unknown) => {
      if (!isHexFrameMsg(data)) return
      const now = performance.now()
      if (now - lastFrameAt.current < MIN_FRAME_MS) return
      lastFrameAt.current = now
      pushTrail(data)
    },
    [pushTrail],
  )

  useEffect(() => {
    let ch: BroadcastChannel | null = null
    try {
      ch = new BroadcastChannel(LIVE_HEX_DOCUMENT_CHANNEL)
      ch.addEventListener('message', (ev) => applyChannelFrame(ev.data))
    } catch {
      /* ignore */
    }
    return () => ch?.close()
  }, [applyChannelFrame])

  useEffect(() => {
    let stream: MediaStream | null = null
    const stopTracks = () => {
      if (!stream) return
      for (const t of stream.getTracks()) t.stop()
      stream = null
    }

    if (!cameraOn) {
      const v = videoRef.current
      const so = v?.srcObject
      if (so && typeof (so as MediaStream).getTracks === 'function') {
        for (const t of (so as MediaStream).getTracks()) t.stop()
      }
      if (v) v.srcObject = null
      cancelAnimationFrame(camRafRef.current)
      return stopTracks
    }

    let cancelled = false
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 } },
          audio: false,
        })
        if (cancelled) {
          stopTracks()
          return
        }
        const v = videoRef.current
        const cap = capRef.current
        if (!v || !cap) return
        v.srcObject = stream
        await v.play()
        cap.width = CAMERA_GRID
        cap.height = CAMERA_GRID
        const ctx = cap.getContext('2d', { willReadFrequently: true })
        if (!ctx) return

        const sample = () => {
          if (cancelled || !cameraOn) return
          if (v.readyState >= 2) {
            ctx.drawImage(v, 0, 0, CAMERA_GRID, CAMERA_GRID)
            try {
              const id = ctx.getImageData(0, 0, CAMERA_GRID, CAMERA_GRID)
              const hex = luminanceHexFromImageData(id)
              const now = performance.now()
              if (now - lastFrameAt.current >= MIN_FRAME_MS) {
                lastFrameAt.current = now
                pushTrail({
                  type: 'hexframe',
                  hex,
                  res: CAMERA_GRID,
                  mode: look,
                  feedKey: CAMERA_FEED,
                  t: now,
                })
              }
            } catch {
              /* taint */
            }
          }
          camRafRef.current = requestAnimationFrame(sample)
        }
        camRafRef.current = requestAnimationFrame(sample)
      } catch (e) {
        setCameraErr(e instanceof Error ? e.message : 'Camera failed')
        setCameraOn(false)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(camRafRef.current)
      stopTracks()
    }
  }, [cameraOn, look, pushTrail])

  const restart = useCallback(() => {
    setSnake(createSnakeState(COLS, ROWS))
    setPaused(false)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (paused) return
      setSnake((s) => {
        const next = stepSnake(s)
        snakeRef.current = next
        return next
      })
    }, SNAKE_TICK_MS)
    return () => window.clearInterval(id)
  }, [paused])

  const paintBoard = useCallback(() => {
    const canvas = boardRef.current
    if (!canvas) return
    const w = COLS * CELL_PX
    const h = ROWS * CELL_PX
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let scratch = scratchRef.current
    if (!scratch) {
      scratch = document.createElement('canvas')
      scratchRef.current = scratch
    }
    scratch.width = CELL_PX
    scratch.height = CELL_PX
    let off = offHexRef.current
    if (!off) {
      off = document.createElement('canvas')
      offHexRef.current = off
    }

    const g = getComputedStyle(document.documentElement)
    const bg = g.getPropertyValue('--code-bg').trim() || '#f4f4f5'
    const foodFill = g.getPropertyValue('--ro-accent').trim() || '#6366f1'
    const s = snakeRef.current
    const trail = trailRef.current

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    ctx.fillStyle = foodFill
    ctx.fillRect(s.food.x * CELL_PX + 4, s.food.y * CELL_PX + 4, CELL_PX - 8, CELL_PX - 8)

    for (let i = 0; i < s.body.length; i++) {
      const seg = s.body[i]!
      const frame = trail.length > 0 ? trail[Math.max(0, trail.length - 1 - i)] : null
      const px = seg.x * CELL_PX
      const py = seg.y * CELL_PX
      if (frame) {
        const hex = Uint8Array.from(frame.hex)
        drawHexFrame(scratch, off, hex, frame.res, frame.mode, CELL_PX)
        ctx.drawImage(scratch, px, py)
      } else {
        ctx.fillStyle =
          i === 0 ? foodFill : `color-mix(in srgb, ${foodFill} 40%, ${bg})`
        ctx.fillRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2)
      }
      if (i === 0) {
        ctx.strokeStyle = foodFill
        ctx.lineWidth = 2
        ctx.strokeRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2)
      }
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      paintBoard()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [paintBoard, snake, trailLen, look])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        restart()
        return
      }
      const d = dirFromKey(e.key)
      if (!d) return
      e.preventDefault()
      setSnake((s) => queueSnakeDir(s, d))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [restart])

  const onBoardKey = (e: React.KeyboardEvent) => {
    const d = dirFromKey(e.key)
    if (!d) return
    e.preventDefault()
    setSnake((s) => queueSnakeDir(s, d))
  }

  return (
    <div className="ro-shell hex-snake-page">
      <header className="hex-snake-header">
        <button type="button" className="ro-btn ro-btn-ghost" onClick={onBack}>
          ← Workspace
        </button>
        <div className="hex-snake-header-text">
          <h1 className="hex-snake-title">Hex Snake</h1>
          <p className="hex-snake-lead">
            Arcade snake whose body is a motion trail of live hex video frames — same{' '}
            <code className="ro-drawer-code">overview-live-hex</code> pipeline as the workspace strip and Video
            Feeds Lab. Inspired by classic browser games (e.g. mueee games); each segment shows an older frame
            from the feed.
          </p>
        </div>
        <div className="hex-snake-scoreboard" aria-live="polite">
          <span>
            Score <strong>{snake.score}</strong>
          </span>
          <span>
            Length <strong>{snake.body.length}</strong>
          </span>
          <span>
            Trail <strong>{trailLen}</strong>
          </span>
        </div>
      </header>

      <div className="hex-snake-controls">
        <button type="button" className="ro-btn ro-btn-ghost" onClick={() => setCameraOn((c) => !c)}>
          {cameraOn ? 'Camera on' : 'Camera off'}
        </button>
        <label className="vfl-check">
          Look
          <select
            className="vfl-video-rate-select"
            value={look}
            onChange={(e) => setLook(e.target.value as HexDecodeMode)}
            aria-label="Hex decode look"
          >
            {HEX_CAMERA_LOOKS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ro-btn ro-btn-ghost" onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="ro-btn ro-btn-ghost" onClick={restart}>
          Restart
        </button>
        {onOpenVideoLab ? (
          <button type="button" className="ro-btn ro-btn-ghost" onClick={onOpenVideoLab}>
            Video Feeds Lab
          </button>
        ) : null}
      </div>

      <div className="hex-snake-layout">
        <div className="hex-snake-board-wrap">
          <div className="hex-snake-board-outer">
            <canvas
              ref={boardRef}
              className="hex-snake-board"
              tabIndex={0}
              role="img"
              aria-label="Snake board — arrow keys or WASD to steer"
              onKeyDown={onBoardKey}
            />
            {!snake.alive ? (
              <div className="hex-snake-overlay" aria-hidden>
                Game over — press Restart or R
              </div>
            ) : paused ? (
              <div className="hex-snake-overlay" aria-hidden>
                Paused — Space to resume
              </div>
            ) : null}
          </div>
          <p className={`hex-snake-status${snake.alive ? '' : ' is-dead'}`}>
            {snake.alive
              ? 'Steer with arrow keys or WASD · Space pause · R restart'
              : 'Collision — restart to play again'}
          </p>
        </div>

        <aside className="hex-snake-side">
          <div className="hex-snake-strip">
            <p className="hex-snake-strip-label">Motion trail (newest → oldest)</p>
            <canvas
              ref={(el) => {
                histRef.current[2] = el
              }}
              className="hex-snake-thumb"
              width={CELL_PX}
              height={CELL_PX}
              aria-hidden
            />
            <canvas
              ref={(el) => {
                histRef.current[1] = el
              }}
              className="hex-snake-thumb"
              width={CELL_PX}
              height={CELL_PX}
              aria-hidden
            />
            <canvas
              ref={(el) => {
                histRef.current[0] = el
              }}
              className="hex-snake-thumb"
              width={CELL_PX}
              height={CELL_PX}
              aria-hidden
            />
            <canvas
              ref={liveThumbRef}
              className={`hex-snake-thumb${liveActive ? ' is-live' : ''}`}
              width={CELL_PX}
              height={CELL_PX}
              role="img"
              aria-label="Live hex frame"
            />
          </div>
          <p className="hex-snake-hint muted">
            Channel <code className="ro-drawer-code">{LIVE_HEX_DOCUMENT_CHANNEL}</code> and room{' '}
            <code className="ro-drawer-code">{liveHexChannelForRoom(null)}</code> frames also extend the trail
            when Video Feeds Lab or a peer is publishing in another tab.
          </p>
          {cameraErr ? (
            <p className="hex-snake-hint muted" role="alert">
              {cameraErr}
            </p>
          ) : null}
        </aside>
      </div>

      <video ref={videoRef} className="vfl-hidden-video" playsInline muted autoPlay aria-hidden />
      <canvas ref={capRef} className="vfl-hidden-cap" width={CAMERA_GRID} height={CAMERA_GRID} aria-hidden />
    </div>
  )
}
