import { Suspense, lazy, useCallback, useRef, useState } from 'react'
import { createOllamaOnAiIterate, createOllamaWorkspaceAssistant } from './ai/ollamaOpenAiIterate'
import ResearchOverview, { type ResearchOverviewProps } from './research/ResearchOverview'
import type { OverviewWorkspaceSnapshot } from './research/workspace-snapshot'

const Sketch = lazy(() => import('./Sketch'))
const Presentation = lazy(() => import('./Presentation'))
const Summary = lazy(() => import('./Summary'))
const Session = lazy(() => import('./Session'))
const VideoFeedsLab = lazy(() => import('./research/VideoFeedsLab'))
const LiveHexSnake = lazy(() => import('./research/LiveHexSnake'))
const RubiksCubeSolver = lazy(() => import('./research/RubiksCubeSolver'))

const routeFallback = <div style={{ padding: 24 }}>Loading…</div>

/** Set `VITE_USE_AI_STUB=1` at build time to skip local chat calls (deterministic in-app stubs). */
const useAiStub = import.meta.env.VITE_USE_AI_STUB === '1'

const onAiIterate: ResearchOverviewProps['onAiIterate'] = useAiStub ? undefined : createOllamaOnAiIterate()
const onWorkspaceAssistant: ResearchOverviewProps['onWorkspaceAssistant'] = useAiStub
  ? undefined
  : createOllamaWorkspaceAssistant()

export default function App() {
  const [page, setPage] = useState<
    'app' | 'summary' | 'presentation' | 'sketch' | 'session' | 'videoLab' | 'hexSnake' | 'rubiksCube'
  >('app')
  const lastWorkspaceSnapshotRef = useRef<OverviewWorkspaceSnapshot | null>(null)

  const onWorkspaceChange = useCallback((snap: OverviewWorkspaceSnapshot) => {
    lastWorkspaceSnapshotRef.current = snap
  }, [])

  const openSummary = useCallback(() => setPage('summary'), [])
  const openPresentation = useCallback(() => setPage('presentation'), [])
  const openSketch = useCallback(() => setPage('sketch'), [])
  const openSession = useCallback(() => setPage('session'), [])
  const openVideoLab = useCallback(() => setPage('videoLab'), [])
  const openHexSnake = useCallback(() => setPage('hexSnake'), [])
  const openRubiksCube = useCallback(() => setPage('rubiksCube'), [])
  const backToWorkspace = useCallback(() => setPage('app'), [])
  const exportFromSummary = useCallback(() => {
    window.location.hash = '#workspace-export'
    setPage('app')
  }, [])

  if (page === 'summary') {
    return (
      <Suspense fallback={routeFallback}>
        <Summary
          onBackToWorkspace={backToWorkspace}
          onOpenPresentation={openPresentation}
          onExportWorkspaceJson={exportFromSummary}
          getWorkspaceSnapshot={() => lastWorkspaceSnapshotRef.current}
        />
      </Suspense>
    )
  }

  if (page === 'presentation') {
    return (
      <Suspense fallback={routeFallback}>
        <Presentation onBack={backToWorkspace} />
      </Suspense>
    )
  }

  if (page === 'sketch') {
    return (
      <Suspense fallback={routeFallback}>
        <Sketch onBack={backToWorkspace} />
      </Suspense>
    )
  }

  if (page === 'session') {
    return (
      <Suspense fallback={routeFallback}>
        <Session
          onBackToWorkspace={backToWorkspace}
          onOpenSummary={openSummary}
          onOpenPresentation={openPresentation}
          onOpenSketch={openSketch}
        />
      </Suspense>
    )
  }

  if (page === 'videoLab') {
    return (
      <Suspense fallback={routeFallback}>
        <VideoFeedsLab
          onBack={backToWorkspace}
          onOpenHexSnake={openHexSnake}
          onOpenRubiksCube={openRubiksCube}
        />
      </Suspense>
    )
  }

  if (page === 'hexSnake') {
    return (
      <Suspense fallback={routeFallback}>
        <LiveHexSnake onBack={backToWorkspace} onOpenVideoLab={openVideoLab} />
      </Suspense>
    )
  }

  if (page === 'rubiksCube') {
    return (
      <Suspense fallback={routeFallback}>
        <RubiksCubeSolver onBack={backToWorkspace} onOpenVideoLab={openVideoLab} />
      </Suspense>
    )
  }

  return (
    <ResearchOverview
      onAiIterate={onAiIterate}
      onWorkspaceAssistant={onWorkspaceAssistant}
      onOpenSummary={openSummary}
      onOpenPresentation={openPresentation}
      onOpenSketch={openSketch}
      onOpenSession={openSession}
      onOpenVideoLab={openVideoLab}
      onOpenHexSnake={openHexSnake}
      onOpenRubiksCube={openRubiksCube}
      onWorkspaceChange={onWorkspaceChange}
    />
  )
}
