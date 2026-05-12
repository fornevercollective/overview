import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './presentation.css'
import { ExcalidrawLazyPanel } from './presentation/ExcalidrawLazy'

const DEFAULT_DECK = `Welcome to the reading room.

---

Use \`---\` or \`^^^\` on their own lines to split slides.

^^^

Typography and layout stay in-repo — no demo assets copied from Pretext.`

export type PresentationProps = {
  onBack: () => void
}

type BracketSlotId = 'r1a' | 'r1b' | 'r1c' | 'r1d' | 'r2a' | 'r2b' | 'r3'

function parseDeck(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n')
  const parts = normalized.split(/\n(?:---|\^\^\^)\n/)
  const slides = parts.map((s) => s.trim()).filter(Boolean)
  return slides.length ? slides : ['']
}

function randomTypingExcerpt(slides: string[], maxLen = 220): string {
  const flat = slides.join('\n\n').trim()
  if (!flat) return 'Add deck text to practice typing.'
  const paras = flat.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const pick = paras[Math.floor(Math.random() * paras.length)] ?? flat
  if (pick.length <= maxLen) return pick
  const start = Math.floor(Math.random() * Math.max(1, pick.length - maxLen))
  return pick.slice(start, start + maxLen)
}

function useInViewSectionRef(rootMargin = '0px 0px -12% 0px') {
  const [inView, setInView] = useState(false)
  const obsRef = useRef<IntersectionObserver | null>(null)
  const setSectionRef = useCallback((node: HTMLElement | null) => {
    obsRef.current?.disconnect()
    obsRef.current = null
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(false)
      return
    }
    const obs = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), {
      root: null,
      rootMargin,
      threshold: 0.15,
    })
    obs.observe(node)
    obsRef.current = obs
  }, [rootMargin])

  useEffect(() => {
    return () => {
      obsRef.current?.disconnect()
    }
  }, [])

  return [setSectionRef, inView] as const
}

function parseAllowlist(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function hostAllowed(urlStr: string, allowlist: string[]): boolean {
  if (!allowlist.length) return false
  try {
    const h = new URL(urlStr).hostname.toLowerCase()
    return allowlist.some((a) => a === h || h.endsWith(`.${a}`))
  } catch {
    return false
  }
}

function canAgentFetch(endpoint: string): { ok: boolean; detail: string } {
  let u: URL
  try {
    u = new URL(endpoint, window.location.href)
  } catch {
    return { ok: false, detail: 'Invalid endpoint URL.' }
  }
  if (u.origin === window.location.origin) return { ok: true, detail: '' }
  const base = import.meta.env.VITE_AGENT_BASE
  if (!base) return { ok: false, detail: 'Cross-origin blocked unless VITE_AGENT_BASE matches this host.' }
  try {
    const bu = new URL(base, window.location.href)
    if (u.origin === bu.origin) return { ok: true, detail: '' }
  } catch {
    return { ok: false, detail: 'Invalid VITE_AGENT_BASE in env.' }
  }
  return { ok: false, detail: 'Endpoint must be same-origin or the configured agent base origin.' }
}

export default function Presentation({ onBack }: PresentationProps) {
  const [deckRaw, setDeckRaw] = useState(DEFAULT_DECK)
  const slides = useMemo(() => parseDeck(deckRaw), [deckRaw])
  const [slideIdx, setSlideIdx] = useState(0)
  const maxSlideIdx = Math.max(0, slides.length - 1)
  const activeSlideIdx = Math.min(slideIdx, maxSlideIdx)
  const currentSlide = slides[activeSlideIdx] ?? ''

  const [deckSectionRef, deckInView] = useInViewSectionRef()
  const [embedSectionRef, embedInView] = useInViewSectionRef()
  const [drawSectionRef, drawInView] = useInViewSectionRef()
  const [audioSectionRef, audioInView] = useInViewSectionRef()
  const [bracketSectionRef, bracketInView] = useInViewSectionRef()
  const [agentSectionRef, agentInView] = useInViewSectionRef()
  const [typingSectionRef, typingInView] = useInViewSectionRef()

  const [embedUrl, setEmbedUrl] = useState('')
  const [allowHosts, setAllowHosts] = useState('')

  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const audioObjectUrl = useRef<string | null>(null)
  const onAudioFile = useCallback((f: File | null) => {
    if (audioObjectUrl.current) {
      URL.revokeObjectURL(audioObjectUrl.current)
      audioObjectUrl.current = null
    }
    if (!f) return
    const url = URL.createObjectURL(f)
    audioObjectUrl.current = url
    setAudioSrc(url)
  }, [])

  useEffect(() => {
    return () => {
      if (audioObjectUrl.current) URL.revokeObjectURL(audioObjectUrl.current)
    }
  }, [])

  const [audioUrlField, setAudioUrlField] = useState('')
  const applyAudioUrl = useCallback(() => {
    const t = audioUrlField.trim()
    if (!t) return
    try {
      const u = new URL(t)
      if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'blob:') return
      if (audioObjectUrl.current) {
        URL.revokeObjectURL(audioObjectUrl.current)
        audioObjectUrl.current = null
      }
      setAudioSrc(t)
    } catch {
      /* ignore invalid */
    }
  }, [audioUrlField])

  const [snapshotPool, setSnapshotPool] = useState<string[]>([])
  const addSnapshot = useCallback(() => {
    const snap = currentSlide.trim()
    if (!snap) return
    setSnapshotPool((p) => [...p, snap])
  }, [currentSlide])

  const [bracketPick, setBracketPick] = useState<Record<BracketSlotId, number>>(() => ({
    r1a: -1,
    r1b: -1,
    r1c: -1,
    r1d: -1,
    r2a: -1,
    r2b: -1,
    r3: -1,
  }))
  const [activeSlot, setActiveSlot] = useState<BracketSlotId | null>(null)

  const [agentEndpoint, setAgentEndpoint] = useState('')
  const [agentModel, setAgentModel] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentAck, setAgentAck] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentOut, setAgentOut] = useState<string | null>(null)
  const [agentErr, setAgentErr] = useState<string | null>(null)

  const runAgent = useCallback(async () => {
    setAgentErr(null)
    setAgentOut(null)
    if (!agentAck) {
      setAgentErr('Enable acknowledgment before calling the network.')
      return
    }
    const ep = agentEndpoint.trim()
    if (!ep) {
      setAgentErr('Enter an endpoint.')
      return
    }
    const gate = canAgentFetch(ep)
    if (!gate.ok) {
      setAgentErr(gate.detail)
      return
    }
    setAgentBusy(true)
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: agentModel.trim(), prompt: agentPrompt }),
      })
      const text = await res.text()
      setAgentOut(`${res.status} ${res.statusText}\n\n${text.slice(0, 8000)}`)
    } catch (e) {
      setAgentErr(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setAgentBusy(false)
    }
  }, [agentAck, agentEndpoint, agentModel, agentPrompt])

  const [typingTarget, setTypingTarget] = useState(() => randomTypingExcerpt(parseDeck(DEFAULT_DECK)))
  const [typingInput, setTypingInput] = useState('')
  const [typingStart, setTypingStart] = useState<number | null>(null)
  const [typingEndMs, setTypingEndMs] = useState<number | null>(null)
  const [typingDone, setTypingDone] = useState(false)

  const onTypingInputChange = useCallback(
    (v: string) => {
      setTypingInput(v)
      if (typingStart === null && v.length > 0) setTypingStart(performance.now())
      if (v === typingTarget) {
        setTypingDone(true)
        setTypingEndMs(performance.now())
      } else {
        setTypingDone(false)
        setTypingEndMs(null)
      }
    },
    [typingStart, typingTarget],
  )

  const refreshTyping = useCallback(() => {
    setTypingTarget(randomTypingExcerpt(slides))
    setTypingInput('')
    setTypingStart(null)
    setTypingEndMs(null)
    setTypingDone(false)
  }, [slides])

  const wpm = useMemo(() => {
    if (typingStart === null || typingEndMs === null || !typingDone) return null
    const ms = typingEndMs - typingStart
    const min = ms / 60000
    if (min <= 0) return null
    const words = typingTarget.length / 5
    return Math.round(words / min)
  }, [typingDone, typingEndMs, typingStart, typingTarget])

  const [pretextDirFiles, setPretextDirFiles] = useState<string[] | null>(null)
  const [pretextDirErr, setPretextDirErr] = useState<string | null>(null)

  const browseLocalDemos = useCallback(async () => {
    setPretextDirErr(null)
    setPretextDirFiles(null)
    const picker = (
      window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker
    if (!picker) {
      setPretextDirErr('File System Access API not available in this browser.')
      return
    }
    try {
      const root = await picker()
      const htmlNames: string[] = []
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file' && name.toLowerCase().endsWith('.html')) htmlNames.push(name)
      }
      htmlNames.sort()
      setPretextDirFiles(htmlNames)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setPretextDirErr(e instanceof Error ? e.message : 'Could not read folder.')
    }
  }, [])

  const allow = useMemo(() => parseAllowlist(allowHosts), [allowHosts])
  const embedOk = embedUrl.trim() && hostAllowed(embedUrl.trim(), allow)

  const onLoadDeckFile = useCallback((file: File | null) => {
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.txt') && !lower.endsWith('.md')) return
    void file.text().then(setDeckRaw)
  }, [])

  return (
    <div className="pr-root">
      <header className="pr-hero">
        <p className="pr-kicker">Phase 1 · reading room</p>
        <h1 className="pr-hero-title">Presentation</h1>
        <p className="pr-hero-lead pr-muted" style={{ marginBottom: 0 }}>
          Editorial-style rhythm in the hero, a delimiter-based deck, optional embeds, drawing, audio, bracket notes,
          agent stub, and a small typing drill — all additive to the main workspace.
        </p>
      </header>

      <section
        className={`pr-section${deckInView ? ' pr-section--inview' : ''}`}
        ref={deckSectionRef}
        aria-labelledby="pr-deck-title"
      >
        <h2 className="pr-section-title" id="pr-deck-title">
          Deck
        </h2>
        <p className="pr-muted">Slides separated by a line containing only <code>---</code> or <code>^^^</code>.</p>
        <div className="pr-deck-controls">
          <label className="pr-btn">
            Load .txt / .md
            <input
              hidden
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={(e) => onLoadDeckFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="button" className="pr-btn" onClick={() => setDeckRaw(DEFAULT_DECK)}>
            Reset sample deck
          </button>
        </div>
        <textarea className="pr-textarea" value={deckRaw} onChange={(e) => setDeckRaw(e.target.value)} spellCheck />
        <div className="pr-slide-nav" role="tablist" aria-label="Slides">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === activeSlideIdx}
              className={i === activeSlideIdx ? 'pr-slide-nav--active' : undefined}
              onClick={() => setSlideIdx(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <article className="pr-slide-body" aria-live="polite">
          {currentSlide}
        </article>
      </section>

      <section
        className={`pr-section${embedInView ? ' pr-section--inview' : ''}`}
        ref={embedSectionRef}
        aria-labelledby="pr-pretext-title"
      >
        <h2 className="pr-section-title" id="pr-pretext-title">
          Pretext demos · inventory &amp; embed
        </h2>
        <p className="pr-muted">
          Local inventory (read-only scan of{' '}
          <code className="overview-summary-code">pretext-demos-main</code>): entry <code>index.html</code>; demos{' '}
          <code>demo-127.html</code>, <code>demo-147.html</code>, <code>demo-148.html</code>,{' '}
          <code>demo-144.html</code>, <code>fluid-smoke.html</code>, <code>justification-comparison.html</code>,{' '}
          <code>shrinkwrap-showdown.html</code>, <code>the-editorial-engine.html</code>,{' '}
          <code>variable-typographic-ascii.html</code>; scripts <code>pretext.js</code>, matching <code>.js</code> pairs.
          Nothing from that tree is vendored here.
        </p>
        <p className="pr-muted">
          Optional: pick a folder (Chrome / Edge) to list <code>*.html</code> names — no files are copied into git.
        </p>
        <button type="button" className="pr-btn pr-btn-primary" onClick={() => void browseLocalDemos()}>
          List HTML in chosen folder
        </button>
        {pretextDirErr ? <p className="pr-muted">{pretextDirErr}</p> : null}
        {pretextDirFiles ? (
          <ul className="pr-dir-list">
            {pretextDirFiles.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        <h3 className="pr-section-title" style={{ fontSize: '0.95rem', marginTop: '18px' }}>
          External embed slot
        </h3>
        <p className="pr-muted">
          Paste an https URL. Iframe loads only when the host matches an entry in the allowlist (comma or
          whitespace-separated). Empty allowlist keeps the frame blank — add hosts you trust (for example your GitHub
          Pages domain).
        </p>
        <div className="pr-field">
          <label className="pr-muted" htmlFor="pr-embed-url">
            URL
          </label>
          <input
            id="pr-embed-url"
            className="pr-input"
            value={embedUrl}
            onChange={(e) => setEmbedUrl(e.target.value)}
            placeholder="https://…"
            autoComplete="url"
          />
        </div>
        <div className="pr-field">
          <label className="pr-muted" htmlFor="pr-allow">
            Allowed hostnames
          </label>
          <input
            id="pr-allow"
            className="pr-input"
            value={allowHosts}
            onChange={(e) => setAllowHosts(e.target.value)}
            placeholder="username.github.io, localhost"
          />
        </div>
        <div className="pr-embed-wrap" role="region" aria-label="Embedded page preview">
          {embedOk ? (
            <iframe
              title="User-selected embed"
              src={embedUrl.trim()}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div style={{ padding: '16px', color: 'var(--muted)' }}>
              {!embedUrl.trim()
                ? 'Enter a URL and allowlist hosts to preview.'
                : !allow.length
                  ? 'Add at least one allowed hostname to enable the iframe.'
                  : 'Host not in allowlist or invalid URL.'}
            </div>
          )}
        </div>
      </section>

      <section
        className={`pr-section${drawInView ? ' pr-section--inview' : ''}`}
        ref={drawSectionRef}
        aria-labelledby="pr-draw-title"
      >
        <h2 className="pr-section-title" id="pr-draw-title">
          Drawing
        </h2>
        <p className="pr-muted">
          In-app board loads lazily in a separate chunk. For a full-window editor you can still use the hosted app.
        </p>
        <p className="pr-excal-fallback">
          <a
            className="overview-summary-link"
            href="https://excalidraw.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open excalidraw.com
          </a>{' '}
          in a new tab if the panel below is too heavy for your device.
        </p>
        <ExcalidrawLazyPanel />
      </section>

      <section
        className={`pr-section${audioInView ? ' pr-section--inview' : ''}`}
        ref={audioSectionRef}
        aria-labelledby="pr-audio-title"
      >
        <h2 className="pr-section-title" id="pr-audio-title">
          Audio
        </h2>
        <p className="pr-muted">Session-only: pick a local file or paste a direct audio URL.</p>
        <div className="pr-audio-row">
          <label className="pr-btn">
            Audio file
            <input hidden type="file" accept="audio/*" onChange={(e) => onAudioFile(e.target.files?.[0] ?? null)} />
          </label>
          <input
            className="pr-input"
            style={{ flex: '2 1 200px' }}
            value={audioUrlField}
            onChange={(e) => setAudioUrlField(e.target.value)}
            placeholder="https://…/track.mp3"
          />
          <button type="button" className="pr-btn" onClick={applyAudioUrl}>
            Use URL
          </button>
        </div>
        {audioSrc ? <audio controls src={audioSrc} style={{ width: '100%', marginTop: '12px' }} /> : null}
      </section>

      <section
        className={`pr-section${bracketInView ? ' pr-section--inview' : ''}`}
        ref={bracketSectionRef}
        aria-labelledby="pr-bracket-title"
      >
        <h2 className="pr-section-title" id="pr-bracket-title">
          Bracket (stub)
        </h2>
        <p className="pr-muted">
          Static 4 → 2 → 1 layout. Capture slide text into the pool, then attach snapshots to each slot (session
          state only).
        </p>
        <button type="button" className="pr-btn pr-btn-primary" onClick={addSnapshot}>
          Save current slide to snapshot pool
        </button>
        <p className="pr-muted">Pool size: {snapshotPool.length}</p>

        <div className="pr-bracket" style={{ marginTop: '16px' }}>
          <div className="pr-bracket-col">
            <div className="pr-bracket-label">Round of 4</div>
            {(['r1a', 'r1b', 'r1c', 'r1d'] as const).map((id) => (
              <div
                key={id}
                className={`pr-slot${activeSlot === id ? ' pr-slot--active' : ''}`}
                onClick={() => setActiveSlot(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setActiveSlot(id)
                }}
                role="button"
                tabIndex={0}
              >
                <strong>{id.toUpperCase()}</strong>
                <select
                  aria-label={`Attach snapshot for ${id}`}
                  value={bracketPick[id]}
                  onChange={(e) =>
                    setBracketPick((p) => ({ ...p, [id]: Number.parseInt(e.target.value, 10) || -1 }))
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value={-1}>— none —</option>
                  {snapshotPool.map((s, i) => (
                    <option key={i} value={i}>
                      {s.slice(0, 48).replace(/\s+/g, ' ')}
                      {s.length > 48 ? '…' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="pr-bracket-col">
            <div className="pr-bracket-label">Semis</div>
            {(['r2a', 'r2b'] as const).map((id) => (
              <div
                key={id}
                className={`pr-slot${activeSlot === id ? ' pr-slot--active' : ''}`}
                onClick={() => setActiveSlot(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setActiveSlot(id)
                }}
                role="button"
                tabIndex={0}
              >
                <strong>{id.toUpperCase()}</strong>
                <select
                  aria-label={`Attach snapshot for ${id}`}
                  value={bracketPick[id]}
                  onChange={(e) =>
                    setBracketPick((p) => ({ ...p, [id]: Number.parseInt(e.target.value, 10) || -1 }))
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value={-1}>— none —</option>
                  {snapshotPool.map((s, i) => (
                    <option key={i} value={i}>
                      {s.slice(0, 48).replace(/\s+/g, ' ')}
                      {s.length > 48 ? '…' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="pr-bracket-col">
            <div className="pr-bracket-label">Final</div>
            <div
              className={`pr-slot${activeSlot === 'r3' ? ' pr-slot--active' : ''}`}
              onClick={() => setActiveSlot('r3')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveSlot('r3')
              }}
              role="button"
              tabIndex={0}
            >
              <strong>R3</strong>
              <select
                aria-label="Attach snapshot for final"
                value={bracketPick.r3}
                onChange={(e) =>
                  setBracketPick((p) => ({ ...p, r3: Number.parseInt(e.target.value, 10) || -1 }))
                }
                onClick={(e) => e.stopPropagation()}
              >
                <option value={-1}>— none —</option>
                {snapshotPool.map((s, i) => (
                  <option key={i} value={i}>
                    {s.slice(0, 48).replace(/\s+/g, ' ')}
                    {s.length > 48 ? '…' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`pr-section${agentInView ? ' pr-section--inview' : ''}`}
        ref={agentSectionRef}
        aria-labelledby="pr-agent-title"
      >
        <h2 className="pr-section-title" id="pr-agent-title">
          Multimodel / autoresearch (UI stub)
        </h2>
        <p className="pr-muted">
          Anything LLM, nanochat, or Karpathy-style autoresearch need a host service you control. This form only issues a
          POST when you acknowledge and the endpoint passes the same-origin / <code>VITE_AGENT_BASE</code> gate.
        </p>
        <div className="pr-agent-form">
          <div className="pr-field">
            <label htmlFor="pr-agent-url">Endpoint URL</label>
            <input
              id="pr-agent-url"
              className="pr-input"
              value={agentEndpoint}
              onChange={(e) => setAgentEndpoint(e.target.value)}
              placeholder="/api/agent or https://proxy.example/v1/chat"
            />
          </div>
          <div className="pr-field">
            <label htmlFor="pr-agent-model">Model id</label>
            <input
              id="pr-agent-model"
              className="pr-input"
              value={agentModel}
              onChange={(e) => setAgentModel(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="pr-field">
            <label htmlFor="pr-agent-prompt">Batch prompt</label>
            <textarea
              id="pr-agent-prompt"
              className="pr-textarea"
              style={{ minHeight: '100px' }}
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
            />
          </div>
          <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={agentAck} onChange={(e) => setAgentAck(e.target.checked)} />
            <span className="pr-muted" style={{ margin: 0 }}>
              I understand this sends the prompt to the configured URL (disabled by default).
            </span>
          </label>
          <button
            type="button"
            className="pr-btn pr-btn-primary"
            style={{ marginTop: '10px' }}
            disabled={agentBusy}
            onClick={() => void runAgent()}
          >
            {agentBusy ? 'Running…' : 'Run'}
          </button>
          {agentErr ? (
            <pre className="pr-typing-target" style={{ color: 'var(--text-h)' }}>
              {agentErr}
            </pre>
          ) : null}
          {agentOut ? (
            <pre className="pr-typing-target" style={{ marginTop: '8px' }}>
              {agentOut}
            </pre>
          ) : null}
        </div>
      </section>

      <section
        className={`pr-section${typingInView ? ' pr-section--inview' : ''}`}
        ref={typingSectionRef}
        aria-labelledby="pr-typing-title"
      >
        <h2 className="pr-section-title" id="pr-typing-title">
          Typing drill (stub)
        </h2>
        <p className="pr-muted">Retype the excerpt. WPM uses characters ÷ 5 over elapsed time when you finish.</p>
        <div className="pr-typing-target">{typingTarget}</div>
        <textarea
          className="pr-textarea"
          style={{ minHeight: '100px' }}
          value={typingInput}
          onChange={(e) => {
            onTypingInputChange(e.target.value)
          }}
          spellCheck={false}
          autoComplete="off"
          aria-label="Typing practice input"
        />
        <p className="pr-typing-stats">
          {typingDone && wpm != null ? `Done · ~${wpm} WPM` : 'Keep going…'}
        </p>
        <button type="button" className="pr-btn" onClick={refreshTyping}>
          New excerpt from deck
        </button>
      </section>

      <footer className="pr-footer">
        <button type="button" className="pr-btn" onClick={onBack}>
          ← Workspace
        </button>
        <span className="pr-muted">Credits:</span>
        <a href="https://github.com/mueee/pretext-demos" target="_blank" rel="noopener noreferrer">
          pretext-demos (GitHub)
        </a>
        <a href="https://github.com/topics/awesome-pretext" target="_blank" rel="noopener noreferrer">
          awesome-pretext (GitHub topic)
        </a>
        <a href="https://github.com/leerob/leerob" target="_blank" rel="noopener noreferrer">
          leerob (example repo)
        </a>
        <a href="https://github.com/leerob" target="_blank" rel="noopener noreferrer">
          leerob profile
        </a>
      </footer>
    </div>
  )
}
