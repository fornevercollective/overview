/**
 * MediaPipe Pose Landmarker (lite) — browser WASM, GPU when available.
 */
import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

const WASM_VER = '0.10.21'
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${WASM_VER}/wasm`
const MODEL_LITE =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

/** Upper-body + torso edges (BlazePose indices). */
export const POSE_EDGE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
]

let landmarkerPromise: Promise<PoseLandmarker> | null = null

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
      try {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_LITE,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.35,
          minPosePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
        })
      } catch {
        return PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_LITE,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.35,
          minPosePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
        })
      }
    })()
  }
  return landmarkerPromise
}

export function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[] | undefined,
  w: number,
  h: number,
): void {
  if (!landmarks?.length) return
  ctx.save()
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.92)'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  for (const [a, b] of POSE_EDGE_PAIRS) {
    const pa = landmarks[a]
    const pb = landmarks[b]
    if (!pa || !pb || pa.visibility != null && pa.visibility < 0.2) continue
    if (pb.visibility != null && pb.visibility < 0.2) continue
    ctx.beginPath()
    ctx.moveTo(pa.x * w, pa.y * h)
    ctx.lineTo(pb.x * w, pb.y * h)
    ctx.stroke()
  }
  for (const p of landmarks) {
    if (p.visibility != null && p.visibility < 0.15) continue
    ctx.fillStyle = 'rgba(250, 204, 21, 0.95)'
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, 3.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
