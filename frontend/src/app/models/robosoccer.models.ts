export interface Room {
  roomId: number;
  ball: Ball;
  players: Player[];
  isStarted: boolean;
  winner: TeamType | null;
  score: {
    [TeamType.Blue]: number;
    [TeamType.Red]: number;
  };
  countdownTicks: number;
}

export interface Character {
  id: number;
  playerId: number;
  x: number;
  y: number;
  x_velocity: number;
  y_velocity: number;
}

export interface Player {
  id: number;
  socketId: string;
  name: string;
  isBot: boolean;
  team: TeamType | null;
  characters: Character[];
}

export interface Ball {
  x: number;
  y: number;
  x_velocity: number;
  y_velocity: number;
}

export interface JoinMessage {
  username: string;
  roomId: number;
}

export interface TeamPickerMessage {
  playerId: number;
  team: TeamType;
}

export interface IdMessage {
  playerId: number | null;
  roomId: number | null;
}

export interface MovementMessage {
  playerId: number | null;
  characterId: number | null;
  x: number | null;
  y: number | null;
}

export interface CollisionMessage {
  playerId: number;
  characterId: number;
}

export interface ErrorMessage {
  errorType: ErrorType;
  message: string;
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

export enum AiVersion {
  Default = 'default',
  Brain5v5 = 'brain5v5',
  PerfectStrategy = 'perfect',
  HybridStrategy = 'hybrid'
}

export enum ServerMessageType {
  TestMessage = 'serverTest',
  ConnectAck = 'connectAck',
  ReceiveId = 'receiveId',
  ReceiveRoom = 'receiveRoom',
  GameOver = 'gameOver',
  Error = 'error',
  ReconnectAck = 'reconnectAck',
  ReceiveConfig = 'receive-config',
  Collision = 'collision'
}

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

export enum TeamType {
  Red = 'red',
  Blue = 'blue',
  Spectator = 'spectator',
}

export enum ErrorType {
  Other = 'other',
  RoomNotFound = 'room-not-found',
  RoomNoLongerExists = 'room-no-longer-exists',
  RoomAlreadyStarted = 'room-already-started',
  SettingUnavailable = 'setting-unavailable',
  NoUsername = 'no-username',
}