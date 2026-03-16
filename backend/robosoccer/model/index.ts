/**Constant for the maximum message lenght in chars */
export const MAX_MESSAGE_LENGTH = 255

export const BALL_DIAMETER = 80

export const PLAYER_DIAMETER = 128


/** Enum for message types FROM SERVER */
export enum ServerMessageType {
  TestMessage = 'serverTest',
  ConnectAck = 'connectAck',
  ReceiveId = 'receiveId',
  ReceiveRoom = 'receiveRoom',
  GameOver = 'gameOver',
  Error = 'error',
  ReceiveConfig = 'receive-config'
}

/** Enum for message types FROM CLIENT */
export enum ClientMessageType {
  TestMessage = 'clientTest',
  CreateRoom = 'createRoom',
  JoinRoom = 'joinRoom',
  LeaveRoom = 'leaveRoom',
  GetId = 'getId',
  PickTeam = 'pickTeam',
  StartGame = 'startGame',
  RestartGame = 'restartGame',
  MovementMessage = 'movementMessage'
}