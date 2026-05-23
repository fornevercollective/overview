/**
 * Shared hex-frame encode/decode for live ingest (hero strip, Video feeds lab, tooling).
 * Channel payloads: `type: 'hexframe'`, `hex` (length res²), `res`, optional `mode`, optional `feedKey`.
 */

export const LIVE_HEX_DOCUMENT_CHANNEL = 'overview-live-hex'

/** Inclusive bounds for `hexframe.res` (side length in cells). */
export const HEX_FRAME_RES_MIN = 16
export const HEX_FRAME_RES_MAX = 512

/** Decode modes supported by `thermalRgb` / `drawHexFrame`. */
export type HexDecodeMode = 'gray' | 'color' | 'rgb' | 'fax' | 'signal'

export const HEX_CAMERA_LOOKS: { id: HexDecodeMode; label: string }[] = [
  { id: 'gray', label: 'Mono' },
  { id: 'color', label: 'Thermal' },
  { id: 'fax', label: 'Fax' },
  { id: 'rgb', label: 'Color' },
  { id: 'signal', label: 'Signal' },
]

export type HexFrameMsg = {
  type: 'hexframe'
  hex: number[]
  res: number
  mode?: string
  t?: number
  /** Optional logical source id for multi-feed carousel / pin (same-tab or channel). */
  feedKey?: string
}

export function isHexFrameMsg(data: unknown): data is HexFrameMsg {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (d.type !== 'hexframe') return false
  if (!Array.isArray(d.hex)) return false
  if (typeof d.res !== 'number' || !Number.isFinite(d.res)) return false
  if (d.feedKey !== undefined && d.feedKey !== null) {
    if (typeof d.feedKey !== 'string' || !d.feedKey.trim()) return false
  }
  return true
}

export function normalizeFeedKey(raw: unknown): string {
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.length > 0 && t.length <= 64) return t
  }
  return '__default__'
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = hue2rgb(p, q, h + 1 / 3)
  const g = hue2rgb(p, q, h)
  const b = hue2rgb(p, q, h - 1 / 3)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

/** Thermal-style decode (compatible with mueee hexcast `thermalColor`). */
export function thermalRgb(val: number, mode: string): [number, number, number] {
  const v = Math.max(0, Math.min(255, val))
  const n = v / 255
  if (mode === 'color') {
    const hue = (1 - n) * 200
    return hslToRgb(hue / 360, 0.85, (20 + n * 50) / 100)
  }
  if (mode === 'gray') {
    const g = Math.floor(n * 220)
    return [g, g, g]
  }
  if (mode === 'fax') {
    return n > 0.5 ? [255, 255, 255] : [0, 0, 0]
  }
  const g = Math.floor(n * 200)
  return [0, g, Math.floor(g * 0.3)]
}

/** `mono` = one luma byte per cell; `rgb` = three bytes (R,G,B) per cell. */
export function hexFramePack(hexLength: number, res: number): 'mono' | 'rgb' | null {
  const cells = res * res
  if (hexLength === cells) return 'mono'
  if (hexLength === cells * 3) return 'rgb'
  return null
}

export function drawHexFrame(
  dest: HTMLCanvasElement,
  off: HTMLCanvasElement,
  hex: Uint8Array,
  res: number,
  mode: string,
  destPx: number,
): void {
  const dctx = dest.getContext('2d')
  const octx = off.getContext('2d')
  if (!dctx || !octx) return
  const pack = hexFramePack(hex.length, res)
  if (!pack) return
  if (off.width !== res || off.height !== res) {
    off.width = res
    off.height = res
  }
  const id = octx.createImageData(res, res)
  const { data } = id
  const cells = res * res
  for (let i = 0, p = 0; i < cells; i++, p += 4) {
    let r: number
    let g: number
    let b: number
    if (pack === 'rgb') {
      const o = i * 3
      r = hex[o] ?? 0
      g = hex[o + 1] ?? 0
      b = hex[o + 2] ?? 0
    } else {
      ;[r, g, b] = thermalRgb(hex[i] ?? 0, mode)
    }
    data[p] = r
    data[p + 1] = g
    data[p + 2] = b
    data[p + 3] = 255
  }
  octx.putImageData(id, 0, 0)
  dctx.imageSmoothingEnabled = false
  dctx.clearRect(0, 0, destPx, destPx)
  dctx.drawImage(off, 0, 0, res, res, 0, 0, destPx, destPx)
}

export function luminanceHexFromImageData(imageData: ImageData): number[] {
  const { data } = imageData
  const len = imageData.width * imageData.height
  const hex: number[] = new Array(len)
  for (let i = 0; i < len; i++) {
    const o = i * 4
    hex[i] = Math.floor(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2])
  }
  return hex
}

/** Full RGB capture for Color look (`hex.length === res² × 3`). */
export function rgbHexFromImageData(imageData: ImageData): number[] {
  const { data } = imageData
  const len = imageData.width * imageData.height
  const hex: number[] = new Array(len * 3)
  for (let i = 0; i < len; i++) {
    const src = i * 4
    const dst = i * 3
    hex[dst] = data[src]!
    hex[dst + 1] = data[src + 1]!
    hex[dst + 2] = data[src + 2]!
  }
  return hex
}

export function hexFromImageData(imageData: ImageData, mode: HexDecodeMode): number[] {
  return mode === 'rgb' ? rgbHexFromImageData(imageData) : luminanceHexFromImageData(imageData)
}

export function shiftCanvases(
  live: HTMLCanvasElement,
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
  c: HTMLCanvasElement,
  thumbPx: number,
): void {
  const ca = a.getContext('2d')
  const cb = b.getContext('2d')
  const cc = c.getContext('2d')
  if (!ca || !cb || !cc) return
  cc.clearRect(0, 0, thumbPx, thumbPx)
  cc.drawImage(b, 0, 0, thumbPx, thumbPx)
  cb.clearRect(0, 0, thumbPx, thumbPx)
  cb.drawImage(a, 0, 0, thumbPx, thumbPx)
  ca.clearRect(0, 0, thumbPx, thumbPx)
  ca.drawImage(live, 0, 0, thumbPx, thumbPx)
}
