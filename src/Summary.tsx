import { useCallback, useState } from 'react'
import type { OverviewWorkspaceSnapshot } from './research/workspace-snapshot'
import { copyShareUrlToClipboard, encodeWorkspaceShare } from './research/workspace-share-link'

export type SummaryProps = {
  onBackToWorkspace: () => void
  onOpenPresentation?: () => void
  /** Switches to the workspace and triggers a one-shot JSON download via `#workspace-export`. */
  onExportWorkspaceJson: () => void
  /** Latest debounced workspace snapshot from the main view (null until the first notify). */
  getWorkspaceSnapshot: () => OverviewWorkspaceSnapshot | null
}

export default function Summary({
  onBackToWorkspace,
  onOpenPresentation,
  onExportWorkspaceJson,
  getWorkspaceSnapshot,
}: SummaryProps) {
  const [shareNotice, setShareNotice] = useState<string | null>(null)

  const onCopyShareLink = useCallback(async () => {
    const snap = getWorkspaceSnapshot()
    if (!snap) {
      setShareNotice('Open the workspace briefly so state syncs, then try again.')
      return
    }
    const enc = await encodeWorkspaceShare(snap)
    if (!enc.ok) {
      setShareNotice('Too large to share via link — use Export JSON instead.')
      return
    }
    await copyShareUrlToClipboard(enc.shareUrl)
    setShareNotice('Share link copied.')
  }, [getWorkspaceSnapshot])

  return (
    <div className="overview-summary">
      <header className="overview-summary-header">
        <p className="overview-summary-kicker">Overview</p>
        <h1 className="overview-summary-title">Workspace summary</h1>
        <p className="overview-summary-lead">
          Plain reference for what this Vite + React shell ships: a local research outline, interchangeable workspace
          state, and hooks for automation.
        </p>
      </header>

      <section className="overview-summary-section" aria-labelledby="summary-features">
        <h2 id="summary-features">Shipped features</h2>
        <ul className="overview-summary-list">
          <li>
            <strong>Research outline</strong> — Wikipedia-style nested sections with per-tab page state and a scrollable
            tab strip.
          </li>
          <li>
            <strong>Markdown + math preview</strong> — Edit / Preview on each card; fenced code and KaTeX paths live on
            the workspace view (this page stays lightweight).
          </li>
          <li>
            <strong>Workspace JSON</strong> — Export and import full snapshot for backups and tooling pipelines; batch
            search and DX workflows often pair well with a reproducible workspace artifact. Optional compressed share
            links (<code className="overview-summary-code">#workspace-share=…</code>) work for modest workspaces.
          </li>
          <li>
            <strong>Menu drawer</strong> — Files, AI linking (session-only keys), quick notes, and Images / Stream /
            Chat stub panels.
          </li>
          <li>
            <strong>Menu FAB</strong> — Floating control for the drawer and export/import actions.
          </li>
          <li>
            <strong>Agent hooks</strong> — <code className="overview-summary-code">onWorkspaceChange</code> (debounced),
            optional <code className="overview-summary-code">window.__OVERVIEW_WORKSPACE__</code> (dev, Menu → Actions
            opt-in on production, or <code className="overview-summary-code">VITE_EXPOSE_WORKSPACE_API=1</code>), plus{' '}
            <code className="overview-summary-code">overview-workspace-snapshot</code> window events when that surface is
            on. See <code className="overview-summary-code">docs/agent/09-agent-collaboration.md</code>.
          </li>
          <li>
            <strong>Ingest</strong> — Hero URL field with ingest kind tabs (transcript / images / notes) when the field
            looks like an HTTP URL.
          </li>
          <li>
            <strong>Shell context</strong> — Collapsible strip above the tabs for cross-page scratch context (included in
            workspace export).
          </li>
          <li>
            <strong>Mobile</strong> — Responsive spacing, tab scrolling, and touch-friendly controls.
          </li>
        </ul>
      </section>

      <section className="overview-summary-section" aria-labelledby="summary-actions">
        <h2 id="summary-actions">Quick actions</h2>
        <div className="overview-summary-actions">
          <button type="button" className="overview-summary-btn overview-summary-btn-primary" onClick={onExportWorkspaceJson}>
            Export workspace JSON
          </button>
          <button type="button" className="overview-summary-btn overview-summary-btn-primary" onClick={onCopyShareLink}>
            Copy workspace share link
          </button>
          {shareNotice ? (
            <p className="overview-summary-share-notice" role="status" aria-live="polite">
              {shareNotice}
            </p>
          ) : null}
          <p className="overview-summary-hint">
            Opens the workspace and downloads <code className="overview-summary-code">overview-workspace.json</code>.
            Or use <strong>Menu → Export workspace JSON</strong> when you are already there.
          </p>
          <p className="overview-summary-hint">
            Share link encodes the current snapshot in the URL hash (size-limited). Same control lives under{' '}
            <strong>Menu → Actions → Copy workspace share link</strong>.
          </p>
          <button type="button" className="overview-summary-btn overview-summary-btn-ghost" onClick={onBackToWorkspace}>
            Back to workspace
          </button>
        </div>
      </section>

      <section className="overview-summary-section" aria-labelledby="summary-reading">
        <h2 id="summary-reading">Further reading</h2>
        <p>
          <a
            className="overview-summary-link"
            href="https://leerob.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Lee Robinson — batch &amp; DX inspiration
          </a>
          <span className="overview-summary-muted"> (not affiliated)</span>
        </p>
        <p className="overview-summary-muted">
          Useful perspective on iterative shipping and developer experience; no endorsement implied.
        </p>
      </section>

      <footer className="overview-summary-footer">
        <button type="button" className="overview-summary-footer-link" onClick={onBackToWorkspace}>
          ← Workspace
        </button>
        {onOpenPresentation ? (
          <>
            <span className="overview-summary-muted"> · </span>
            <button type="button" className="overview-summary-footer-link" onClick={onOpenPresentation}>
              Presentation
            </button>
          </>
        ) : null}
        <span className="overview-summary-muted"> · </span>
        <span className="overview-summary-muted">Summary</span>
        <span className="overview-summary-muted"> · </span>
        <span className="overview-summary-footer-credits">
          URL-in-hash sharing inspired by{' '}
          <a
            className="overview-summary-link"
            href="https://notes.kognise.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            notes.kognise.dev
          </a>{' '}
          and{' '}
          <a
            className="overview-summary-link"
            href="https://github.com/kognise/notes"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/kognise/notes
          </a>
          .
        </span>
      </footer>
    </div>
  )
}
