import { useCallback, useEffect, useMemo, useRef, useState, type ToggleEvent } from 'react'
import { ffmpegCdnStreamUrlForVideoId } from '../util/ffmpegStreamUrl'
import { parseYouTubeVideoId, stripYouTubePasteDecorators } from '../util/youtube'
import {
  ensureYouTubeIframeApi,
  isYoutubePlayerPlaying,
  kickYouTubeIframeCaptions,
  type YoutubePlayerHandle,
} from '../util/youtubeIframeApi'
import './transcript-lab.css'

function formatYtSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--'
  const rounded = Math.floor(totalSeconds + 1e-3)
  const s = rounded % 60
  const m = Math.floor(rounded / 60) % 60
  const h = Math.floor(rounded / 3600)
  const ss = String(s).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  if (h <= 0) return `${mm}:${ss}`
  return `${h}:${mm}:${ss}`
}

function youtubeClock(current: number, duration: number): string {
  return `${formatYtSeconds(current)} · ${Number.isFinite(duration) && duration > 0 ? formatYtSeconds(duration) : '--:--'}`
}

export type TranscriptCompareHeroProps = {
  /** Hero ingest field: when it contains a YouTube URL or bare id, the dock player loads that clip. */
  linkedIngestQuery?: string
  /** When your pipeline resolves a chapter / segment title for this clip, show it in the dock meta. */
  chapterTitle?: string
  /** When true, hide the whole dock (e.g. full-page document reading mode). */
  hidden?: boolean
}

/** Three columns: built-in Whisper ASR · plain transcript · timed captions (scroll sync optional). No video until a URL is present. */
export default function TranscriptCompareHero({ linkedIngestQuery, chapterTitle, hidden }: TranscriptCompareHeroProps) {
  const effectiveVideoId = useMemo(() => {
    const raw = (linkedIngestQuery ?? '').trim()
    if (!raw) return null
    return parseYouTubeVideoId(stripYouTubePasteDecorators(raw))
  }, [linkedIngestQuery])

  const cdnStreamUrl = useMemo(
    () => (effectiveVideoId ? ffmpegCdnStreamUrlForVideoId(effectiveVideoId) : ''),
    [effectiveVideoId],
  )
  const chapterLine = chapterTitle?.trim() ?? ''

  const [dockOpen, setDockOpen] = useState(false)
  const [colsOpen, setColsOpen] = useState(false)
  const [scrollSync, setScrollSync] = useState(true)
  const [timelock, setTimelock] = useState('--:-- · --:--')
  const syncing = useRef(false)

  const ytMountRef = useRef<HTMLDivElement>(null)
  const ytPlayerRef = useRef<YoutubePlayerHandle | null>(null)
  const tickTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!effectiveVideoId) {
      if (tickTimerRef.current) {
        window.clearInterval(tickTimerRef.current)
        tickTimerRef.current = null
      }
      try {
        ytPlayerRef.current?.destroy()
      } catch {
        /**/
      }
      ytPlayerRef.current = null
      queueMicrotask(() => setTimelock('--:-- · --:--'))
      return
    }

    queueMicrotask(() => setTimelock('--:-- · --:--'))

    let alive = true
    const mount = ytMountRef.current
    if (!mount) return

    void ensureYouTubeIframeApi().then(() => {
      if (!alive || !effectiveVideoId || !ytMountRef.current) return

      try {
        const YTapi = window.YT
        if (!YTapi) return

        ytPlayerRef.current = new YTapi.Player(mount, {
          videoId: effectiveVideoId,
          playerVars: {
            autoplay: 0,
            cc_lang_pref: 'en',
            cc_load_policy: 1,
            enablejsapi: 1,
            hl: 'en',
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (e: { target: YoutubePlayerHandle }) => {
              ytPlayerRef.current = e.target
              kickYouTubeIframeCaptions(e.target)
              let previous = ''
              const tick = () => {
                const p = ytPlayerRef.current
                if (!p?.getCurrentTime) return
                try {
                  const next = youtubeClock(p.getCurrentTime(), p.getDuration())
                  if (next !== previous) {
                    previous = next
                    setTimelock(next)
                  }
                } catch {
                  /**/
                }
              }
              tick()
              tickTimerRef.current = window.setInterval(tick, 250)
            },
            onApiChange: (e: { target: YoutubePlayerHandle }) => {
              kickYouTubeIframeCaptions(e.target)
            },
            onStateChange: (e: { target: YoutubePlayerHandle; data: number }) => {
              if (!isYoutubePlayerPlaying(e.data)) return
              const p = e.target
              window.setTimeout(() => kickYouTubeIframeCaptions(p), 350)
              window.setTimeout(() => kickYouTubeIframeCaptions(p), 1600)
            },
          },
        })
      } catch {
        queueMicrotask(() => setTimelock('--:-- · --:--'))
      }
    })

    return () => {
      alive = false
      if (tickTimerRef.current) {
        window.clearInterval(tickTimerRef.current)
        tickTimerRef.current = null
      }
      try {
        ytPlayerRef.current?.destroy()
      } catch {
        /**/
      }
      ytPlayerRef.current = null
    }
  }, [effectiveVideoId])

  const wRef = useRef<HTMLTextAreaElement>(null)
  const tRef = useRef<HTMLTextAreaElement>(null)
  const cRef = useRef<HTMLTextAreaElement>(null)

  const pumpScroll = useCallback(
    (sourceIndex: number) => {
      if (!scrollSync || syncing.current) return
      syncing.current = true
      const refs = [wRef, tRef, cRef]
      const src = refs[sourceIndex].current
      if (!src) {
        syncing.current = false
        return
      }
      const maxSrc = Math.max(0, src.scrollHeight - src.clientHeight)
      const ratio = maxSrc ? src.scrollTop / maxSrc : 0
      for (let i = 0; i < refs.length; i++) {
        if (i === sourceIndex) continue
        const o = refs[i].current
        if (!o) continue
        const mo = Math.max(0, o.scrollHeight - o.clientHeight)
        o.scrollTop = ratio * mo
      }
      queueMicrotask(() => {
        syncing.current = false
      })
    },
    [scrollSync],
  )

  const onDockToggle = useCallback((e: ToggleEvent<HTMLDetailsElement>) => {
    setDockOpen(e.currentTarget.open)
  }, [])

  const onColsToggle = useCallback((e: ToggleEvent<HTMLDetailsElement>) => {
    setColsOpen(e.currentTarget.open)
  }, [])

  if (hidden) return null

  const watchHref = effectiveVideoId ? `https://www.youtube.com/watch?v=${effectiveVideoId}` : ''
  const idLabel = effectiveVideoId ?? '—'

  return (
    <section className="ro-transcript-dock" aria-labelledby="ro-transcript-dock-summary-label">
      <details className="ro-transcript-dock-details" open={dockOpen} onToggle={onDockToggle}>
        <summary className="ro-transcript-dock-summary">
          <span id="ro-transcript-dock-summary-label" className="ro-transcript-dock-summary-title">
            Transcript compare dock
          </span>
          <span className="ro-transcript-dock-summary-hint muted">
            {effectiveVideoId ? `Clip ${effectiveVideoId}` : 'YouTube · Whisper · transcript · captions'}
          </span>
        </summary>

        <div className="ro-transcript-dock-panel">
      <div className="ro-transcript-dock-head">
        <dl className="ro-transcript-dock-meta">
          <dt>video id</dt>
          <dd>{idLabel}</dd>
          <dt>watch</dt>
          <dd>
            {watchHref ? (
              <a className="ro-transcript-dock-meta-link" href={watchHref} target="_blank" rel="noopener noreferrer">
                youtube.com/watch?v={effectiveVideoId}
              </a>
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
          <dt title="Optional: set VITE_FFMPEG_STREAM_URL_TEMPLATE with {id} or {videoId} for this YouTube id.">
            cdn stream
          </dt>
          <dd>
            {cdnStreamUrl ? (
              <a
                className="ro-transcript-dock-meta-link"
                href={cdnStreamUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {cdnStreamUrl}
              </a>
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
          <dt>chapter</dt>
          <dd>{chapterLine ? chapterLine : <span className="muted">—</span>}</dd>
        </dl>
        <div className="ro-transcript-dock-video" data-stable-video-shell>
          {effectiveVideoId ? (
            <div className="ro-transcript-dock-ratio">
              <div
                className="ro-transcript-dock-yt-root"
                ref={ytMountRef}
                aria-label="YouTube player"
              />
            </div>
          ) : (
            <div className="ro-transcript-dock-ratio ro-transcript-dock-placeholder">
              <p className="ro-transcript-dock-placeholder-text">
                No video embedded. Paste a YouTube URL in the hero field when you need a clip; otherwise use
                transcript text, workspace notes, corpus search, or book refs and seed the outline from the topic line
                above.
              </p>
            </div>
          )}
          <div className="ro-transcript-dock-timelock" role="status" aria-live="polite">
            <span className="ro-transcript-dock-timelock-label">timelock</span>
            <span className="muted" aria-hidden>
              —
            </span>
            <span className="ro-transcript-dock-timelock-label muted">syn</span>
            <span className="ro-transcript-dock-timelock-num">{timelock}</span>
          </div>
        </div>
      </div>

      <label className="ro-transcript-dock-sync">
        <input type="checkbox" checked={scrollSync} onChange={(e) => setScrollSync(e.target.checked)} />
        Sync scroll across columns <span className="muted">(proportional to length)</span>
      </label>

      <details
        className="ro-transcript-dock-cols-details"
        open={colsOpen}
        onToggle={onColsToggle}
        aria-labelledby="ro-transcript-dock-cols-summary-label"
      >
        <summary className="ro-transcript-dock-cols-summary">
          <span id="ro-transcript-dock-cols-summary-label" className="ro-transcript-dock-cols-summary-title">
            Whisper · transcript · captions
          </span>
          <span className="ro-transcript-dock-cols-summary-hint muted">Three columns — open to edit or paste</span>
        </summary>
        <div className="ro-transcript-dock-scroll">
          <div className="ro-transcript-dock-cols">
            <div className="ro-transcript-dock-col">
              <span className="ro-transcript-dock-col-hdr">Whisper</span>
              <textarea
                ref={wRef}
                className="ro-transcript-dock-ta"
                spellCheck={false}
                aria-label="Built-in Whisper transcript"
                placeholder="Built-in Whisper output appears here. Paste segments only to supplement or replace."
                onScroll={() => pumpScroll(0)}
              />
              <span className="ro-transcript-dock-micro muted">system ASR</span>
            </div>
            <div className="ro-transcript-dock-col">
              <span className="ro-transcript-dock-col-hdr">transcript</span>
              <textarea
                ref={tRef}
                className="ro-transcript-dock-ta"
                spellCheck={false}
                aria-label="Transcript"
                placeholder="Paste transcript text, book quotations, or a cleaned talk track here…"
                onScroll={() => pumpScroll(1)}
              />
              <span className="ro-transcript-dock-micro muted">spoken text / stripped</span>
            </div>
            <div className="ro-transcript-dock-col">
              <span className="ro-transcript-dock-col-hdr">captions</span>
              <textarea
                ref={cRef}
                className="ro-transcript-dock-ta"
                spellCheck={false}
                aria-label="Captions"
                placeholder="Paste .srt / .vtt or timed captions export…"
                onScroll={() => pumpScroll(2)}
              />
              <span className="ro-transcript-dock-micro muted">reference timings</span>
            </div>
          </div>
        </div>
      </details>
        </div>
      </details>
    </section>
  )
}
