import {
  FACE_IDS,
  FACE_PALETTE,
  type CubeOrder,
  type FaceId,
  type FaceStickers,
} from './rubiksCube'

export type FaceMatchScore = { face: FaceId; score: number; rotation: number }

export type LiveDetection = {
  sample: FaceStickers
  matches: FaceMatchScore[]
  best: FaceId | null
  confidence: number
  dominant: FaceId
  turnHint: string | null
  rotation: number
}

export type WalkthroughSnapshot = {
  step: number
  move: string | null
  faces: Record<FaceId, FaceStickers>
  detected: FaceId | null
  at: number
}

const MATCH_THRESHOLD = 0.42
const CALIBRATE_THRESHOLD = 0.62
const AUTO_TAB_THRESHOLD = 0.48

export { MATCH_THRESHOLD, CALIBRATE_THRESHOLD, AUTO_TAB_THRESHOLD }

export function rotateFaceCW(stickers: FaceStickers, order: CubeOrder): FaceStickers {
  const out: FaceId[] = []
  for (let r = 0; r < order; r++) {
    for (let c = 0; c < order; c++) {
      out[c * order + (order - 1 - r)] = stickers[r * order + c]!
    }
  }
  return out as FaceStickers
}

export function scoreFaceMatch(sample: FaceStickers, template: FaceStickers): number {
  if (sample.length !== template.length) return 0
  let hit = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === template[i]) hit++
  }
  return hit / sample.length
}

export function scoreFaceMatchBestRotation(
  sample: FaceStickers,
  template: FaceStickers,
  order: CubeOrder,
): { score: number; rotation: number } {
  let best = 0
  let bestRot = 0
  let t = template
  for (let rot = 0; rot < 4; rot++) {
    const s = scoreFaceMatch(sample, t)
    if (s > best) {
      best = s
      bestRot = rot
    }
    t = rotateFaceCW(t, order)
  }
  return { score: best, rotation: bestRot }
}

export function dominantFaceFromSample(sample: FaceStickers): FaceId {
  const counts: Record<FaceId, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 }
  for (const id of sample) counts[id]++
  let best: FaceId = 'U'
  let bestN = -1
  for (const id of FACE_IDS) {
    if (counts[id] > bestN) {
      bestN = counts[id]
      best = id
    }
  }
  return best
}

export function matchSampleToFaces(
  sample: FaceStickers,
  templates: Record<FaceId, FaceStickers>,
  order: CubeOrder,
  capturedFaces: ReadonlySet<FaceId>,
): FaceMatchScore[] {
  const dominant = dominantFaceFromSample(sample)
  return FACE_IDS.map((face) => {
    const { score: raw, rotation } = scoreFaceMatchBestRotation(sample, templates[face], order)
    const hasCapture = capturedFaces.has(face)
    const dominantBoost = face === dominant ? 0.12 : 0
    const captureBoost = hasCapture ? 0.08 : 0
    const score = Math.min(1, raw + dominantBoost + captureBoost)
    return { face, score, rotation }
  }).sort((a, b) => b.score - a.score)
}

export function detectLiveFace(
  sample: FaceStickers,
  templates: Record<FaceId, FaceStickers>,
  order: CubeOrder,
  capturedFaces: ReadonlySet<FaceId>,
  prevBest: FaceId | null,
): LiveDetection {
  const matches = matchSampleToFaces(sample, templates, order, capturedFaces)
  const top = matches[0]
  const second = matches[1]
  const dominant = dominantFaceFromSample(sample)
  const margin = top && second ? top.score - second.score : top?.score ?? 0
  const confident = top && top.score >= MATCH_THRESHOLD && margin >= 0.06
  const best = confident ? top.face : null
  const confidence = top?.score ?? 0

  let turnHint: string | null = null
  if (best && prevBest && best !== prevBest && confidence >= AUTO_TAB_THRESHOLD) {
    turnHint = `Showing ${FACE_PALETTE[best].label} (${best}) — was ${prevBest}`
  }

  return {
    sample,
    matches,
    best,
    confidence,
    dominant,
    turnHint,
    rotation: top?.rotation ?? 0,
  }
}

/** Blend a live sample into a stored face when the camera agrees. */
export function calibrateFaceStickers(
  stored: FaceStickers,
  sample: FaceStickers,
): FaceStickers {
  const score = scoreFaceMatch(sample, stored)
  if (score < CALIBRATE_THRESHOLD) return stored
  const out = [...stored] as FaceStickers
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === stored[i] || score > 0.78) out[i] = sample[i]!
  }
  return out
}

export function applyLiveSampleToFace(
  stored: FaceStickers,
  sample: FaceStickers,
  detectedFace: FaceId,
  targetFace: FaceId,
): FaceStickers {
  if (detectedFace !== targetFace) return stored
  return calibrateFaceStickers(stored, sample)
}

export function parseSolutionMoves(solution: string): string[] {
  return solution
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((m) => m.replace(/'/g, "'").replace(/2/g, '2'))
}

export function stickerRgbStyle(id: FaceId): string {
  const [r, g, b] = FACE_PALETTE[id].rgb
  return `rgb(${r},${g},${b})`
}
