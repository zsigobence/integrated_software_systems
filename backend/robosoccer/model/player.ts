import { TeamType } from "./message-interfaces";

/** Player type for participants in a game */
export interface Player {
  id: number,
  socketId: string,
  name: string,
  team: TeamType | null,
  isInactive: boolean,
  x: number,
  y: number,
  x_velocity: number,
  y_velocity: number,
}
