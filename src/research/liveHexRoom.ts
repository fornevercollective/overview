import { useCallback, useEffect, useRef, useState } from 'react'
import { isHexFrameMsg, type HexFrameMsg, normalizeFeedKey } from './liveHexCodec'
import {
  decodeVflRoomSharePayload,
  encodeVflRoomShare,
  generatePeerFeedKey,
  generateRoomId,
  liveHexChannelForRoom,
  VFL_ROOM_HASH_PREFIX,
  type VflRoomSharePayload,
} from './vfl-room-share'

export type LiveHexChatMsg = {
  type: 'hexchat'
  from: string
  text: string
  t: number
}

export function isLiveHexChatMsg(data: unknown): data is LiveHexChatMsg {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'hexchat' && typeof d.from === 'string' && typeof d.text === 'string'
}

const MAX_CHAT = 80

export type UseLiveHexRoomOptions = {
  onHexFrame?: (msg: HexFrameMsg) => void
  onRoomApplied?: (data: { room: string; peer: string }) => void
}

export function useLiveHexRoom(opts: UseLiveHexRoomOptions = {}) {
  const onHexRef = useRef(opts.onHexFrame)
  const onRoomAppliedRef = useRef(opts.onRoomApplied)
  useEffect(() => {
    onHexRef.current = opts.onHexFrame
    onRoomAppliedRef.current = opts.onRoomApplied
  }, [opts.onHexFrame, opts.onRoomApplied])

  const [roomId, setRoomId] = useState<string | null>(null)
  const [peerId, setPeerId] = useState(() => generatePeerFeedKey())
  const [roomShareUrl, setRoomShareUrl] = useState<string | null>(null)
  const [roomErr, setRoomErr] = useState<string | null>(null)
  const [chatLog, setChatLog] = useState<LiveHexChatMsg[]>([])

  const applyRoomPayload = useCallback(async (data: VflRoomSharePayload): Promise<string | null> => {
    const peer = data.peer ?? generatePeerFeedKey()
    setRoomId(data.room)
    setPeerId(peer)
    onRoomAppliedRef.current?.({ room: data.room, peer })
    const enc = await encodeVflRoomShare({ v: 1, room: data.room, peer })
    if (enc.ok) {
      setRoomShareUrl(enc.shareUrl)
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', enc.shareUrl)
      }
      return enc.shareUrl
    }
    setRoomErr('Room link too long for this browser.')
    return null
  }, [])

  const startNewRoom = useCallback(async (): Promise<string | null> => {
    const room = generateRoomId()
    const peer = generatePeerFeedKey()
    setPeerId(peer)
    setRoomErr(null)
    return applyRoomPayload({ v: 1, room, peer })
  }, [applyRoomPayload])

  const joinRoomFromPaste = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      let payload = trimmed
      if (trimmed.includes(VFL_ROOM_HASH_PREFIX)) {
        const i = trimmed.indexOf(VFL_ROOM_HASH_PREFIX)
        payload = trimmed.slice(i + VFL_ROOM_HASH_PREFIX.length).split(/[#?&]/)[0] ?? ''
      } else if (trimmed.startsWith('#')) {
        payload = trimmed.slice(1).replace(/^vfl-room=/, '')
      }
      const data = await decodeVflRoomSharePayload(payload)
      if (!data) {
        setRoomErr('Could not read room link — paste the full #vfl-room=… URL or payload.')
        return
      }
      setRoomErr(null)
      const peer = data.peer ?? generatePeerFeedKey()
      setPeerId(peer)
      await applyRoomPayload({ v: 1, room: data.room, peer })
    },
    [applyRoomPayload],
  )

  const copyRoomLink = useCallback(async () => {
    if (!roomId) {
      await startNewRoom()
      return
    }
    const enc = await encodeVflRoomShare({ v: 1, room: roomId, peer: peerId })
    if (!enc.ok) {
      setRoomErr('Room link too long for this browser.')
      return
    }
    setRoomShareUrl(enc.shareUrl)
    try {
      await navigator.clipboard.writeText(enc.shareUrl)
    } catch {
      setRoomErr('Copy failed — select the link below.')
    }
  }, [roomId, peerId, startNewRoom])

  const postChat = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t || !roomId) return
      const msg: LiveHexChatMsg = { type: 'hexchat', from: peerId, text: t, t: performance.now() }
      setChatLog((prev) => [...prev.slice(-(MAX_CHAT - 1)), msg])
      try {
        const ch = new BroadcastChannel(liveHexChannelForRoom(roomId))
        ch.postMessage(msg)
        ch.close()
      } catch {
        /* noop */
      }
    },
    [roomId, peerId],
  )

  const publishHexToRoom = useCallback(
    (msg: Omit<HexFrameMsg, 'feedKey'> & { feedKey?: string }) => {
      if (!roomId) return
      try {
        const ch = new BroadcastChannel(liveHexChannelForRoom(roomId))
        ch.postMessage({
          ...msg,
          type: 'hexframe',
          feedKey: normalizeFeedKey(msg.feedKey ?? peerId),
        })
        ch.close()
      } catch {
        /* noop */
      }
    },
    [roomId, peerId],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (!hash.startsWith(VFL_ROOM_HASH_PREFIX)) return
    const payload = hash.slice(VFL_ROOM_HASH_PREFIX.length)
    void decodeVflRoomSharePayload(payload).then((data) => {
      if (data) void applyRoomPayload(data)
    })
  }, [applyRoomPayload])

  useEffect(() => {
    const channelName = liveHexChannelForRoom(roomId)
    const ch = new BroadcastChannel(channelName)
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data
      if (isHexFrameMsg(data)) {
        const fk = normalizeFeedKey(data.feedKey)
        if (fk === peerId) return
        onHexRef.current?.({ ...data, feedKey: fk })
        return
      }
      if (isLiveHexChatMsg(data)) {
        if (data.from === peerId) return
        setChatLog((prev) => {
          if (prev.some((m) => m.from === data.from && m.text === data.text && m.t === data.t)) return prev
          return [...prev.slice(-(MAX_CHAT - 1)), data]
        })
      }
    }
    ch.addEventListener('message', onMsg)
    return () => {
      ch.removeEventListener('message', onMsg)
      ch.close()
    }
  }, [roomId, peerId])

  return {
    roomId,
    peerId,
    roomShareUrl,
    roomErr,
    chatLog,
    setRoomErr,
    startNewRoom,
    joinRoomFromPaste,
    copyRoomLink,
    postChat,
    publishHexToRoom,
    isInRoom: roomId !== null,
  }
}
