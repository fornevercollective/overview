import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  DEFAULT_CUBE_ORDER,
  emptyCubeFaces,
  FACE_IDS,
  FACE_PALETTE,
  SCAN_FACE_ORDER,
  facesToFacelets,
  suggestedScanFace,
  sampleFaceFromImageData,
  guideRegionThumbnailFromCanvas,
  scanFaceHint,
  solvedCubeFaces,
  cycleStickerColor,
  totalFacelets,
  type CubeFaces,
  type CubeOrder,
  type FaceId,
  type FaceStickers,
} from './rubiksCube'
import { initRubiksSolver, solveFacelets } from './rubiksCubeSolve'
import { REDUCTION_SOLVE_PREAMBLE } from './rubiksCube444Reduce'
import { parseSolutionMoves, stickerRgbOverlayStyle, stickerRgbStyle, type WalkthroughSnapshot } from './rubiksLiveScan'
import { useRubiksLiveScan } from './useRubiksLiveScan'
import RubiksSolvePotentialPanel from './rubiksSolvePotentialPanel'
import './rubiks-cube-solver.css'

export type RubiksCubeSolverProps = {
  onBack: () => void
  onOpenVideoLab?: () => void
}

type InputMode = 'scan' | 'manual'

type FaceCaptureStill = {
  face: FaceId
  dataUrl: string
  at: number
}

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

function cloneFaces(src: CubeFaces): CubeFaces {
  const out = {} as CubeFaces
  for (const id of FACE_IDS) out[id] = [...src[id]] as FaceStickers
  return out
}

export default function RubiksCubeSolver({ onBack, onOpenVideoLab }: RubiksCubeSolverProps) {
  const [cubeOrder, setCubeOrder] = useState<CubeOrder>(DEFAULT_CUBE_ORDER)
  const [mode, setMode] = useState<InputMode>('scan')
  const [faces, setFaces] = useState<CubeFaces>(() => emptyCubeFaces(DEFAULT_CUBE_ORDER))
  const [scanFace, setScanFace] = useState<FaceId>('U')
  const [cameraOn, setCameraOn] = useState(true)
  const [cameraErr, setCameraErr] = useState<string | null>(null)
  const [solverInit, setSolverInit] = useState<'idle' | 'loading' | 'ready' | 'err'>('loading')
  const [solveBusy, setSolveBusy] = useState(false)
  const [solution, setSolution] = useState<string | null>(null)
  const [solveErr, setSolveErr] = useState<string | null>(null)
  const [capturedCount, setCapturedCount] = useState(0)
  const [capturedFaces, setCapturedFaces] = useState<Set<FaceId>>(() => new Set())
  const [autoScan, setAutoScan] = useState(true)
  const [autoFollowFace, setAutoFollowFace] = useState(true)
  const [autoCalibrate, setAutoCalibrate] = useState(true)
  const [walkthroughOn, setWalkthroughOn] = useState(false)
  const [walkStep, setWalkStep] = useState(0)
  const [snapshots, setSnapshots] = useState<WalkthroughSnapshot[]>([])
  const [faceStills, setFaceStills] = useState<Partial<Record<FaceId, FaceCaptureStill>>>({})

  const videoRef = useRef<HTMLVideoElement>(null)
  const capRef = useRef<HTMLCanvasElement>(null)
  const followTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pauseFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pauseAutoFollow, setPauseAutoFollow] = useState(false)

  const facelets = useMemo(() => facesToFacelets(faces, cubeOrder), [faces, cubeOrder])
  const faceletTotal = totalFacelets(cubeOrder)
  const suggestedScan = useMemo(() => suggestedScanFace(capturedFaces), [capturedFaces])
  const capturedFacesRef = useRef(capturedFaces)

  useEffect(() => {
    capturedFacesRef.current = capturedFaces
  }, [capturedFaces])

  const setOrder = useCallback((order: CubeOrder) => {
    setCubeOrder(order)
    setFaces(emptyCubeFaces(order))
    setScanFace('U') // first in SCAN_FACE_ORDER
    setSolution(null)
    setSolveErr(null)
    setCapturedCount(0)
    setCapturedFaces(new Set())
    setWalkthroughOn(false)
    setWalkStep(0)
    setSnapshots([])
    setFaceStills({})
  }, [])

  const walkMoves = useMemo(() => (solution ? parseSolutionMoves(solution) : []), [solution])
  const currentWalkMove = walkMoves[walkStep] ?? null

  const onDetectedFace = useCallback((face: FaceId) => {
    const want = suggestedScanFace(capturedFacesRef.current)
    if (face !== want) return
    if (followTimerRef.current) clearTimeout(followTimerRef.current)
    followTimerRef.current = setTimeout(() => setScanFace(want), 320)
  }, [])

  const onCalibrateFace = useCallback((face: FaceId, merged: FaceStickers) => {
    setFaces((prev) => ({ ...prev, [face]: merged }))
  }, [])

  const live = useRubiksLiveScan({
    enabled: autoScan && mode === 'scan',
    cameraOn,
    cubeOrder,
    faces,
    scanFace,
    capturedFaces,
    videoRef,
    capRef,
    autoFollowFace: autoFollowFace && !pauseAutoFollow,
    autoCalibrate,
    onDetectedFace,
    onCalibrateFace,
  })

  useEffect(() => {
    return () => {
      if (pauseFollowTimerRef.current) clearTimeout(pauseFollowTimerRef.current)
    }
  }, [])

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
    const sampled = sampleFaceFromImageData(id, cubeOrder)
    const thumbUrl = guideRegionThumbnailFromCanvas(cap)
    setFaces((prev) => ({ ...prev, [scanFace]: sampled }))
    const capturedAfter = new Set(capturedFaces)
    capturedAfter.add(scanFace)
    setCapturedFaces(capturedAfter)
    if (thumbUrl) {
      setFaceStills((prev) => ({
        ...prev,
        [scanFace]: { face: scanFace, dataUrl: thumbUrl, at: Date.now() },
      }))
    }
    setCapturedCount((n) => n + 1)
    setSolution(null)
    setSolveErr(null)
    setScanFace(suggestedScanFace(capturedAfter))
    if (pauseFollowTimerRef.current) clearTimeout(pauseFollowTimerRef.current)
    setPauseAutoFollow(true)
    pauseFollowTimerRef.current = setTimeout(() => {
      setPauseAutoFollow(false)
      pauseFollowTimerRef.current = null
    }, 2200)
  }, [scanFace, cubeOrder, capturedFaces])

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
    setWalkthroughOn(false)
    setWalkStep(0)
    setSnapshots([])
    try {
      const alg = await solveFacelets(facelets, cubeOrder)
      setSolution(alg)
    } catch (e) {
      setSolveErr(e instanceof Error ? e.message : 'Solve failed')
    } finally {
      setSolveBusy(false)
    }
  }, [facelets, cubeOrder])

  const pushSnapshot = useCallback(() => {
    const snap: WalkthroughSnapshot = {
      step: walkStep,
      move: currentWalkMove,
      faces: cloneFaces(faces),
      detected: live?.best ?? null,
      at: Date.now(),
    }
    setSnapshots((prev) => [snap, ...prev].slice(0, 12))
  }, [walkStep, currentWalkMove, faces, live?.best])

  const startWalkthrough = useCallback(() => {
    if (!walkMoves.length) return
    setWalkthroughOn(true)
    setWalkStep(0)
    pushSnapshot()
  }, [walkMoves.length, pushSnapshot])

  const advanceWalk = useCallback(() => {
    setWalkStep((s) => {
      const next = Math.min(s + 1, Math.max(0, walkMoves.length - 1))
      const snap: WalkthroughSnapshot = {
        step: next,
        move: walkMoves[next] ?? null,
        faces: cloneFaces(faces),
        detected: live?.best ?? null,
        at: Date.now(),
      }
      setSnapshots((prev) => [snap, ...prev].slice(0, 12))
      return next
    })
  }, [walkMoves, faces, live?.best])

  const rewindWalk = useCallback(() => {
    setWalkStep((s) => Math.max(0, s - 1))
  }, [])

  const renderFaceGrid = (faceId: FaceId, interactive: boolean) => (
    <div
      className={`rubiks-net-face${scanFace === faceId && mode === 'scan' ? ' is-scan-target' : ''}${suggestedScan === faceId && mode === 'scan' && capturedFaces.size < 6 ? ' is-scan-suggested' : ''}`}
    >
      <span className="rubiks-net-label">
        {faceId}
        {cubeOrder === 4 && faceId === 'U' ? ' · logo' : ''}
      </span>
      <div className={`rubiks-net-grid rubiks-net-grid--${cubeOrder}`}>
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

  const solveDisabled = solveBusy || solverInit === 'loading' || solverInit === 'err'

  return (
    <div className="ro-shell rubiks-page">
      <header className="rubiks-header">
        <button type="button" className="ro-btn ro-btn-ghost" onClick={onBack}>
          ← Workspace
        </button>
        <div className="rubiks-header-text">
          <h1 className="rubiks-title">Rubik&apos;s cube camera solver</h1>
          <p className="rubiks-lead muted">
            Built for a <strong>4×4</strong> with the Rubik&apos;s logo on white / <strong>U</strong>. Capture faces in
            order <strong>U → F → R → B → L → D</strong> (live overlay, stills column, solve-potential meter).{' '}
            <strong>3×3</strong> uses Kociemba directly; <strong>4×4</strong> merges center 2×2 blocks then runs the same solver (pair edges on the cube if needed).
            {solverInit === 'loading'
              ? ' Solver tables are loading…'
              : solverInit === 'err'
                ? ' Solver failed to initialize.'
                : ''}
          </p>
        </div>
        <div className="rubiks-mode-toggle">
          <span className="rubiks-order-label muted">Size</span>
          <button
            type="button"
            className={`ro-btn ro-btn-ghost${cubeOrder === 4 ? ' is-active' : ''}`}
            onClick={() => setOrder(4)}
          >
            4×4
          </button>
          <button
            type="button"
            className={`ro-btn ro-btn-ghost${cubeOrder === 3 ? ' is-active' : ''}`}
            onClick={() => setOrder(3)}
          >
            3×3
          </button>
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
              <div className="rubiks-face-tabs" role="tablist" aria-label="Face to scan">
                {SCAN_FACE_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={scanFace === id}
                    className={`ro-btn ro-btn-ghost${scanFace === id ? ' is-active' : ''}${suggestedScan === id && capturedFaces.size < 6 ? ' rubiks-face-tab--suggested' : ''}${live?.best === id ? ' rubiks-face-tab--detected' : ''}${capturedFaces.has(id) ? ' rubiks-face-tab--captured' : ''}`}
                    onClick={() => setScanFace(id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
              <p className="rubiks-hint muted">
                {scanFaceHint(scanFace, cubeOrder)}
                {capturedFaces.size < 6 ? (
                  <>
                    {' '}
                    · Next in order:{' '}
                    <strong>{suggestedScan}</strong> ({capturedFaces.size}/6 captured)
                  </>
                ) : (
                  ' · All faces captured — recapture any tab to update.'
                )}
              </p>
              {scanFace !== suggestedScan && capturedFaces.size < 6 ? (
                <p className="rubiks-hint rubiks-hint--next">
                  <button type="button" className="ro-btn ro-btn-ghost rubiks-jump-next" onClick={() => setScanFace(suggestedScan)}>
                    Jump to next: {suggestedScan}
                  </button>
                </p>
              ) : null}
              <div className="rubiks-live-toggles" role="group" aria-label="Live scan options">
                <label className="rubiks-check">
                  <input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />
                  Live overlay
                </label>
                <label className="rubiks-check">
                  <input
                    type="checkbox"
                    checked={autoFollowFace}
                    disabled={!autoScan}
                    onChange={(e) => setAutoFollowFace(e.target.checked)}
                  />
                  Auto-detect side
                </label>
                <label className="rubiks-check">
                  <input
                    type="checkbox"
                    checked={autoCalibrate}
                    disabled={!autoScan}
                    onChange={(e) => setAutoCalibrate(e.target.checked)}
                  />
                  Calibrate from scans
                </label>
              </div>
              <div className="rubiks-scan-actions">
                <button type="button" className="ro-btn ro-btn-ghost" onClick={() => setCameraOn((c) => !c)}>
                  {cameraOn ? 'Camera off' : 'Camera on'}
                </button>
                <button type="button" className="ro-btn ro-btn-accent" disabled={!cameraOn} onClick={captureScanFace}>
                  Capture {scanFace} face
                  {scanFace !== suggestedScan && capturedFaces.size < 6 ? ` (next: ${suggestedScan})` : ''}
                </button>
                <span className="muted rubiks-hint">{capturedCount} capture{capturedCount === 1 ? '' : 's'}</span>
              </div>
              <div className="rubiks-video-row">
                <div className="rubiks-face-stills" aria-label="Face capture snapshots">
                  {SCAN_FACE_ORDER.map((id) => {
                    const still = faceStills[id]
                    const active = scanFace === id
                    const hasStill = Boolean(still)
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`rubiks-face-still${active ? ' is-active' : ''}${hasStill ? ' has-capture' : ''}`}
                        onClick={() => setScanFace(id)}
                        title={
                          hasStill
                            ? `${id} — captured ${new Date(still!.at).toLocaleTimeString()}`
                            : `${id} — not captured yet`
                        }
                      >
                        <span className="rubiks-face-still-label">{id}</span>
                        {hasStill ? (
                          <img src={still!.dataUrl} alt={`Captured ${id} face`} className="rubiks-face-still-img" />
                        ) : (
                          <span className="rubiks-face-still-placeholder" aria-hidden />
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="rubiks-video-wrap">
                <video ref={videoRef} playsInline muted aria-label="Camera preview for cube scan" />
                <div className="rubiks-scan-overlay" aria-hidden>
                  {live?.turnHint ? <div className="rubiks-turn-flash">{live.turnHint}</div> : null}
                  <div
                    className={`rubiks-live-badge${live?.best ? ` rubiks-live-badge--${live.best}` : ''}`}
                    data-confidence={live ? Math.round(live.confidence * 100) : 0}
                  >
                    {live?.best ? (
                      <>
                        <span className="rubiks-live-badge-face">{live.best}</span>
                        <span className="rubiks-live-badge-meta">
                          {FACE_PALETTE[live.best].label} · {Math.round(live.confidence * 100)}%
                          {live.rotation ? ` · rot ${live.rotation * 90}°` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="rubiks-live-badge-meta">Align cube in guide…</span>
                    )}
                  </div>
                  {walkthroughOn && currentWalkMove ? (
                    <div className="rubiks-walk-overlay">
                      <span className="rubiks-walk-step">
                        Step {walkStep + 1}/{walkMoves.length}
                      </span>
                      <span className="rubiks-walk-move">{currentWalkMove}</span>
                    </div>
                  ) : null}
                  <div className={`rubiks-guide-grid rubiks-guide-grid--${cubeOrder}`}>
                    {(live?.sample ?? Array.from({ length: cubeOrder * cubeOrder }, () => scanFace)).map((id, i) => (
                      <div
                        key={i}
                        className={`rubiks-guide-cell${live ? ' rubiks-guide-cell--live' : ''}`}
                        style={live ? { background: stickerRgbOverlayStyle(id) } : undefined}
                      />
                    ))}
                  </div>
                  {live && autoScan ? (
                    <div className="rubiks-match-bars">
                      {live.matches.slice(0, 3).map((m) => (
                        <div key={m.face} className="rubiks-match-row">
                          <span>{m.face}</span>
                          <span
                            className="rubiks-match-fill"
                            style={{ width: `${Math.round(m.score * 100)}%`, background: stickerRgbStyle(m.face) }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                </div>
              </div>
              {live && autoScan ? (
                <p className="rubiks-hint muted">
                  Live: {live.best ? `likely ${live.best}` : 'searching…'} · dominant {live.dominant}
                  {capturedFaces.size > 0 ? ` · ${capturedFaces.size} face template${capturedFaces.size === 1 ? '' : 's'}` : ''}
                </p>
              ) : null}
              {cameraErr ? (
                <p className="rubiks-err" role="alert">
                  {cameraErr}
                </p>
              ) : null}
            </>
          ) : (
            <p className="rubiks-hint muted">
              Switch to <strong>Camera scan</strong> to sample faces from the webcam. Align the active face inside the{' '}
              {cubeOrder}×{cubeOrder} guide.
              {cubeOrder === 4 ? (
                <>
                  {' '}
                  Start with <strong>U</strong>: the white side that has the Rubik&apos;s logo sticker.
                </>
              ) : (
                ` Center sticker should match the face color (${scanFaceHint(scanFace, cubeOrder)}).`
              )}
            </p>
          )}
        </section>

        <section className="rubiks-side-panel" aria-label="Cube net and solution">
          <RubiksSolvePotentialPanel
            faces={faces}
            cubeOrder={cubeOrder}
            capturedFaces={capturedFaces}
            walkStep={walkStep}
            walkMoveCount={walkMoves.length}
            walkthroughOn={walkthroughOn}
            liveConfidence={live?.confidence ?? null}
          />
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
                setFaces(solvedCubeFaces(cubeOrder))
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
                setFaces(emptyCubeFaces(cubeOrder))
                setCapturedFaces(new Set())
                setFaceStills({})
                setCapturedCount(0)
                setScanFace('U')
                setSolution(null)
                setSolveErr(null)
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="ro-btn ro-btn-accent"
              disabled={solveDisabled}
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
            <div className="rubiks-walkthrough">
              <p className="rubiks-hint muted">
                Walkthrough: apply each move, then snapshot or let live scan refresh the net.
              </p>
              <div className="rubiks-scan-actions">
                <button
                  type="button"
                  className={`ro-btn ro-btn-ghost${walkthroughOn ? ' is-active' : ''}`}
                  onClick={() => (walkthroughOn ? setWalkthroughOn(false) : startWalkthrough())}
                >
                  {walkthroughOn ? 'Stop walkthrough' : 'Start walkthrough'}
                </button>
                <button
                  type="button"
                  className="ro-btn ro-btn-accent"
                  disabled={!walkthroughOn}
                  onClick={pushSnapshot}
                >
                  Snapshot
                </button>
                <button type="button" className="ro-btn ro-btn-ghost" disabled={!walkthroughOn || walkStep <= 0} onClick={rewindWalk}>
                  Prev
                </button>
                <button
                  type="button"
                  className="ro-btn ro-btn-ghost"
                  disabled={!walkthroughOn || walkStep >= walkMoves.length - 1}
                  onClick={advanceWalk}
                >
                  Next move
                </button>
              </div>
              {walkthroughOn && currentWalkMove ? (
                <p className="rubiks-walk-current" aria-live="polite">
                  Do: <strong>{currentWalkMove}</strong>
                </p>
              ) : null}
              {snapshots.length > 0 ? (
                <ul className="rubiks-snapshot-list">
                  {snapshots.map((s) => (
                    <li key={s.at}>
                      <button
                        type="button"
                        className="ro-btn ro-btn-ghost rubiks-snapshot-btn"
                        onClick={() => {
                          setFaces(s.faces as CubeFaces)
                          setWalkStep(s.step)
                        }}
                      >
                        Step {s.step + 1}
                        {s.move ? ` · ${s.move}` : ''}
                        {s.detected ? ` · saw ${s.detected}` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {solution ? (
            <>
              {cubeOrder === 4 ? (
                <p className="rubiks-hint muted rubiks-four-note">{REDUCTION_SOLVE_PREAMBLE}</p>
              ) : null}
              <p className="rubiks-hint muted">
                {walkMoves.length} moves (face-turn notation{cubeOrder === 4 ? ', 3×3 phase' : ''}).
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
              Facelet string: <code className="ro-drawer-code">{facelets.slice(0, 12)}…</code> ({faceletTotal} chars)
            </p>
          )}
        </section>
      </div>

      <canvas ref={capRef} className="vfl-hidden-cap" aria-hidden />
    </div>
  )
}
