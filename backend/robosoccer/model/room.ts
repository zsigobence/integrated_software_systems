import { Ball } from "./ball"
import { TeamType } from "./message-interfaces"
import { Player } from "./player"

export interface Room {
  roomId: number,
  ball: Ball,
  players: Player[],
  isStarted: boolean,
  winner: TeamType | null,
  score: {
    [TeamType.Blue]: number;
    [TeamType.Red]: number;
    [TeamType.Spectator]: number;
  },
  countdownTicks: number; 
}