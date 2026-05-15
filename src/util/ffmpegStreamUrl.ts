/**
 * Build-time template for an ffmpeg-served (or CDN) playlist URL for the current YouTube id.
 * Set `VITE_FFMPEG_STREAM_URL_TEMPLATE` to a string containing `{id}` or `{videoId}`.
 *
 * @example https://media.example.com/hls/{id}/master.m3u8
 */
export function ffmpegCdnStreamUrlForVideoId(videoId: string): string | null {
  const raw = import.meta.env.VITE_FFMPEG_STREAM_URL_TEMPLATE?.trim()
  if (!raw) return null
  return raw.replaceAll('{id}', videoId).replaceAll('{videoId}', videoId)
}
