import { useCallback, useRef, useState } from 'react'
import Presentation from './Presentation'
import ResearchOverview, { type ResearchOverviewProps } from './research/ResearchOverview'
import type { OverviewWorkspaceSnapshot } from './research/workspace-snapshot'
import Summary from './Summary'

/** Set to your backend when ready; `undefined` keeps the built-in offline stub (expand, refine, seed). */
const onAiIterate: ResearchOverviewProps['onAiIterate'] = undefined

export default function App() {
  const [page, setPage] = useState<'app' | 'summary' | 'presentation'>('app')
  const lastWorkspaceSnapshotRef = useRef<OverviewWorkspaceSnapshot | null>(null)

  const onWorkspaceChange = useCallback((snap: OverviewWorkspaceSnapshot) => {
    lastWorkspaceSnapshotRef.current = snap
  }, [])

  const openSummary = useCallback(() => setPage('summary'), [])
  const openPresentation = useCallback(() => setPage('presentation'), [])
  const backToWorkspace = useCallback(() => setPage('app'), [])
  const exportFromSummary = useCallback(() => {
    window.location.hash = '#workspace-export'
    setPage('app')
  }, [])

  if (page === 'summary') {
    return (
      <Summary
        onBackToWorkspace={backToWorkspace}
        onOpenPresentation={openPresentation}
        onExportWorkspaceJson={exportFromSummary}
        getWorkspaceSnapshot={() => lastWorkspaceSnapshotRef.current}
      />
    )
  }

  if (page === 'presentation') {
    return <Presentation onBack={backToWorkspace} />
  }

  return (
    <ResearchOverview
      onAiIterate={onAiIterate}
      onOpenSummary={openSummary}
      onOpenPresentation={openPresentation}
      onWorkspaceChange={onWorkspaceChange}
    />
  )
}
