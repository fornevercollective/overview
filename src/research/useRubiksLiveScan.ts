import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  AUTO_TAB_THRESHOLD,
  CALIBRATE_THRESHOLD,
  detectLiveFace,
  calibrateFaceStickers,
  type LiveDetection,
} from './rubiksLiveScan'
import { sampleFaceFromImageData, type CubeFaces, type CubeOrder, type FaceId } from './rubiksCube'

const TICK_MS = 120

export type UseRubiksLiveScanOpts = {
  enabled: boolean
  cameraOn: boolean
  cubeOrder: CubeOrder
  faces: CubeFaces
  scanFace: FaceId
  capturedFaces: ReadonlySet<FaceId>
  videoRef: RefObject<HTMLVideoElement | null>
  capRef: RefObject<HTMLCanvasElement | null>
  autoFollowFace: boolean
  autoCalibrate: boolean
  onDetectedFace?: (face: FaceId) => void
  onCalibrateFace?: (face: FaceId, next: FaceId[]) => void
}

export function useRubiksLiveScan({
  enabled,
  cameraOn,
  cubeOrder,
  faces,
  scanFace,
  capturedFaces,
  videoRef,
  capRef,
  autoFollowFace,
  autoCalibrate,
  onDetectedFace,
  onCalibrateFace,
}: UseRubiksLiveScanOpts): LiveDetection | null {
  const [live, setLive] = useState<LiveDetection | null>(null)
  const prevBestRef = useRef<FaceId | null>(null)
  const lastTickRef = useRef(0)
  const lastCalibRef = useRef(0)
  const facesRef = useRef(faces)
  facesRef.current = faces
  const scanFaceRef = useRef(scanFace)
  scanFaceRef.current = scanFace

  useEffect(() => {
    if (!enabled || !cameraOn) {
      setLive(null)
      prevBestRef.current = null
      return
    }

    let raf = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - lastTickRef.current < TICK_MS) return
      lastTickRef.current = t

      const v = videoRef.current
      const cap = capRef.current
      if (!v || !cap || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

      cap.width = v.videoWidth
      cap.height = v.videoHeight
      const ctx = cap.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(v, 0, 0)
      const image = ctx.getImageData(0, 0, cap.width, cap.height)
      const sample = sampleFaceFromImageData(image, cubeOrder)
      const det = detectLiveFace(sample, facesRef.current, cubeOrder, capturedFaces, prevBestRef.current)
      prevBestRef.current = det.best

      setLive(det)

      const active = scanFaceRef.current
      if (det.best && det.confidence >= AUTO_TAB_THRESHOLD && autoFollowFace && det.best !== active) {
        onDetectedFace?.(det.best)
      }

      if (
        det.best &&
        det.confidence >= CALIBRATE_THRESHOLD &&
        autoCalibrate &&
        det.best === active &&
        t - lastCalibRef.current > 450
      ) {
        const merged = calibrateFaceStickers(facesRef.current[active], det.sample)
        if (merged.some((c, i) => c !== facesRef.current[active][i])) {
          lastCalibRef.current = t
          onCalibrateFace?.(active, merged)
        }
      }
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [
    enabled,
    cameraOn,
    cubeOrder,
    capturedFaces,
    autoFollowFace,
    autoCalibrate,
    videoRef,
    capRef,
    onDetectedFace,
    onCalibrateFace,
  ])

  return live
}
