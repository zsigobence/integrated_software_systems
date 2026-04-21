/** Types of errors forwarded via socket */
export enum ErrorType {
  Other = 'other',
  RoomNotFound = 'room-not-found',
  RoomNoLongerExists = 'room-no-longer-exists',
  RoomAlreadyStarted = 'room-already-started',
  SettingUnavailable = 'setting-unavailable',
  NoUsername = 'no-username',
}

/** Types of teams in a game */
export enum TeamType {
  Red = 'red',
  Blue = 'blue',
  Spectator = 'spectator'
}

/** Message type for joining a room  */
export interface JoinMessage {
  username: string,
  roomId: number
}

/** Message type for picking a position */
export interface TeamPickerMessage {
  playerId: number,
  team: TeamType
}

/** Message type for the forwarding of player and room ids */
export interface IdMessage {
  playerId: number | null,
  roomId: number | null
}

export interface MovementMessage {
  coordinates: { x: number, y: number }[],
}

/** Error message type */
export interface ErrorMessage {
  errorType: ErrorType,
  message: string
}

export interface GameConfigMessage {
    fieldWidth: number;
    fieldHeight: number;
    playerRadius: number;
    ballRadius: number;
    goalMinY: number;
    goalMaxY: number;
    winScore: number;
    countdown: number;
}

export interface CollisionMessage {
    playerId: number;
    characterId: number;
}