/** Character type for each of the player's characters */
export interface Character {
  id: number,
  playerId: number,
  x: number,
  y: number,
  x_velocity: number,
  y_velocity: number,
}
