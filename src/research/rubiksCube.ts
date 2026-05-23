/** N×N facelet model — Kociemba / cubejs order for 3×3: U, R, F, D, L, B. */

export type CubeOrder = 3 | 4

export const DEFAULT_CUBE_ORDER: CubeOrder = 4

export type FaceId = 'U' | 'R' | 'F' | 'D' | 'L' | 'B'

/** Kociemba / cubejs string order (do not use for camera scan flow). */
export const FACE_IDS: FaceId[] = ['U', 'R', 'F', 'D', 'L', 'B']

/**
 * Recommended physical scan order: Up first, four sides clockwise (F→R→B→L) with U on top, then Down.
 */
export const SCAN_FACE_ORDER: FaceId[] = ['U', 'F', 'R', 'B', 'L', 'D']

/** First face not yet captured, in recommended scan order (U → F → R → B → L → D). */
export function suggestedScanFace(captured: ReadonlySet<FaceId>): FaceId {
  for (const id of SCAN_FACE_ORDER) {
    if (!captured.has(id)) return id
  }
  return SCAN_FACE_ORDER[0]!
}

export function scanOrderIndex(face: FaceId): number {
  const i = SCAN_FACE_ORDER.indexOf(face)
  return i >= 0 ? i + 1 : 0
}

export function faceStickerCount(order: CubeOrder): number {
  return order * order
}

export function totalFacelets(order: CubeOrder): number {
  return 6 * faceStickerCount(order)
}

/** Scan / orientation hints (4×4 has no fixed center on any face). */
export function scanFaceHint(face: FaceId, order: CubeOrder): string {
  if (order === 4 && face === 'U') {
    return 'Up (U) — white face with the Rubik’s logo sticker. No center on 4×4; align the whole face in the 4×4 guide.'
  }
  const color = FACE_PALETTE[face].label
  if (order === 4) {
    return `${face} — ${color} face. Pick any sticker on this side as reference; capture all ${order}×${order} stickers.`
  }
  const centerNote: Record<FaceId, string> = {
    U: 'White center — Up face',
    R: 'Red center — Right face',
    F: 'Green center — Front face',
    D: 'Yellow center — Down face',
    L: 'Orange center — Left face',
    B: 'Blue center — Back face',
  }
  return centerNote[face]
}

/** Western color scheme (matches cubejs face letters on 3×3). */
export const FACE_PALETTE: Record<FaceId, { label: string; rgb: [number, number, number] }> = {
  U: { label: 'White', rgb: [250, 250, 250] },
  R: { label: 'Red', rgb: [198, 40, 40] },
  F: { label: 'Green', rgb: [46, 125, 50] },
  D: { label: 'Yellow', rgb: [255, 213, 0] },
  L: { label: 'Orange', rgb: [245, 124, 0] },
  B: { label: 'Blue', rgb: [25, 118, 210] },
}

export type FaceStickers = FaceId[]

export type CubeFaces = Record<FaceId, FaceStickers>

export function emptyCubeFaces(order: CubeOrder = DEFAULT_CUBE_ORDER): CubeFaces {
  const n = faceStickerCount(order)
  const face = (id: FaceId): FaceStickers => Array(n).fill(id) as FaceStickers
  return { U: face('U'), R: face('R'), F: face('F'), D: face('D'), L: face('L'), B: face('B') }
}

export function solvedCubeFaces(order: CubeOrder = DEFAULT_CUBE_ORDER): CubeFaces {
  const n = faceStickerCount(order)
  const face = (id: FaceId): FaceStickers => Array(n).fill(id) as FaceStickers
  return {
    U: face('U'),
    R: face('R'),
    F: face('F'),
    D: face('D'),
    L: face('L'),
    B: face('B'),
  }
}

/** cubejs `Cube.fromString` layout (3×3 only). */
export function facesToFacelets(faces: CubeFaces, order: CubeOrder = DEFAULT_CUBE_ORDER): string {
  const n = faceStickerCount(order)
  return FACE_IDS.map((id) => {
    const row = faces[id]
    if (row.length !== n) throw new Error(`Face ${id} has ${row.length} stickers, expected ${n}.`)
    return row.join('')
  }).join('')
}

export function faceletsToFaces(raw: string, order: CubeOrder): CubeFaces | null {
  const n = totalFacelets(order)
  const s = raw.trim().toUpperCase()
  if (s.length !== n) return null
  const perFace = faceStickerCount(order)
  const faces = emptyCubeFaces(order)
  let i = 0
  for (const id of FACE_IDS) {
    for (let c = 0; c < perFace; c++) {
      const ch = s[i++] as FaceId
      if (!FACE_IDS.includes(ch)) return null
      faces[id][c] = ch
    }
  }
  return faces
}

export function validateFacelets(facelets: string, order: CubeOrder): string | null {
  const need = totalFacelets(order)
  const per = faceStickerCount(order)
  if (facelets.length !== need) return `Need exactly ${need} face stickers (${order}×${order}×6).`
  const counts: Record<FaceId, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 }
  for (const ch of facelets) {
    if (!FACE_IDS.includes(ch as FaceId)) return `Invalid sticker “${ch}”.`
    counts[ch as FaceId]++
  }
  for (const id of FACE_IDS) {
    if (counts[id] !== per) return `Each color must appear ${per} times (${id} has ${counts[id]}).`
  }
  return null
}

function distRgb(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

/** Map sampled RGB to nearest face color for camera scan. */
export function rgbToFaceId(r: number, g: number, b: number): FaceId {
  let best: FaceId = 'U'
  let bestD = Infinity
  for (const id of FACE_IDS) {
    const d = distRgb([r, g, b], FACE_PALETTE[id].rgb)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

/**
 * Sample an N×N grid from the center region of a video frame.
 * `inset` 0–0.4 trims edges so the cube face fills the guide box.
 */
export function sampleFaceFromImageData(
  data: ImageData,
  order: CubeOrder = DEFAULT_CUBE_ORDER,
  inset = 0.18,
): FaceStickers {
  const { width: w, height: h, data: px } = data
  const x0 = Math.floor(w * inset)
  const y0 = Math.floor(h * inset)
  const x1 = Math.floor(w * (1 - inset))
  const y1 = Math.floor(h * (1 - inset))
  const cellW = (x1 - x0) / order
  const cellH = (y1 - y0) / order
  const out: FaceId[] = []
  for (let row = 0; row < order; row++) {
    for (let col = 0; col < order; col++) {
      const cx = Math.floor(x0 + (col + 0.5) * cellW)
      const cy = Math.floor(y0 + (row + 0.5) * cellH)
      const i = (cy * w + cx) * 4
      out.push(rgbToFaceId(px[i]!, px[i + 1]!, px[i + 2]!))
    }
  }
  return out as FaceStickers
}

const GUIDE_INSET = 0.18

/** Crop the on-screen guide region from a full camera frame to a JPEG data URL. */
export function guideRegionThumbnailFromCanvas(
  canvas: HTMLCanvasElement,
  maxPx = 96,
  quality = 0.82,
): string {
  const sw = canvas.width
  const sh = canvas.height
  const x0 = Math.floor(sw * GUIDE_INSET)
  const y0 = Math.floor(sh * GUIDE_INSET)
  const x1 = Math.floor(sw * (1 - GUIDE_INSET))
  const y1 = Math.floor(sh * (1 - GUIDE_INSET))
  const tw = Math.max(1, x1 - x0)
  const th = Math.max(1, y1 - y0)
  const thumb = document.createElement('canvas')
  const side = maxPx
  thumb.width = side
  thumb.height = side
  const tctx = thumb.getContext('2d')
  if (!tctx) return ''
  tctx.drawImage(canvas, x0, y0, tw, th, 0, 0, side, side)
  return thumb.toDataURL('image/jpeg', quality)
}

export function cycleStickerColor(current: FaceId, dir: 1 | -1 = 1): FaceId {
  const idx = FACE_IDS.indexOf(current)
  const next = (idx + dir + FACE_IDS.length) % FACE_IDS.length
  return FACE_IDS[next]!
}
