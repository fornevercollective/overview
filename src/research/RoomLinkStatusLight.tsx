import { ROOM_LINK_STATUS_TITLE, type RoomLinkStatus } from './vflRoomLinkStatus'

export type RoomLinkStatusLightProps = {
  status: RoomLinkStatus
  className?: string
}

export function RoomLinkStatusLight({ status, className = '' }: RoomLinkStatusLightProps) {
  return (
    <span
      className={`ro-room-status-light ro-room-status-light--${status}${className ? ` ${className}` : ''}`}
      title={ROOM_LINK_STATUS_TITLE[status]}
      role="status"
      aria-label={ROOM_LINK_STATUS_TITLE[status]}
    />
  )
}
