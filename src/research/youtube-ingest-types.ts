/**
 * YouTube ingest manifest types for the offline pipeline staged under
 * `/Volumes/qbitOS/03.models/00-mu/model/ingest/youtube/<playlistId>/`.
 *
 * Mirrors the Iron Line (L0–L7 + META) convention used by
 * `00-mu/MANIFEST.ironline.json` so playlist bundles can be diffed by
 * (upgradeKey, sha256) the same way model bundles are.
 *
 * No runtime code; types only. This file is the integration hook for the
 * Overview viewer — it can `import type` these shapes and render manifests
 * produced by the pipeline.
 */

export type IronLine =
  | 'L0' // raw, ephemeral: captions, frame stills, metadata json
  | 'L1' // shim / glue: pipeline run logs, tool invocation records
  | 'L2' // commander / orchestration manifests
  | 'L3' // granular: per-segment transcript chunks, per-frame OCR/VL captions
  | 'L4' // primary weights / canonical doc: cross-linked reference document
  | 'L5' // payloads: audio blobs, image blobs, embedding shards
  | 'L6' // research output: cookbook/example reference docs
  | 'L7' // governance: privacy/ToS/license attribution records
  | 'META'

/** Absolute or bundle-relative POSIX path. Bundle-relative is preferred. */
export type BundlePath = string

export type Sha256Hex = string

/** Whole seconds or float seconds; pipeline emits float with 3-decimal precision. */
export type SecondsFloat = number

/** Stable cross-version slot id (e.g. `video:<id>/segment:000123`). */
export type UpgradeKey = string

export interface IngestArtifact {
  seq: string
  ironLine: IronLine
  upgradeKey: UpgradeKey
  path: BundlePath
  kind: 'file' | 'directory'
  sha256: Sha256Hex | null
  sizeBytes: number | null
  /** Content-addressable role tag for routing (e.g. `captions.vtt`, `frame.jpg`, `segment.json`). */
  role?: string
}

export interface VideoMeta {
  id: string
  url: string
  title: string
  uploader?: string
  uploadDate?: string
  durationSec: SecondsFloat
  language?: string
  /** Source of transcript text: official captions, auto-captions, or ASR. */
  transcriptSource: 'captions-manual' | 'captions-auto' | 'asr-whisper' | 'asr-lfm2-audio'
  /** `true` only when run with one-time online stage; false for pure offline reruns. */
  fetchedOnline: boolean
}

export interface FrameRef {
  /** Path under `model/ingest/youtube/<playlistId>/blobs/frames/<videoId>/`. */
  path: BundlePath
  /** Timestamp in source video. */
  tSec: SecondsFloat
  /** Sampling reason: scene-change keyframe, fixed interval, or thumbnail. */
  kind: 'keyframe' | 'interval' | 'thumbnail'
  width?: number
  height?: number
  sha256?: Sha256Hex
  /** OCR text extracted offline (e.g. via olmocr-2-7b). */
  ocrText?: string
  /** Vision-language caption (e.g. via LFM2-VL-3B-GGUF). */
  vlCaption?: string
}

export interface TranscriptSegment {
  /** Stable id: `<videoId>:seg:<6-digit-zero-padded>`. */
  id: string
  /** Inclusive start, exclusive end. */
  startSec: SecondsFloat
  endSec: SecondsFloat
  text: string
  /** Frames whose tSec falls in [startSec, endSec). */
  frameRefs: BundlePath[]
  /** Optional embedding vector path (e.g. nomic-embed-text shard + offset). */
  embeddingRef?: { shard: BundlePath; offset: number; dim: number }
  /** Cookbook / example anchors this segment maps to, scored. */
  refs?: Array<{
    cookbookId: string
    anchor: string
    score: number
    /** Which model produced the link (e.g. `granite-embedding`, `LFM2-1.2B-Tool`). */
    by: string
  }>
}

export interface VideoRecord {
  meta: VideoMeta
  /** Path to captions file (.vtt or .srt) if available, else null. */
  captionsPath: BundlePath | null
  /** Path to audio blob (.opus / .m4a) if extracted, else null. */
  audioPath: BundlePath | null
  frames: FrameRef[]
  segments: TranscriptSegment[]
  /** Path to the generated cross-link reference document for this video. */
  referenceDocPath: BundlePath
}

export interface PlaylistIngestManifest {
  manifestVersion: '1.0.0'
  bundleId: string
  playlistId: string
  playlistUrl: string
  playlistTitle: string
  generatedAt: string
  registryUri: 'https://registry.ugrad.ai/library/'
  /** Resolved local model paths used during this run. Recorded for reproducibility. */
  modelsUsed: {
    asr?: BundlePath
    vl?: BundlePath
    ocr?: BundlePath
    embed?: BundlePath
    summarizer?: BundlePath
  }
  /** Iron Line index over every file produced. */
  entries: IngestArtifact[]
  videos: VideoRecord[]
  /** Per-playlist roll-up document (cookbook/examples cross-reference). */
  playlistReferenceDocPath: BundlePath
  /** Privacy / ToS / license attribution snapshot. */
  governance: {
    license: 'CC-BY' | 'CC-BY-SA' | 'CC-BY-NC' | 'standard-youtube' | 'unknown'
    tosNote: string
    privacyNote: string
  }
  upgradeDiffHints: {
    compareBy: ['seq', 'sha256', 'sizeBytes']
    stableIdField: 'upgradeKey'
  }
}
