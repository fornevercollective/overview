/**
 * Grab a single raster frame from a **local** video file (object URL).
 * Cross-origin embeds (e.g. YouTube) cannot be sampled from the page JS sandbox.
 */

export type VideoFrameGrabResult = {
  dataUrl: string
  width: number
  height: number
  durationSec: number
  timeSec: number
}

export async function grabVideoFrameDataUrl(
  file: File,
  timeSec: number,
  opts?: { maxEdge?: number },
): Promise<VideoFrameGrabResult> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', 'true')
  video.preload = 'auto'
  video.src = url

  try {
    await new Promise<void>((resolve, reject) => {
      const ok = () => resolve()
      const bad = () => reject(new Error('Video metadata load failed'))
      video.addEventListener('loadedmetadata', ok, { once: true })
      video.addEventListener('error', bad, { once: true })
    })

    const durationSec = Number.isFinite(video.duration) ? video.duration : 0
    const t = Math.max(0, Math.min(timeSec, Math.max(0, durationSec - 1e-3)))
    video.currentTime = t
    await new Promise<void>((resolve, reject) => {
      const ok = () => resolve()
      const bad = () => reject(new Error('Video seek failed'))
      video.addEventListener('seeked', ok, { once: true })
      video.addEventListener('error', bad, { once: true })
    })

    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) throw new Error('Video has no decoded frame size')

    const maxEdge = opts?.maxEdge ?? 1280
    let tw = vw
    let th = vh
    if (Math.max(vw, vh) > maxEdge) {
      const s = maxEdge / Math.max(vw, vh)
      tw = Math.round(vw * s)
      th = Math.round(vh * s)
    }

    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unsupported')
    ctx.drawImage(video, 0, 0, tw, th)
    const dataUrl = canvas.toDataURL('image/png')
    return { dataUrl, width: tw, height: th, durationSec, timeSec: t }
  } finally {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
    video.load()
  }
}
