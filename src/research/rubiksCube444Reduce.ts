import {
  FACE_IDS,
  facesToFacelets,
  type CubeFaces,
  type FaceId,
  type FaceStickers,
} from './rubiksCube'

/** Map one 4×4 face (16 stickers, row-major) to 3×3 (corners, edge-mids, merged center 2×2). */
export function reduceFace444To333(stickers: FaceStickers): FaceStickers {
  if (stickers.length !== 16) {
    throw new Error(`Expected 16 stickers on a 4×4 face, got ${stickers.length}.`)
  }
  const center = majorityColor([
    stickers[5]!,
    stickers[6]!,
    stickers[9]!,
    stickers[10]!,
  ])
  return [
    stickers[0]!,
    stickers[1]!,
    stickers[3]!,
    stickers[4]!,
    center,
    stickers[7]!,
    stickers[12]!,
    stickers[13]!,
    stickers[15]!,
  ] as FaceStickers
}

function majorityColor(cells: FaceId[]): FaceId {
  const counts: Record<FaceId, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 }
  for (const c of cells) counts[c]++
  let best: FaceId = cells[0] ?? 'U'
  let bestN = -1
  for (const id of FACE_IDS) {
    if (counts[id] > bestN) {
      bestN = counts[id]
      best = id
    }
  }
  return best
}

/** Collapse scanned 4×4 net to a 3×3 facelet string for Kociemba (centers merged; edges/corners sampled). */
export function reduce444FacesTo333Facelets(faces: CubeFaces): string {
  const reduced = {} as CubeFaces
  for (const id of FACE_IDS) {
    reduced[id] = reduceFace444To333(faces[id])
  }
  return facesToFacelets(reduced, 3)
}

export const REDUCTION_SOLVE_PREAMBLE =
  '4×4 note: centers are merged from each 2×2 block, then a 3×3 solver runs. If your cube still has mixed centers or unp paired edges, build those on the physical cube first — this sequence is the 3×3 finish phase.'
