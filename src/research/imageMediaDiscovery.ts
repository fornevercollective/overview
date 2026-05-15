/**
 * Client-side image / freeze-frame discovery helpers for the capture gallery.
 * Heavy cinematography inference (lens motion class, rig type, true shot boundaries)
 * requires host-side CV or ffmpeg — we expose structured fields + honest limits.
 */

export type MotionRigDiscovery = {
  crane: string | null
  dolly: string | null
  jib: string | null
  steadicam: string | null
  drone: string | null
  handheld: string | null
  stabilized: string | null
  shotType: string | null
  note: string
}

export type CutScanSummary = {
  mode: 'pairwise-histogram' | 'server-ffmpeg-unwired'
  score0to1?: number
  note: string
}

export type MediaDiscoveryAnalysis = {
  version: 1
  source: 'client-browser'
  pixels: { width: number; height: number; megapixels: string }
  framing: { aspect: string; commonAlias: string | null }
  exposure: {
    meanLuma0to1: number
    zebraNearWhitePct: number
    centroidNorm: { x: number; y: number }
    /** Distance of luminance centroid from nearest golden-third line (0–0.5 each axis). */
    goldenThirdsDelta: string
  }
  /** Flattened EXIF / TIFF tags when present (strings for display). */
  exif: Record<string, string | null>
  motionRig: MotionRigDiscovery
  cutScan: CutScanSummary
}

const PHI = (1 + Math.sqrt(5)) / 2
const THIRD_A = 1 / PHI / (1 + 1 / PHI) // ≈ 0.382
const THIRD_B = 1 - THIRD_A // ≈ 0.618

function aspectLabel(w: number, h: number): { aspect: string; alias: string | null } {
  const g = gcd(w, h)
  const rw = w / g
  const rh = h / g
  const r = w / h
  let alias: string | null = null
  if (Math.abs(r - 16 / 9) < 0.02) alias = '16:9'
  else if (Math.abs(r - 4 / 3) < 0.02) alias = '4:3'
  else if (Math.abs(r - 2.35) < 0.04) alias = '~2.39:1 (scope)'
  else if (Math.abs(r - 2) < 0.02) alias = '18:9 / 2:1'
  else if (Math.abs(r - 1) < 0.02) alias = '1:1'
  return { aspect: `${rw}:${rh}`, alias }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image decode failed'))
    img.src = dataUrl
  })
}

function drawToAnalysisCanvas(img: HTMLImageElement, maxEdge: number): { canvas: HTMLCanvasElement; sx: number; sy: number } {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) throw new Error('Invalid image dimensions')
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const sx = Math.max(1, Math.round(w * scale))
  const sy = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = sx
  canvas.height = sy
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unsupported')
  ctx.drawImage(img, 0, 0, sx, sy)
  return { canvas, sx, sy }
}

function lumaCentroidAndZebra(canvas: HTMLCanvasElement): {
  mean: number
  zebra: number
  cx: number
  cy: number
} {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { mean: 0, zebra: 0, cx: 0.5, cy: 0.5 }
  const { width: w, height: h } = canvas
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  let sumL = 0
  let sumX = 0
  let sumY = 0
  let zebra = 0
  const n = w * h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = d[i] / 255
      const g = d[i + 1] / 255
      const b = d[i + 2] / 255
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
      sumL += L
      sumX += L * (x + 0.5)
      sumY += L * (y + 0.5)
      if (L > 0.95) zebra++
    }
  }
  const mean = n ? sumL / n : 0
  const wL = sumL > 1e-6 ? sumL : 1
  return {
    mean,
    zebra: n ? zebra / n : 0,
    cx: sumX / wL / w,
    cy: sumY / wL / h,
  }
}

function goldenThirdsCaption(cx: number, cy: number): string {
  const dist = (v: number, a: number, b: number) => Math.min(Math.abs(v - a), Math.abs(v - b))
  const dx = dist(cx, THIRD_A, THIRD_B)
  const dy = dist(cy, THIRD_A, THIRD_B)
  return `Δ from φ-thirds: horizontal ${dx.toFixed(3)}, vertical ${dy.toFixed(3)} (luma centroid)`
}

function formatExifEntry(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 0 && v < 0.001) return String(v)
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '')
  }
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'object' && v !== null && 'numerator' in v && 'denominator' in v) {
    const n = v as { numerator: number; denominator: number }
    if (n.denominator) return `${n.numerator}/${n.denominator}`
  }
  return String(v)
}

async function readExifFlat(blob: Blob): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  try {
    const exifr = (await import('exifr')).default
    const tags = await exifr.parse(blob, {
      pick: [
        'Make',
        'Model',
        'LensModel',
        'LensMake',
        'FNumber',
        'ExposureTime',
        'ISO',
        'ISOSpeedRatings',
        'FocalLength',
        'FocalLengthIn35mmFormat',
        'ExposureProgram',
        'MeteringMode',
        'WhiteBalance',
        'DateTimeOriginal',
        'Flash',
        'DigitalZoomRatio',
        'Software',
      ],
      translateKeys: false,
      translateValues: false,
      reviveValues: true,
    })
    if (tags && typeof tags === 'object') {
      for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
        const s = formatExifEntry(v)
        if (s) out[k] = s
      }
    }
  } catch {
    /* no EXIF or unsupported container */
  }
  return out
}

const RIG_STUB: MotionRigDiscovery = {
  crane: null,
  dolly: null,
  jib: null,
  steadicam: null,
  drone: null,
  handheld: null,
  stabilized: null,
  shotType: null,
  note: 'Rig / shot motion not inferred in-browser. Wire CV, ffmpeg metadata, or manual tagging.',
}

export async function analyzeImageDataUrl(dataUrl: string): Promise<MediaDiscoveryAnalysis> {
  const blob = await fetch(dataUrl).then((r) => r.blob())
  const img = await loadImageFromDataUrl(dataUrl)
  const w0 = img.naturalWidth || img.width
  const h0 = img.naturalHeight || img.height
  const { canvas } = drawToAnalysisCanvas(img, 512)
  const { mean, zebra, cx, cy } = lumaCentroidAndZebra(canvas)
  const { aspect, alias } = aspectLabel(w0, h0)
  const exif = await readExifFlat(blob)

  const fNum = exif.FNumber ?? exif.ApertureValue ?? null
  const iso = exif.ISO ?? exif.ISOSpeedRatings ?? null
  const exp = exif.ExposureTime ?? null
  const lens = exif.LensModel ?? exif.LensMake ?? null

  return {
    version: 1,
    source: 'client-browser',
    pixels: {
      width: w0,
      height: h0,
      megapixels: ((w0 * h0) / 1e6).toFixed(2),
    },
    framing: { aspect, commonAlias: alias },
    exposure: {
      meanLuma0to1: Math.round(mean * 1000) / 1000,
      zebraNearWhitePct: Math.round(zebra * 10000) / 100,
      centroidNorm: { x: Math.round(cx * 1000) / 1000, y: Math.round(cy * 1000) / 1000 },
      goldenThirdsDelta: goldenThirdsCaption(cx, cy),
    },
    exif: {
      ...exif,
      Aperture_display: fNum,
      ISO_display: iso,
      ExposureTime_display: exp,
      Lens_display: lens,
    },
    motionRig: { ...RIG_STUB },
    cutScan: {
      mode: 'server-ffmpeg-unwired',
      note: 'Shot / hard-cut detection needs decoded video (ffmpeg server or WebCodecs worker). Pairwise frame delta available in gallery preview when two captures exist.',
    },
  }
}

/** 64-bin normalized luma histogram for cheap frame-to-frame distance. */
export async function lumaHistogram64(dataUrl: string): Promise<number[]> {
  const img = await loadImageFromDataUrl(dataUrl)
  const { canvas } = drawToAnalysisCanvas(img, 128)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return Array.from({ length: 64 }, () => 1 / 64)
  const { width: w, height: h } = canvas
  const imgd = ctx.getImageData(0, 0, w, h)
  const d = imgd.data
  const hist = new Array(64).fill(0) as number[]
  let sum = 0
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const bin = Math.min(63, Math.floor(L * 64))
    hist[bin]++
    sum++
  }
  if (sum > 0) for (let i = 0; i < 64; i++) hist[i] /= sum
  return hist
}

/** L1 distance on histograms, scaled to 0…1 (identical = 0). */
export function histogramDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i])
  return Math.min(1, s / 2)
}
