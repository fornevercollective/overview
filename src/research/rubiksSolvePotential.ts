import {
  FACE_IDS,
  facesToFacelets,
  solvedCubeFaces,
  validateFacelets,
  type CubeFaces,
  type CubeOrder,
  type FaceId,
} from './rubiksCube'

export type SolvePotentialTerm = {
  symbol: string
  label: string
  ratio: number
  weight: number
}

export type SolvePotential = {
  percent: number
  terms: SolvePotentialTerm[]
  divisor: number
  isSolved: boolean
  isValid: boolean
  matchStickers: number
  totalStickers: number
}

function faceIsUniformCorrect(face: FaceId, stickers: FaceId[]): boolean {
  return stickers.every((s) => s === face)
}

export function computeSolvePotential(input: {
  faces: CubeFaces
  order: CubeOrder
  capturedFaces: ReadonlySet<FaceId>
  walkStep: number
  walkMoveCount: number
  walkthroughOn: boolean
  liveConfidence: number | null
}): SolvePotential {
  const { faces, order, capturedFaces, walkStep, walkMoveCount, walkthroughOn, liveConfidence } = input
  const solved = solvedCubeFaces(order)
  const facelets = facesToFacelets(faces, order)
  const solvedFacelets = facesToFacelets(solved, order)
  const total = solvedFacelets.length

  let matchStickers = 0
  for (let i = 0; i < total; i++) {
    if (facelets[i] === solvedFacelets[i]) matchStickers++
  }

  const validErr = validateFacelets(facelets, order)
  const isValid = validErr === null
  const isSolved = isValid && matchStickers === total

  if (isSolved) {
    return {
      percent: 100,
      terms: [{ symbol: 'S*', label: 'Solved state', ratio: 1, weight: 1 }],
      divisor: 1,
      isSolved: true,
      isValid: true,
      matchStickers,
      totalStickers: total,
    }
  }

  const terms: SolvePotentialTerm[] = [
    { symbol: 'S_scan', label: 'Faces captured', ratio: capturedFaces.size / 6, weight: 0.28 },
    { symbol: 'S_mono', label: 'Uniform face colors', ratio: FACE_IDS.filter((id) => faceIsUniformCorrect(id, faces[id])).length / 6, weight: 0.2 },
    { symbol: 'S_match', label: 'Stickers vs solved', ratio: matchStickers / total, weight: 0.27 },
  ]

  if (walkthroughOn && walkMoveCount > 0) {
    terms.push({
      symbol: 'S_alg',
      label: 'Algorithm progress',
      ratio: Math.min(1, walkStep / walkMoveCount),
      weight: 0.35,
    })
    terms[0]!.weight = 0.18
    terms[1]!.weight = 0.12
    terms[2]!.weight = 0.15
  }

  if (liveConfidence != null && liveConfidence > 0) {
    terms.push({
      symbol: 'S_live',
      label: 'Live scan confidence',
      ratio: liveConfidence,
      weight: 0.1,
    })
  }

  const weightSum = terms.reduce((a, t) => a + t.weight, 0)
  const blended = terms.reduce((acc, t) => acc + (t.weight / weightSum) * t.ratio, 0)
  const percent = Math.round(Math.min(100, Math.max(0, blended * 1000)) / 10)

  return {
    percent,
    terms,
    divisor: terms.length,
    isSolved: false,
    isValid,
    matchStickers,
    totalStickers: total,
  }
}

export function formatTermPercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}
