import { useCallback, useMemo, useState } from 'react'

export type SessionProps = {
  onBackToWorkspace: () => void
  onOpenSummary?: () => void
  onOpenPresentation?: () => void
  onOpenSketch?: () => void
}

type Topic = { heading: string; body: string }

const SNAPSHOT_DATE = '2026-05-13'

const TODAY_TOPICS: Topic[] = [
  {
    heading: 'Surveyed fornevercollective/overview',
    body:
      'Hit the GitHub Pages deploy and repo. Confirmed single-page React + TS + Vite, ' +
      'client-only state, JSON snapshots, gzip / lz-string share URLs, lazy Excalidraw whiteboard. ' +
      'No backend by default; outline AI uses local OpenAI-compatible chat from App (Ollama by default) or deterministic stubs when handlers are omitted.',
  },
  {
    heading: 'Cloned into ~/dev/overview',
    body:
      'Live tree on the new laptop. Project HD with the rest of the source not yet plugged in, so this ' +
      'is one of the first repos sitting locally on this machine.',
  },
  {
    heading: 'Decided to add a Session briefing tab',
    body:
      'New page mode `session`, mirrored on the Summary / Presentation / Sketch routing pattern. ' +
      'Acts as a snapshot of the current chat, forward-build direction, and host state at clone time.',
  },
  {
    heading: 'Mapped forward-build context from prior chats',
    body:
      'mu (terminal emulator, Cursor-prototyped) + Colossus / LTS dojo headless compute. ' +
      'Architectural fork still open: Rust + wgpu + cosmic-text + alacritty_terminal as the boring-safe ' +
      'five-year stack, vs. Mosh-shaped split where VT state lives on remote and mu becomes a thin ' +
      'predictive surface over UDP — "Mu becomes a protocol, not an app."',
  },
]

const FORWARD_BUILD_NOTES: Topic[] = [
  {
    heading: 'Cold-start + static linking',
    body:
      'Self-contained binaries; avoid AppKit / Swift runtime bloat on macOS targets. Boot time and ' +
      'steady-state speed are treated as first-class metrics, not afterthoughts.',
  },
  {
    heading: 'Decouple VT state from renderer',
    body:
      'Run the VT state machine at headless-multiplexer speed regardless of where pixels land. ' +
      'GUI is one of several front-ends; the protocol is the project.',
  },
  {
    heading: 'Local-thin / remote-heavy for Colossus',
    body:
      'For cluster work the remote owns the truth (VT, scrollback, env). Local mu predicts and renders. ' +
      'Mosh-style UDP transport, not SSH-stream replay.',
  },
  {
    heading: 'Forward AND backward binary compatibility',
    body:
      'Rust ABI stability is a constraint, not a wish. C++26 is too unstable through ~2027; pre-1.0 Zig ' +
      'is off the table unless explicitly chosen. Keep the toolchain choice durable.',
  },
  {
    heading: 'Overview as the research surface',
    body:
      'This app is the "outline + briefing + presentation" surface that sits over the above work. ' +
      'Snapshot JSON (`OverviewWorkspaceSnapshot` v2) is the stable interchange for MCP / RAG / ' +
      'Actions pipelines downstream.',
  },
]

type RunningProc = {
  name: string
  detail: string
  port?: string
  cpu?: string
}

const RUNNING_AT_SNAPSHOT: RunningProc[] = [
  { name: 'zed', detail: 'Editor — primary foreground app', cpu: '~63% CPU' },
  { name: 'ollama', detail: 'Local model runtime', port: '127.0.0.1:11434' },
  {
    name: 'node (models-explorer)',
    detail: '/Users/qbit/models/models-explorer dev server',
    port: '127.0.0.1:4321',
  },
  { name: 'claude (×5)', detail: 'Active Claude Code sessions in this and other shells' },
  { name: 'rapportd', detail: 'AirDrop / Continuity (Apple), listening on dynamic ports' },
  { name: 'brew services', detail: 'None active (unbound configured but stopped)' },
]

const REPO_INVENTORY: Topic[] = [
  {
    heading: '~/dev/mueee',
    body:
      'HTML/JS prototype field: hexcast (bloch-bridge.js, manifest, send.html), kbatch panels (raw/scoped CSS, ' +
      'tab-query, sportsfield aggregate, main.js), qbit-steno (pad, term, .js), iron-dispatch + v2-snapshot, ' +
      'iron-browser, jawta-audio, history-search-engine (.js + .d.ts), qbit-uv-shell, qbit-raw-v1, ugrad-r0. ' +
      'Vibe-coded surface; the depth is in how these talk to each other.',
  },
  {
    heading: '~/dev/mueee-kbatch',
    body:
      'Rust workspace. Top level: Cargo.toml, rust-toolchain.toml, crates/, capsules/, grammars/, ingest/, ' +
      'proto/, wit/. WIT directory suggests WASM-component-model interface boundaries — capsule/grammar split ' +
      'looks like a parser-front-end + executor-backend layout.',
  },
  {
    heading: '~/dev/overview (this repo, fresh clone)',
    body: 'fornevercollective/overview at clone time. This Session tab is the first local edit.',
  },
  {
    heading: '~/dev/update',
    body: 'Empty placeholder.',
  },
]

function topicsToMarkdown(label: string, topics: Topic[]): string {
  const lines = [`## ${label}`, '']
  for (const t of topics) {
    lines.push(`### ${t.heading}`, '', t.body, '')
  }
  return lines.join('\n')
}

function runningToMarkdown(): string {
  const lines = ['## Currently running (snapshot)', '']
  for (const p of RUNNING_AT_SNAPSHOT) {
    const tail = [p.port, p.cpu].filter(Boolean).join(' · ')
    lines.push(`- **${p.name}** — ${p.detail}${tail ? ` (${tail})` : ''}`)
  }
  return lines.join('\n')
}

function buildBriefingMarkdown(): string {
  return [
    `# Session briefing — ${SNAPSHOT_DATE}`,
    '',
    topicsToMarkdown('Discussed today', TODAY_TOPICS),
    topicsToMarkdown('Forward-build direction', FORWARD_BUILD_NOTES),
    runningToMarkdown(),
    '',
    topicsToMarkdown('Local repo inventory', REPO_INVENTORY),
  ].join('\n')
}

export default function Session({
  onBackToWorkspace,
  onOpenSummary,
  onOpenPresentation,
  onOpenSketch,
}: SessionProps) {
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const briefing = useMemo(() => buildBriefingMarkdown(), [])

  const onCopyBriefing = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(briefing)
      setCopyNotice('Briefing copied as markdown.')
    } catch {
      setCopyNotice('Clipboard blocked — select the page text manually.')
    }
  }, [briefing])

  return (
    <div className="overview-summary">
      <header className="overview-summary-header">
        <p className="overview-summary-kicker">Overview · Session</p>
        <h1 className="overview-summary-title">Session briefing</h1>
        <p className="overview-summary-lead">
          What was discussed in today&rsquo;s chat, the forward-build direction this fork is being shaped
          around, and the host processes alive when this snapshot was captured.{' '}
          <span className="overview-summary-muted">Snapshot date: {SNAPSHOT_DATE}.</span>
        </p>
      </header>

      <section className="overview-summary-section" aria-labelledby="session-today">
        <h2 id="session-today">Discussed today</h2>
        <ul className="overview-summary-list">
          {TODAY_TOPICS.map((t) => (
            <li key={t.heading}>
              <strong>{t.heading}</strong> — {t.body}
            </li>
          ))}
        </ul>
      </section>

      <section className="overview-summary-section" aria-labelledby="session-forward">
        <h2 id="session-forward">Forward-build direction</h2>
        <ul className="overview-summary-list">
          {FORWARD_BUILD_NOTES.map((t) => (
            <li key={t.heading}>
              <strong>{t.heading}</strong> — {t.body}
            </li>
          ))}
        </ul>
      </section>

      <section className="overview-summary-section" aria-labelledby="session-running">
        <h2 id="session-running">Currently running</h2>
        <ul className="overview-summary-list">
          {RUNNING_AT_SNAPSHOT.map((p) => {
            const tail = [p.port, p.cpu].filter(Boolean).join(' · ')
            return (
              <li key={p.name}>
                <strong>{p.name}</strong> — {p.detail}
                {tail ? (
                  <>
                    {' '}
                    <code className="overview-summary-code">{tail}</code>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
        <p className="overview-summary-hint">
          Static snapshot at clone time. The app is client-only, so it can&rsquo;t live-poll the host;
          re-snapshot from a shell when state has moved.
        </p>
      </section>

      <section className="overview-summary-section" aria-labelledby="session-repos">
        <h2 id="session-repos">Local repo inventory</h2>
        <ul className="overview-summary-list">
          {REPO_INVENTORY.map((r) => (
            <li key={r.heading}>
              <strong>
                <code className="overview-summary-code">{r.heading}</code>
              </strong>{' '}
              — {r.body}
            </li>
          ))}
        </ul>
      </section>

      <section className="overview-summary-section" aria-labelledby="session-actions">
        <h2 id="session-actions">Actions</h2>
        <div className="overview-summary-actions">
          <button
            type="button"
            className="overview-summary-btn overview-summary-btn-primary"
            onClick={onCopyBriefing}
          >
            Copy briefing as markdown
          </button>
          {copyNotice ? (
            <p className="overview-summary-share-notice" role="status" aria-live="polite">
              {copyNotice}
            </p>
          ) : null}
          <button type="button" className="overview-summary-btn overview-summary-btn-ghost" onClick={onBackToWorkspace}>
            Back to workspace
          </button>
        </div>
      </section>

      <footer className="overview-summary-footer">
        <button type="button" className="overview-summary-footer-link" onClick={onBackToWorkspace}>
          &larr; Workspace
        </button>
        {onOpenSummary ? (
          <>
            <span className="overview-summary-muted"> · </span>
            <button type="button" className="overview-summary-footer-link" onClick={onOpenSummary}>
              Summary
            </button>
          </>
        ) : null}
        {onOpenPresentation ? (
          <>
            <span className="overview-summary-muted"> · </span>
            <button type="button" className="overview-summary-footer-link" onClick={onOpenPresentation}>
              Presentation
            </button>
          </>
        ) : null}
        {onOpenSketch ? (
          <>
            <span className="overview-summary-muted"> · </span>
            <button type="button" className="overview-summary-footer-link" onClick={onOpenSketch}>
              Sketch
            </button>
          </>
        ) : null}
        <span className="overview-summary-muted"> · </span>
        <span className="overview-summary-muted">Session</span>
      </footer>
    </div>
  )
}
