import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import {
  MAX_IMPORT_BYTES,
  type OverviewWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  parseWorkspaceSnapshotFromJsonText,
} from './workspace-snapshot'

/** Hash fragment key (without `#`). Value is base64url payload; see module decode logic. */
export const WORKSPACE_SHARE_HASH_KEY = 'workspace-share='

/** Full hash prefix including `#`. */
export const WORKSPACE_SHARE_HASH_PREFIX = `#${WORKSPACE_SHARE_HASH_KEY}`

/** Practical URL length guard (path + query + hash; conservative for older browsers). */
export const MAX_WORKSPACE_SHARE_URL_CHARS = 8000

const LZ_ENVELOPE_VERSION = 1 as const

type LzShareEnvelope = {
  v: typeof LZ_ENVELOPE_VERSION
  m: 'lz'
  p: string
}

function isLzEnvelope(x: unknown): x is LzShareEnvelope {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return o.v === 1 && o.m === 'lz' && typeof o.p === 'string'
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(b64url: string): Uint8Array {
  let s = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  if (pad) s += '='.repeat(4 - pad)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function hasGzip(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

async function gzipUtf8(text: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(text)
  const blob = new Blob([enc])
  const compressed = blob.stream().pipeThrough(new CompressionStream('gzip'))
  const buf = await new Response(compressed).arrayBuffer()
  return new Uint8Array(buf)
}

async function gunzipToUtf8(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function utf8BytesToString(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

export function buildWorkspaceShareUrl(payload: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}#${WORKSPACE_SHARE_HASH_KEY}${payload}`
}

export type EncodeWorkspaceShareResult =
  | { ok: true; payload: string; shareUrl: string }
  | { ok: false; reason: 'too_large' }

/**
 * Encodes a snapshot for `#workspace-share=<payload>`.
 * Prefers gzip (CompressionStream) when available; otherwise LZ-string envelope as UTF-8 JSON;
 * may use raw base64url UTF-8 JSON for small payloads when shorter.
 */
export async function encodeWorkspaceShare(snap: OverviewWorkspaceSnapshot): Promise<EncodeWorkspaceShareResult> {
  const json = JSON.stringify(snap)
  const candidates: string[] = []

  if (hasGzip()) {
    try {
      const gz = await gzipUtf8(json)
      if (gz.length >= 2 && gz[0] === 0x1f && gz[1] === 0x8b) {
        candidates.push(bytesToBase64Url(gz))
      }
    } catch {
      /* ignore — fall back */
    }
  }

  const lzBody: LzShareEnvelope = { v: LZ_ENVELOPE_VERSION, m: 'lz', p: compressToEncodedURIComponent(json) }
  candidates.push(bytesToBase64Url(new TextEncoder().encode(JSON.stringify(lzBody))))

  if (json.length <= 4096) {
    candidates.push(bytesToBase64Url(new TextEncoder().encode(json)))
  }

  let best = candidates[0]!
  let bestUrlLen = buildWorkspaceShareUrl(best).length
  for (const c of candidates) {
    const len = buildWorkspaceShareUrl(c).length
    if (len < bestUrlLen) {
      best = c
      bestUrlLen = len
    }
  }

  const shareUrl = buildWorkspaceShareUrl(best)
  if (shareUrl.length > MAX_WORKSPACE_SHARE_URL_CHARS) {
    return { ok: false, reason: 'too_large' }
  }
  return { ok: true, payload: best, shareUrl }
}

/**
 * Decodes `#workspace-share` payload bytes/string into a validated snapshot.
 */
export async function decodeWorkspaceSharePayload(payload: string): Promise<OverviewWorkspaceSnapshot> {
  const trimmed = payload.trim()
  if (!trimmed) throw new Error('Empty share payload')

  let bytes: Uint8Array
  try {
    bytes = base64UrlToBytes(trimmed)
  } catch {
    throw new Error('Invalid share link (base64)')
  }

  let text: string
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (!hasGzip()) throw new Error('This browser cannot decompress a gzip workspace link')
    text = await gunzipToUtf8(bytes)
  } else {
    text = utf8BytesToString(bytes)
  }

  if (text.length > MAX_IMPORT_BYTES) {
    throw new Error('Share payload exceeds maximum import size')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('Invalid share payload (JSON)')
  }

  if (isLzEnvelope(parsed)) {
    const inner = decompressFromEncodedURIComponent(parsed.p)
    if (!inner) throw new Error('Invalid share payload (LZ decompress failed)')
    return parseWorkspaceSnapshotFromJsonText(inner)
  }

  return parseWorkspaceSnapshot(parsed)
}

export async function copyShareUrlToClipboard(shareUrl: string): Promise<'clipboard' | 'prompt'> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl)
      return 'clipboard'
    }
  } catch {
    /* fall through */
  }
  window.prompt('Copy share link:', shareUrl)
  return 'prompt'
}
