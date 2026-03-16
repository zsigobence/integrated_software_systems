export type TeamType = 'red' | 'blue' | 'spectator';

export interface Ball {
  x: number;
  y: number;
  x_velocity: number;
  y_velocity: number;
}

export interface Player {
  id: number;
  socketId: string;
  name: string;
  team: TeamType | null;
  isInactive: boolean;
  x: number;
  y: number;
  x_velocity: number;
  y_velocity: number;
}

export interface Room {
  roomId: number;
  ball: Ball;
  players: Player[];
  isStarted: boolean;
  winner: TeamType | null;
  score: {
    blue: number;
    red: number;
    spectator: number;
  };
  countdownTicks: number;
}

export interface IdMessage {
  playerId: number | null;
  roomId: number | null;
}

export interface JoinMessage {
  username: string;
  roomId: number;
}

export interface ErrorMessage {
  errorType: string;
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
