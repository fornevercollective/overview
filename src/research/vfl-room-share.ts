/**
 * Video feeds lab room links — Kognise Notes–style random URL in the hash
 * (see https://github.com/kognise/notes — state encoded in `#…` for paste/share).
 */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

export const VFL_ROOM_HASH_KEY = 'vfl-room='
export const VFL_ROOM_HASH_PREFIX = `#${VFL_ROOM_HASH_KEY}`
export const VFL_PENDING_FEED_STORAGE = 'overview-vfl-pending-feed'
export const VFL_PENDING_ROOM_STORAGE = 'overview-vfl-pending-room'
export const MAX_VFL_ROOM_SHARE_URL_CHARS = 8000

const LZ_V = 1 as const

type LzRoomEnvelope = { v: typeof LZ_V; m: 'lz'; p: string }

export type VflRoomSharePayload = {
  /** Schema version */
  v: 1
  /** Short room id shared by all tabs on the link */
  room: string
  /** This tab’s peer feed key (optional; generated on join if missing) */
  peer?: string
}

const ROOM_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function generateRoomId(byteLength = 6): string {
  const n = Math.min(12, Math.max(4, byteLength))
  const arr = new Uint8Array(n)
  crypto.getRandomValues(arr)
  let s = ''
  for (let i = 0; i < n; i++) s += ROOM_ID_CHARS[arr[i]! % ROOM_ID_CHARS.length]!
  return s
}

export function generatePeerFeedKey(): string {
  return `peer:${generateRoomId(5)}`
}

export function liveHexChannelForRoom(roomId: string | null | undefined): string {
  const r = roomId?.trim()
  if (r && r.length <= 48) return `overview-live-hex:${r}`
  return 'overview-live-hex'
}

function isLzEnvelope(x: unknown): x is LzRoomEnvelope {
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

export function buildVflRoomShareUrl(payload: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}${VFL_ROOM_HASH_PREFIX}${payload}`
}

export type EncodeVflRoomResult =
  | { ok: true; payload: string; shareUrl: string }
  | { ok: false; reason: 'too_large' }

export async function encodeVflRoomShare(data: VflRoomSharePayload): Promise<EncodeVflRoomResult> {
  const json = JSON.stringify(data)
  const lzBody: LzRoomEnvelope = { v: LZ_V, m: 'lz', p: compressToEncodedURIComponent(json) }
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(lzBody)))
  const shareUrl = buildVflRoomShareUrl(payload)
  if (shareUrl.length > MAX_VFL_ROOM_SHARE_URL_CHARS) return { ok: false, reason: 'too_large' }
  return { ok: true, payload, shareUrl }
}

export async function decodeVflRoomSharePayload(b64url: string): Promise<VflRoomSharePayload | null> {
  const trimmed = b64url.trim()
  if (!trimmed) return null
  try {
    const bytes = base64UrlToBytes(trimmed)
    const text = new TextDecoder('utf-8').decode(bytes)
    let json: string
    try {
      const parsed: unknown = JSON.parse(text)
      if (isLzEnvelope(parsed)) {
        json = decompressFromEncodedURIComponent(parsed.p)
        if (!json) return null
      } else {
        json = text
      }
    } catch {
      json = text
    }
    const data = JSON.parse(json) as VflRoomSharePayload
    if (data?.v !== 1 || typeof data.room !== 'string' || !data.room.trim()) return null
    return { v: 1, room: data.room.trim(), peer: typeof data.peer === 'string' ? data.peer.trim() : undefined }
  } catch {
    return null
  }
}

/** Extract base64url payload from a pasted URL or `#vfl-room=…` fragment. */
export function extractVflRoomPayloadFromPaste(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.includes(VFL_ROOM_HASH_PREFIX)) {
    const i = trimmed.indexOf(VFL_ROOM_HASH_PREFIX)
    return trimmed.slice(i + VFL_ROOM_HASH_PREFIX.length).split(/[#?&]/)[0] ?? ''
  }
  if (trimmed.startsWith('#')) return trimmed.slice(1).replace(/^vfl-room=/, '')
  return trimmed
}

export async function decodeRoomPaste(raw: string): Promise<VflRoomSharePayload | null> {
  const payload = extractVflRoomPayloadFromPaste(raw)
  if (!payload) return null
  return decodeVflRoomSharePayload(payload)
}

export function consumePendingFeedPaste(): string | null {
  try {
    const raw = sessionStorage.getItem(VFL_PENDING_FEED_STORAGE)
    if (raw) sessionStorage.removeItem(VFL_PENDING_FEED_STORAGE)
    return raw
  } catch {
    return null
  }
}

export function stashPendingFeedPaste(raw: string): void {
  try {
    sessionStorage.setItem(VFL_PENDING_FEED_STORAGE, raw.trim())
  } catch {
    /* private mode */
  }
}

export function consumePendingRoomPaste(): string | null {
  try {
    const raw = sessionStorage.getItem(VFL_PENDING_ROOM_STORAGE)
    if (raw) sessionStorage.removeItem(VFL_PENDING_ROOM_STORAGE)
    return raw
  } catch {
    return null
  }
}

export function stashPendingRoomPaste(raw: string): void {
  try {
    sessionStorage.setItem(VFL_PENDING_ROOM_STORAGE, raw.trim())
  } catch {
    /* private mode */
  }
}
