/** 3×3 facelet model — Kociemba / cubejs order: U, R, F, D, L, B (9 stickers each). */

export type FaceId = 'U' | 'R' | 'F' | 'D' | 'L' | 'B'

export const FACE_IDS: FaceId[] = ['U', 'R', 'F', 'D', 'L', 'B']

export const SCAN_FACE_HINTS: Record<FaceId, string> = {
  U: 'White center — Up face',
  R: 'Red center — Right face',
  F: 'Green center — Front face',
  D: 'Yellow center — Down face',
  L: 'Orange center — Left face',
  B: 'Blue center — Back face',
}

/** Western color scheme (matches cubejs face letters). */
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

export function emptyCubeFaces(): CubeFaces {
  const face = (): FaceStickers => Array(9).fill('U') as FaceStickers
  return { U: face(), R: face(), F: face(), D: face(), L: face(), B: face() }
}

export function solvedCubeFaces(): CubeFaces {
  const face = (id: FaceId): FaceStickers => Array(9).fill(id) as FaceStickers
  return {
    U: face('U'),
    R: face('R'),
    F: face('F'),
    D: face('D'),
    L: face('L'),
    B: face('B'),
  }
}

/** cubejs `Cube.fromString` layout. */
export function facesToFacelets(faces: CubeFaces): string {
  return FACE_IDS.map((id) => faces[id].join('')).join('')
}

export function faceletsToFaces(raw: string): CubeFaces | null {
  const s = raw.trim().toUpperCase()
  if (s.length !== 54) return null
  const faces = emptyCubeFaces()
  let i = 0
  for (const id of FACE_IDS) {
    for (let c = 0; c < 9; c++) {
      const ch = s[i++] as FaceId
      if (!FACE_IDS.includes(ch)) return null
      faces[id][c] = ch
    }
  }
  return faces
}

export function validateFacelets(facelets: string): string | null {
  if (facelets.length !== 54) return 'Need exactly 54 face stickers.'
  const counts: Record<FaceId, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 }
  for (const ch of facelets) {
    if (!FACE_IDS.includes(ch as FaceId)) return `Invalid sticker “${ch}”.`
    counts[ch as FaceId]++
  }
  for (const id of FACE_IDS) {
    if (counts[id] !== 9) return `Each color must appear 9 times (${id} has ${counts[id]}).`
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
 * Sample a 3×3 grid from the center region of a video frame.
 * `inset` 0–0.4 trims edges so the cube face fills the guide box.
 */
export function sampleFaceFromImageData(
  data: ImageData,
  inset = 0.18,
): FaceStickers {
  const { width: w, height: h, data: px } = data
  const x0 = Math.floor(w * inset)
  const y0 = Math.floor(h * inset)
  const x1 = Math.floor(w * (1 - inset))
  const y1 = Math.floor(h * (1 - inset))
  const cellW = (x1 - x0) / 3
  const cellH = (y1 - y0) / 3
  const out: FaceId[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = Math.floor(x0 + (col + 0.5) * cellW)
      const cy = Math.floor(y0 + (row + 0.5) * cellH)
      const i = (cy * w + cx) * 4
      out.push(rgbToFaceId(px[i]!, px[i + 1]!, px[i + 2]!))
    }
  }
  return out as FaceStickers
}

export function cycleStickerColor(current: FaceId, dir: 1 | -1 = 1): FaceId {
  const idx = FACE_IDS.indexOf(current)
  const next = (idx + dir + FACE_IDS.length) % FACE_IDS.length
  return FACE_IDS[next]!
}
