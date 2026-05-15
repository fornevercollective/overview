/**
 * Canvas post-passes inspired by ordered dither, halftone, and cell-wise “ASCII” density
 * (see Efecto, Codrops write-up, DITHR-style toolchains — CPU path here, no WebGL).
 */

import { thermalRgb } from './liveHexCodec'

export type DitherPass = 'none' | 'bayer4' | 'bayer8' | 'halftone' | 'ascii'

export type DepthSpatialStackOpts = {
  /** −1…1 “key” light direction in frame space (pointer on stage). */
  lightNx: number
  lightNy: number
  /** Seconds for thermal sweep phase. */
  timeSec: number
  /** 0…1 scales thermal overlay; camera thermal mode typically 1. */
  thermalAmp: number
}

/** 4×4 Bayer matrix (0–15). */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** 4×4 Bayer with 5-level quantization (Game Boy–ish stepped ramps). */
export function applyBayer4Levels(img: ImageData, levels: number): void {
  const lv = Math.max(2, Math.min(16, Math.floor(levels)))
  const { data, width, height } = img
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let L = lum(data[i], data[i + 1], data[i + 2]) / 255
      const b = (BAYER4[y % 4][x % 4] + 0.5) / 16 - 0.5
      L = Math.max(0, Math.min(1, L + b * 0.22))
      const q = Math.round(L * (lv - 1)) / (lv - 1)
      const v = Math.round(q * 255)
      data[i] = data[i + 1] = data[i + 2] = v
    }
  }
}

/** Coarser 8×8 ordered threshold using tiled 4×4 with offset. */
export function applyBayer8Approx(img: ImageData): void {
  const { data, width, height } = img
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const L = lum(data[i], data[i + 1], data[i + 2]) / 255
      const t = (BAYER4[(y >> 1) % 4][(x >> 1) % 4] + 0.5) / 16
      const v = L > t * 0.92 ? 255 : 0
      data[i] = data[i + 1] = data[i + 2] = v
    }
  }
}

/** Circular halftone dots (AM newspaper vibe). */
export function applyHalftoneDots(img: ImageData, cell: number): void {
  const c = Math.max(3, Math.min(14, Math.floor(cell)))
  const { width, height } = img
  const src = new Uint8ClampedArray(img.data)
  const out = img.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = Math.floor(x / c) * c + (c >> 1)
      const cy = Math.floor(y / c) * c + (c >> 1)
      const sx = Math.min(width - 1, Math.max(0, cx))
      const sy = Math.min(height - 1, Math.max(0, cy))
      const si = (sy * width + sx) * 4
      const L = lum(src[si], src[si + 1], src[si + 2]) / 255
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const maxR = (c * 0.45) * (1 - L)
      const ink = dist <= maxR ? 0 : 255
      const i = (y * width + x) * 4
      out[i] = out[i + 1] = out[i + 2] = ink
    }
  }
}

const ASCII_RAMP = ' .`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$'

/** Block “ASCII” from luminance (Efecto-style density, 2D canvas text). */
export function applyAsciiBlocks(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cell: number,
): void {
  const img = ctx.getImageData(0, 0, w, h)
  const { data } = img
  const ce = Math.max(4, Math.min(12, Math.floor(cell)))
  ctx.fillStyle = '#0a0a0c'
  ctx.fillRect(0, 0, w, h)
  ctx.font = `${ce - 1}px ui-monospace, Consolas, monospace`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  for (let gy = 0; gy < h; gy += ce) {
    for (let gx = 0; gx < w; gx += ce) {
      let sum = 0
      let n = 0
      for (let py = gy; py < Math.min(gy + ce, h); py++) {
        for (let px = gx; px < Math.min(gx + ce, w); px++) {
          const i = (py * w + px) * 4
          sum += lum(data[i], data[i + 1], data[i + 2])
          n++
        }
      }
      const L = sum / Math.max(1, n) / 255
      const idx = Math.floor((1 - L) * (ASCII_RAMP.length - 1))
      const ch = ASCII_RAMP[idx] ?? '@'
      const t = 0.15 + L * 0.85
      ctx.fillStyle = `rgb(${Math.floor(40 + 180 * t)},${Math.floor(32 + 160 * t)},${Math.floor(90 + 120 * t)})`
      ctx.fillText(ch, gx + ce / 2, gy + ce / 2)
    }
  }
}

export function applyDitherPass(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pass: DitherPass,
): void {
  if (pass === 'none') return
  if (pass === 'ascii') {
    applyAsciiBlocks(ctx, w, h, 7)
    return
  }
  const img = ctx.getImageData(0, 0, w, h)
  if (pass === 'bayer4') applyBayer4Levels(img, 5)
  else if (pass === 'bayer8') applyBayer8Approx(img)
  else if (pass === 'halftone') applyHalftoneDots(img, 6)
  ctx.putImageData(img, 0, 0)
}

function depthProxyZ(x: number, y: number, _w: number, h: number, cx0: number, cy0: number, maxR: number, L: number): number {
  const radial = Math.hypot(x - cx0, y - cy0) / maxR
  const vert = y / Math.max(1, h - 1)
  const z = Math.max(0, Math.min(1, 0.36 * (1 - radial) + 0.34 * vert + 0.3 * (1 - L)))
  return z
}

function edgeFromLum(L0: Float32Array, x: number, y: number, w: number, h: number): number {
  const xm = Math.max(0, x - 1)
  const xp = Math.min(w - 1, x + 1)
  const ym = Math.max(0, y - 1)
  const yp = Math.min(h - 1, y + 1)
  const gx = L0[y * w + xp] - L0[y * w + xm]
  const gy = L0[yp * w + x] - L0[ym * w + x]
  return Math.min(1, Math.hypot(gx, gy) * 20)
}

/**
 * Depth stack: roto-style directional falloff (back) → thermal plane that sweeps in z then
 * “floats” forward (mid) → dither composited strongest on edges / near plane (front, touchable pixels).
 * Heuristic mono proxy only — not stereo depth.
 */
export function applyDepthSpatialStack(
  dest: HTMLCanvasElement,
  work: HTMLCanvasElement,
  primary: DitherPass,
  opts: DepthSpatialStackOpts,
): void {
  const w = dest.width
  const h = dest.height
  const destCtx = dest.getContext('2d')
  const wctx = work.getContext('2d')
  if (!destCtx || !wctx || w <= 0 || h <= 0) return

  const src = destCtx.getImageData(0, 0, w, h)
  const sd = src.data
  if (work.width !== w || work.height !== h) {
    work.width = w
    work.height = h
  }

  const cx0 = w * 0.5
  const cy0 = h * 0.5
  const maxR = Math.hypot(cx0, cy0) || 1
  const n = w * h
  const L0 = new Float32Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    L0[i] = lum(sd[p], sd[p + 1], sd[p + 2]) / 255
  }

  const lx = Math.max(-1, Math.min(1, opts.lightNx))
  const ly = Math.max(-1, Math.min(1, opts.lightNy))
  const buf = new Uint8ClampedArray(sd)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const edge = edgeFromLum(L0, x, y, w, h)
      const px = (x - cx0) / maxR
      const py = (y - cy0) / maxR
      const lightDot = Math.max(0, Math.min(1, lx * px + ly * py + 0.55))
      const shade = (0.22 + 0.78 * lightDot) * (1 - edge * 0.38) + edge * 0.1
      const rim = edge * lightDot
      for (let c = 0; c < 3; c++) {
        const v = buf[i + c]! * shade + (c === 0 ? rim * 52 : c === 1 ? rim * 38 : rim * 28)
        buf[i + c] = Math.max(0, Math.min(255, Math.round(v)))
      }
    }
  }

  const t = opts.timeSec
  const amp = Math.max(0, Math.min(1, opts.thermalAmp))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const L = L0[y * w + x]!
      const z = depthProxyZ(x, y, w, h, cx0, cy0, maxR, L)
      const sweep = Math.sin(t * 1.65 + z * Math.PI * 4.25) * 0.5 + 0.5
      const floatFront = Math.pow(1 - z, 1.28)
      const aT = amp * (0.1 + 0.36 * sweep + 0.46 * floatFront * (0.48 + 0.52 * sweep))
      const lv = Math.round(L * 255)
      const [tr, tg, tb] = thermalRgb(lv, 'color')
      buf[i] = Math.round(buf[i]! * (1 - aT) + tr * aT)
      buf[i + 1] = Math.round(buf[i + 1]! * (1 - aT) + tg * aT)
      buf[i + 2] = Math.round(buf[i + 2]! * (1 - aT) + tb * aT)
    }
  }

  wctx.putImageData(new ImageData(buf, w, h), 0, 0)
  applyDitherPass(wctx, w, h, primary)
  const dith = wctx.getImageData(0, 0, w, h)
  const dd = dith.data
  const out = destCtx.createImageData(w, h)
  const o = out.data

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const L = L0[y * w + x]!
      const z = depthProxyZ(x, y, w, h, cx0, cy0, maxR, L)
      const edge = edgeFromLum(L0, x, y, w, h)
      const wD = Math.min(1, 0.22 + 0.58 * edge + 0.22 * Math.pow(z, 0.88))
      for (let c = 0; c < 3; c++) {
        const bi = buf[i + c]!
        const di = dd[i + c]!
        o[i + c] = Math.round(bi * (1 - wD) + di * wD)
      }
      o[i + 3] = 255
    }
  }
  destCtx.putImageData(out, 0, 0)
}
