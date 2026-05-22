import { useEffect, useState } from 'react'
import { isHexFrameMsg, normalizeFeedKey } from './liveHexCodec'
import { isLiveHexChatMsg } from './liveHexRoom'
import { liveHexChannelForRoom } from './vfl-room-share'

const PEER_STALE_MS = 12_000
const TICK_MS = 1500

/** Room link lifecycle for status UI. */
export type RoomLinkStatus = 'off' | 'live' | 'peer'

export const ROOM_LINK_STATUS_TITLE: Record<RoomLinkStatus, string> = {
  off: 'No room — use Make or paste a #vfl-room= link',
  live: 'Room active on this tab — waiting for another peer on the same link',
  peer: 'Another tab or peer is using this room link',
}

/**
 * Listens on the room BroadcastChannel and reports whether the link is idle,
 * live (joined, no remote activity yet), or peer (remote hex/chat recently).
 */
export function useRoomChannelActivity(roomId: string | null, localPeerId: string): RoomLinkStatus {
  const [lastPeerAt, setLastPeerAt] = useState(0)
  const [lastPeerRoom, setLastPeerRoom] = useState<string | null>(null)
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!roomId) return

    const ch = new BroadcastChannel(liveHexChannelForRoom(roomId))
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data
      let remote = false
      if (isHexFrameMsg(data)) {
        const fk = normalizeFeedKey(data.feedKey)
        if (fk !== localPeerId) remote = true
      } else if (isLiveHexChatMsg(data)) {
        if (data.from !== localPeerId) remote = true
      }
      if (remote) {
        setLastPeerAt(performance.now())
        setLastPeerRoom(roomId)
      }
    }
    ch.addEventListener('message', onMsg)
    const tick = window.setInterval(() => setNow(performance.now()), TICK_MS)
    return () => {
      ch.removeEventListener('message', onMsg)
      ch.close()
      window.clearInterval(tick)
    }
  }, [roomId, localPeerId])

  if (!roomId) return 'off'
  if (lastPeerRoom === roomId && lastPeerAt > 0 && now - lastPeerAt < PEER_STALE_MS) return 'peer'
  return 'live'
}
