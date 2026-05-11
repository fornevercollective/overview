import { forwardRef, useState } from 'react'

/**
 * Day/Night side-by-side iterative preview. Each pane redefines the theme CSS variables
 * locally (see `.ro-tsp-pane--light` / `--dark` in `research.css`) so users can compare
 * contrast without flipping `prefers-color-scheme`. Drives the snapshot target for the
 * "Snapshot split preview" capture button in the drawer.
 */
export const ThemeSplitPreview = forwardRef<HTMLDivElement>(function ThemeSplitPreview(_props, ref) {
  const [draft, setDraft] = useState(
    'Iterating outline copy here updates both Day and Night cards so you can eyeball legibility before committing.',
  )

  return (
    <div className="ro-tsp">
      <div className="ro-drawer-field">
        <label className="ro-drawer-label" htmlFor="ro-tsp-draft">
          Shared scratch (writes to both)
        </label>
        <textarea
          id="ro-tsp-draft"
          className="ro-drawer-textarea ro-tsp-draft"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type to compare contrast across themes…"
          spellCheck
        />
      </div>
      <div className="ro-tsp-split" ref={ref} data-snapshot-target="theme-split">
        <ThemeSplitPane theme="light" body={draft} />
        <ThemeSplitPane theme="dark" body={draft} />
      </div>
      <p className="ro-drawer-empty muted ro-tsp-hint">
        Tokens mirror <code className="ro-drawer-code">:root</code> &amp;{' '}
        <code className="ro-drawer-code">prefers-color-scheme: dark</code> from{' '}
        <code className="ro-drawer-code">index.css</code>.
      </p>
    </div>
  )
})

function ThemeSplitPane({ theme, body }: { theme: 'light' | 'dark'; body: string }) {
  const label = theme === 'light' ? 'Day' : 'Night'
  return (
    <div className={`ro-tsp-pane ro-tsp-pane--${theme}`} aria-label={`${label} theme preview`}>
      <div className="ro-tsp-pane-label">
        <span className="ro-tsp-pane-dot" aria-hidden="true" />
        {label}
      </div>
      <div className="ro-tsp-card">
        <p className="ro-tsp-card-kicker">Recursive outline</p>
        <h4 className="ro-tsp-card-title">Section heading sample</h4>
        <p className="ro-tsp-card-body">
          {body.trim() || 'Workspace contrast preview — switch themes side-by-side.'}
        </p>
        <div className="ro-tsp-card-toolbar">
          <button type="button" className="ro-tsp-btn" tabIndex={-1}>
            Edit
          </button>
          <button type="button" className="ro-tsp-btn ro-tsp-btn--accent" tabIndex={-1}>
            Expand
          </button>
        </div>
        <code className="ro-tsp-card-code">onAiIterate(req)</code>
      </div>
    </div>
  )
}

export default ThemeSplitPreview
