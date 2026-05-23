import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  emptyCubeFaces,
  FACE_IDS,
  FACE_PALETTE,
  facesToFacelets,
  sampleFaceFromImageData,
  SCAN_FACE_HINTS,
  solvedCubeFaces,
  cycleStickerColor,
  type CubeFaces,
  type FaceId,
  type FaceStickers,
} from './rubiksCube'
import { initRubiksSolver, solveFacelets } from './rubiksCubeSolve'
import './rubiks-cube-solver.css'

export type RubiksCubeSolverProps = {
  onBack: () => void
  onOpenVideoLab?: () => void
}

type InputMode = 'scan' | 'manual'

const NET_SLOTS: { id: FaceId; className: string }[] = [
  { id: 'U', className: 'rubiks-net-slot--u' },
  { id: 'L', className: 'rubiks-net-slot--l' },
  { id: 'F', className: 'rubiks-net-slot--f' },
  { id: 'R', className: 'rubiks-net-slot--r' },
  { id: 'B', className: 'rubiks-net-slot--b' },
  { id: 'D', className: 'rubiks-net-slot--d' },
]

function stickerStyle(id: FaceId): CSSProperties {
  const [r, g, b] = FACE_PALETTE[id].rgb
  return { background: `rgb(${r},${g},${b})` }
}

export default function RubiksCubeSolver({ onBack, onOpenVideoLab }: RubiksCubeSolverProps) {
  const [mode, setMode] = useState<InputMode>('scan')
  const [faces, setFaces] = useState<CubeFaces>(() => emptyCubeFaces())
  const [scanFace, setScanFace] = useState<FaceId>('U')
  const [cameraOn, setCameraOn] = useState(true)
  const [cameraErr, setCameraErr] = useState<string | null>(null)
  const [solverInit, setSolverInit] = useState<'loading' | 'ready' | 'err'>('loading')
  const [solveBusy, setSolveBusy] = useState(false)
  const [solution, setSolution] = useState<string | null>(null)
  const [solveErr, setSolveErr] = useState<string | null>(null)
  const [capturedCount, setCapturedCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const capRef = useRef<HTMLCanvasElement>(null)

  const facelets = useMemo(() => facesToFacelets(faces), [faces])

  useEffect(() => {
    let cancelled = false
    initRubiksSolver()
      .then(() => {
        if (!cancelled) setSolverInit('ready')
      })
      .catch(() => {
        if (!cancelled) setSolverInit('err')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!cameraOn || mode !== 'scan') return
    let stream: MediaStream | null = null
    let cancelled = false
    const videoEl = videoRef.current
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 540 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          for (const t of s.getTracks()) t.stop()
          return
        }
        stream = s
        if (videoEl) {
          videoEl.srcObject = s
          void videoEl.play().catch(() => {})
        }
        setCameraErr(null)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setCameraErr(e instanceof Error ? e.message : 'Camera unavailable')
          setCameraOn(false)
        }
      })
    return () => {
      cancelled = true
      if (stream) for (const t of stream.getTracks()) t.stop()
      if (videoEl) videoEl.srcObject = null
    }
  }, [cameraOn, mode])

  const captureScanFace = useCallback(() => {
    const v = videoRef.current
    const cap = capRef.current
    if (!v || !cap || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setSolveErr('Wait for camera preview before capturing.')
      return
    }
    cap.width = v.videoWidth
    cap.height = v.videoHeight
    const ctx = cap.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    const id = ctx.getImageData(0, 0, cap.width, cap.height)
    const sampled = sampleFaceFromImageData(id)
    setFaces((prev) => ({ ...prev, [scanFace]: sampled }))
    setCapturedCount((n) => n + 1)
    setSolution(null)
    setSolveErr(null)
    const idx = FACE_IDS.indexOf(scanFace)
    if (idx >= 0 && idx < FACE_IDS.length - 1) setScanFace(FACE_IDS[idx + 1]!)
  }, [scanFace])

  const setSticker = useCallback((face: FaceId, cell: number, color: FaceId) => {
    setFaces((prev) => {
      const next = { ...prev, [face]: [...prev[face]] as FaceStickers }
      next[face][cell] = color
      return next
    })
    setSolution(null)
  }, [])

  const runSolve = useCallback(async () => {
    setSolveBusy(true)
    setSolveErr(null)
    setSolution(null)
    try {
      const alg = await solveFacelets(facelets)
      setSolution(alg)
    } catch (e) {
      setSolveErr(e instanceof Error ? e.message : 'Solve failed')
    } finally {
      setSolveBusy(false)
    }
  }, [facelets])

  const renderFaceGrid = (faceId: FaceId, interactive: boolean) => (
    <div className={`rubiks-net-face${scanFace === faceId && mode === 'scan' ? ' is-scan-target' : ''}`}>
      <span className="rubiks-net-label">{faceId}</span>
      <div className="rubiks-net-grid">
        {faces[faceId].map((sticker, i) => (
          <button
            key={`${faceId}-${i}`}
            type="button"
            className="rubiks-sticker"
            style={stickerStyle(sticker)}
            title={FACE_PALETTE[sticker].label}
            disabled={!interactive}
            onClick={() => {
              if (!interactive) return
              setSticker(faceId, i, cycleStickerColor(sticker))
            }}
          />
        ))}
      </div>
    </div>
  )

  return (
    <div className="ro-shell rubiks-page">
      <header className="rubiks-header">
        <button type="button" className="ro-btn ro-btn-ghost" onClick={onBack}>
          ← Workspace
        </button>
        <div className="rubiks-header-text">
          <h1 className="rubiks-title">Rubik&apos;s cube camera solver</h1>
          <p className="rubiks-lead muted">
            Scan each face with the camera or paint the unfolded net by hand, then run the built-in two-phase solver.
            Lighting and sticker wear affect scan quality; use manual mode to fix individual cells.
            {solverInit === 'loading'
              ? ' Solver tables are loading…'
              : solverInit === 'ready'
                ? ''
                : solverInit === 'err'
                  ? ' Solver failed to initialize.'
                  : ''}
          </p>
        </div>
        <div className="rubiks-mode-toggle">
          <button
            type="button"
            className={`ro-btn ro-btn-ghost${mode === 'scan' ? ' is-active' : ''}`}
            onClick={() => setMode('scan')}
          >
            Camera scan
          </button>
          <button
            type="button"
            className={`ro-btn ro-btn-ghost${mode === 'manual' ? ' is-active' : ''}`}
            onClick={() => setMode('manual')}
          >
            Manual net
          </button>
          {onOpenVideoLab ? (
            <button type="button" className="ro-btn ro-btn-ghost" onClick={onOpenVideoLab}>
              Video lab
            </button>
          ) : null}
        </div>
      </header>

      <div className="rubiks-layout">
        <section className="rubiks-scan-panel" aria-label="Camera scan">
          {mode === 'scan' ? (
            <>
              <div className="rubiks-video-wrap">
                <video ref={videoRef} playsInline muted aria-label="Camera preview for cube scan" />
                <div className="rubiks-scan-overlay" aria-hidden>
                  <div className="rubiks-guide-grid">
                    {Array.from({ length: 9 }, (_, i) => (
                      <div key={i} className="rubiks-guide-cell" />
                    ))}
                  </div>
                </div>
              </div>
              {cameraErr ? (
                <p className="rubiks-err" role="alert">
                  {cameraErr}
                </p>
              ) : null}
              <div className="rubiks-face-tabs" role="tablist" aria-label="Face to scan">
                {FACE_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={scanFace === id}
                    className={`ro-btn ro-btn-ghost${scanFace === id ? ' is-active' : ''}`}
                    onClick={() => setScanFace(id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
              <p className="rubiks-hint muted">{SCAN_FACE_HINTS[scanFace]}</p>
              <div className="rubiks-scan-actions">
                <button type="button" className="ro-btn ro-btn-ghost" onClick={() => setCameraOn((c) => !c)}>
                  {cameraOn ? 'Camera off' : 'Camera on'}
                </button>
                <button type="button" className="ro-btn ro-btn-accent" disabled={!cameraOn} onClick={captureScanFace}>
                  Capture {scanFace} face
                </button>
                <span className="muted rubiks-hint">{capturedCount} capture{capturedCount === 1 ? '' : 's'}</span>
              </div>
            </>
          ) : (
            <p className="rubiks-hint muted">
              Switch to <strong>Camera scan</strong> to sample faces from the webcam. Align the active face inside the
              3×3 guide; center sticker should match the face color ({SCAN_FACE_HINTS[scanFace]}).
            </p>
          )}
        </section>

        <section className="rubiks-side-panel" aria-label="Cube net and solution">
          <div className="rubiks-net" aria-label="Unfolded cube net">
            {NET_SLOTS.map(({ id, className }) => (
              <div key={id} className={className}>
                {renderFaceGrid(id, mode === 'manual')}
              </div>
            ))}
          </div>
          <div className="rubiks-scan-actions">
            <button
              type="button"
              className="ro-btn ro-btn-ghost"
              onClick={() => {
                setFaces(solvedCubeFaces())
                setSolution(null)
                setSolveErr(null)
              }}
            >
              Solved demo
            </button>
            <button
              type="button"
              className="ro-btn ro-btn-ghost"
              onClick={() => {
                setFaces(emptyCubeFaces())
                setSolution(null)
                setSolveErr(null)
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="ro-btn ro-btn-accent"
              disabled={solveBusy || solverInit === 'loading'}
              onClick={() => void runSolve()}
            >
              {solveBusy ? 'Solving…' : 'Solve cube'}
            </button>
          </div>
          {solveErr ? (
            <p className="rubiks-err" role="alert">
              {solveErr}
            </p>
          ) : null}
          {solution ? (
            <>
              <p className="rubiks-hint muted">
                {solution.split(/\s+/).filter(Boolean).length} moves (standard face-turn notation).
              </p>
              <pre className="rubiks-solution">{solution}</pre>
              <button
                type="button"
                className="ro-btn ro-btn-ghost"
                onClick={() => void navigator.clipboard?.writeText(solution)}
              >
                Copy algorithm
              </button>
            </>
          ) : (
            <p className="rubiks-hint muted">
              Facelet string: <code className="ro-drawer-code">{facelets.slice(0, 12)}…</code> (54 chars)
            </p>
          )}
        </section>
      </div>

      <canvas ref={capRef} className="vfl-hidden-cap" aria-hidden />
    </div>
  )
}
