import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { drawHexFrame, type HexFrameMsg } from './liveHexCodec'

const DEFAULT_FEED = '__default__'
const RAIL_COLS = 4
const RAIL_ROWS = 7
const RAIL_THUMB_PX = 40
const WALL_THUMB_PX = 56
const WALL_MAX_TILES = 120

const RAIL_TILE_TOPO = (() => {
  const tiles: { key: string; nx: number; ny: number; i: number; zSlot: number }[] = []
  const cx = Math.max(1, RAIL_COLS - 1)
  const cy = Math.max(1, RAIL_ROWS - 1)
  let i = 0
  for (let r = 0; r < RAIL_ROWS; r++) {
    for (let c = 0; c < RAIL_COLS; c++) {
      const nx = (c / cx) * 2 - 1
      const ny = (r / cy) * 2 - 1
      const dc = Math.hypot(c - (RAIL_COLS - 1) / 2, r - (RAIL_ROWS - 1) / 2)
      const zSlot = dc < 0.95 ? 2 : dc < 1.85 ? 1 : 0
      tiles.push({ key: `${r}-${c}`, nx, ny, i, zSlot })
      i++
    }
  }
  return tiles
})()

export type VflFeedMosaicProps = {
  framesRef: RefObject<Record<string, HexFrameMsg>>
  feedKeys: string[]
  thumbSeq: number
  variant: 'rail' | 'wall'
  wallLayout?: 'dense' | 'checker'
  activeFeedKey?: string | null
  onSelectFeed?: (feedKey: string) => void
  offThumbRef?: RefObject<HTMLCanvasElement | null>
}

function wallSlots(feedKeys: string[]): { feedKey: string; row: number; col: number; i: number }[] {
  const keys = feedKeys.length > 0 ? feedKeys.slice(0, WALL_MAX_TILES) : [DEFAULT_FEED]
  const n = keys.length
  const cols = Math.max(4, Math.ceil(Math.sqrt(n * 1.55)))
  return keys.map((feedKey, i) => ({
    feedKey,
    row: Math.floor(i / cols),
    col: i % cols,
    i,
  }))
}

export function VflFeedMosaic({
  framesRef,
  feedKeys,
  thumbSeq,
  variant,
  wallLayout = 'dense',
  activeFeedKey = null,
  onSelectFeed,
  offThumbRef,
}: VflFeedMosaicProps) {
  const railRef = useRef<HTMLElement>(null)
  const wallRef = useRef<HTMLDivElement>(null)
  const tileDisplayRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const thumbPx = variant === 'rail' ? RAIL_THUMB_PX : WALL_THUMB_PX
  const wallSlotsMemo = useMemo(() => (variant === 'wall' ? wallSlots(feedKeys) : []), [feedKeys, variant])
  const wallCols = useMemo(() => {
    if (variant !== 'wall' || wallSlotsMemo.length === 0) return 4
    return Math.max(...wallSlotsMemo.map((s) => s.col)) + 1
  }, [variant, wallSlotsMemo])

  useLayoutEffect(() => {
    const frames = framesRef.current
    const g = getComputedStyle(document.documentElement)
    const emptyFill = g.getPropertyValue('--code-bg').trim() || '#f4f4f5'
    const keys = feedKeys.length > 0 ? feedKeys : [DEFAULT_FEED]
    let off = offThumbRef?.current
    if (!off && typeof document !== 'undefined') {
      off = document.createElement('canvas')
      if (offThumbRef) offThumbRef.current = off
    }

    const paint = (dest: HTMLCanvasElement, fk: string) => {
      const dctx = dest.getContext('2d')
      if (!dctx) return
      const msg = frames?.[fk]
      if (!msg || !off) {
        dctx.fillStyle = emptyFill
        dctx.fillRect(0, 0, thumbPx, thumbPx)
        return
      }
      const res = Math.floor(msg.res)
      const hex = Uint8Array.from(msg.hex)
      if (hex.length !== res * res) {
        dctx.fillStyle = emptyFill
        dctx.fillRect(0, 0, thumbPx, thumbPx)
        return
      }
      const mode = typeof msg.mode === 'string' ? msg.mode : 'gray'
      drawHexFrame(dest, off, hex, res, mode, thumbPx)
    }

    if (variant === 'rail') {
      for (const t of RAIL_TILE_TOPO) {
        const dest = tileDisplayRefs.current[t.i]
        if (!dest) continue
        paint(dest, keys[t.i % keys.length]!)
      }
      return
    }

    for (const s of wallSlotsMemo) {
      const dest = tileDisplayRefs.current[s.i]
      if (!dest) continue
      paint(dest, s.feedKey)
    }
  }, [thumbSeq, feedKeys, framesRef, offThumbRef, variant, wallSlotsMemo, thumbPx])

  const onMove = (e: ReactMouseEvent<HTMLElement>) => {
    if (variant !== 'rail') return
    const el = railRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2
    const ny = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2
    el.style.setProperty('--vfl-mx', nx.toFixed(4))
    el.style.setProperty('--vfl-my', ny.toFixed(4))
  }
  const onLeave = () => {
    railRef.current?.style.setProperty('--vfl-mx', '0')
    railRef.current?.style.setProperty('--vfl-my', '0')
  }

  if (variant === 'rail') {
    return (
      <aside
        ref={railRef}
        className="vfl-bump-rail"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        aria-label="Live snapshots from feeds in the carousel"
      >
        <div
          className="vfl-bump-mosaic"
          role="presentation"
          title="Each tile shows the latest frame from a different feed. Pointer moves parallax layers."
        >
          {RAIL_TILE_TOPO.map((t) => (
            <div
              key={t.key}
              className="vfl-bump-tile-outer"
              style={
                {
                  '--vfl-px': t.nx,
                  '--vfl-py': t.ny,
                  '--vfl-bump-z': t.zSlot,
                } as CSSProperties
              }
              aria-hidden
            >
              <canvas
                ref={(el) => {
                  tileDisplayRefs.current[t.i] = el
                }}
                className="vfl-bump-tile vfl-bump-tile--snap"
                width={thumbPx}
                height={thumbPx}
              />
            </div>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <div
      ref={wallRef}
      className={`vfl-feed-mosaic vfl-feed-mosaic--wall${wallLayout === 'checker' ? ' vfl-feed-mosaic--checker' : ''}`}
      style={{ '--vfl-wall-cols': wallCols } as CSSProperties}
      role="list"
      aria-label="VWall — one live tile per feed"
    >
      {wallSlotsMemo.map((s) => {
        const selected = activeFeedKey === s.feedKey
        return (
          <button
            key={s.feedKey}
            type="button"
            role="listitem"
            className={`vfl-wall-tile-btn${selected ? ' is-active' : ''}`}
            data-row-even={s.row % 2 === 1 ? '1' : '0'}
            title={s.feedKey}
            onClick={() => onSelectFeed?.(s.feedKey)}
          >
            <canvas
              ref={(el) => {
                tileDisplayRefs.current[s.i] = el
              }}
              className="vfl-bump-tile vfl-bump-tile--snap"
              width={thumbPx}
              height={thumbPx}
              aria-hidden
            />
            <span className="vfl-wall-tile-label">{s.feedKey}</span>
          </button>
        )
      })}
    </div>
  )
}

/** @deprecated Use VflFeedMosaic variant="rail" */
export function VflBumpRail(props: Omit<VflFeedMosaicProps, 'variant'>) {
  return <VflFeedMosaic {...props} variant="rail" />
}
