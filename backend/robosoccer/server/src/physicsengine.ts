import { TeamType } from "../../model/message-interfaces";
import { Room } from "../../model/room";
import { GameConfig } from "./constants";

export class PhysicsEngine {

    public resetPlayerPositions(room: Room) {
        const bluePlayers = room.players.filter(p => p.team === TeamType.Blue);
        const redPlayers = room.players.filter(p => p.team === TeamType.Red);

        const blueTeamX = GameConfig.FIELD_WIDTH / 4;
        const redTeamX = GameConfig.FIELD_WIDTH * 3 / 4;

        bluePlayers.forEach((player, index) => {
            player.x = blueTeamX;
            player.y = (GameConfig.FIELD_HEIGHT / (bluePlayers.length + 1)) * (index + 1);
            player.x_velocity = 0;
            player.y_velocity = 0;
        });

        redPlayers.forEach((player, index) => {
            player.x = redTeamX;
            player.y = (GameConfig.FIELD_HEIGHT / (redPlayers.length + 1)) * (index + 1);
            player.x_velocity = 0;
            player.y_velocity = 0;
        });
    }
    
public updateRoom(room: Room) {

    if (room.isStarted) {

        if (room.countdownTicks > 0) {

            room.countdownTicks --; // Decrease countdown
            return; // Skip the rest of the loop for this room
        }

        //Update positions based on velocities
        room.players.forEach(p => {

            if (p.team != TeamType.Spectator) {
            p.x_velocity = Math.max(-GameConfig.MAX_SPEED, Math.min(GameConfig.MAX_SPEED, p.x_velocity));
            p.y_velocity = Math.max(-GameConfig.MAX_SPEED, Math.min(GameConfig.MAX_SPEED, p.y_velocity));

            p.x += p.x_velocity;
            p.y += p.y_velocity;
            p.x_velocity *= GameConfig.FRICTION; // Apply friction
            p.y_velocity *= GameConfig.FRICTION;
            this.handleWallCollision(p, GameConfig.PLAYER_RADIUS);
            }
        });

        // Update ball position
        room.ball.x_velocity = Math.max(-GameConfig.MAX_SPEED, Math.min(GameConfig.MAX_SPEED, room.ball.x_velocity));
        room.ball.y_velocity = Math.max(-GameConfig.MAX_SPEED, Math.min(GameConfig.MAX_SPEED, room.ball.y_velocity));
        room.ball.x += room.ball.x_velocity;
        room.ball.y += room.ball.y_velocity;
        room.ball.x_velocity *= GameConfig.FRICTION;
        room.ball.y_velocity *= GameConfig.FRICTION;
        // Pass a flag to indicate this is the ball
        let goalScored = this.handleWallCollision(room.ball, GameConfig.BALL_RADIUS, true, room);

        if (goalScored) {
            // If a goal was scored, we can skip player collisions for this tick
            if (room.score[TeamType.Red] >= GameConfig.WIN_SCORE) {
                room.winner = TeamType.Red;  

            } else if (room.score[TeamType.Blue] >= GameConfig.WIN_SCORE) {
                room.winner = TeamType.Blue;

            }
            
            return;
        }

        // Check collisions between Players and the Ball
        room.players.forEach(p => {
            this.handleCircleCollision(p, room.ball, GameConfig.PLAYER_RADIUS, GameConfig.BALL_RADIUS);
        });
    }

    return;
}

private handleWallCollision(entity: any, radius: number, isBall: boolean = false, room?: Room): boolean {
        let goalScored = false;

        // Check Left Wall (Blue Team's defending side)
        if (entity.x - radius < 0) {
            if (isBall && entity.y > GameConfig.GOAL_MIN_Y && entity.y < GameConfig.GOAL_MAX_Y) {
                // Ball went into Left Goal -> Red Team scores!
                if (room) this.scoreGoal(room, TeamType.Red);
                return true; 
            } else {
                entity.x = radius;
                entity.x_velocity *= -GameConfig.BOUNCE_RESTITUTION;
            }
        } 
        // Check Right Wall (Red Team's defending side)
        else if (entity.x + radius > GameConfig.FIELD_WIDTH) {
            if (isBall && entity.y > GameConfig.GOAL_MIN_Y && entity.y < GameConfig.GOAL_MAX_Y) {
                // Ball went into Right Goal -> Blue Team scores!
                if (room) this.scoreGoal(room, TeamType.Blue);
                return true;
            } else {
                entity.x = GameConfig.FIELD_WIDTH - radius;
                entity.x_velocity *= -GameConfig.BOUNCE_RESTITUTION;
            }
        }

        // Top and Bottom walls remain the same
        if (entity.y - radius < 0) {
            entity.y = radius;
            entity.y_velocity *= -GameConfig.BOUNCE_RESTITUTION;
        } else if (entity.y + radius > GameConfig.FIELD_HEIGHT) {
            entity.y = GameConfig.FIELD_HEIGHT - radius;
            entity.y_velocity *= -GameConfig.BOUNCE_RESTITUTION;
        }

        return goalScored;
    }

    private scoreGoal(room: Room, scoringTeam: TeamType) {
        // Increment score
        room.score[scoringTeam] += 1;
    
        // Reset positions for the next round
        room.ball = { x: GameConfig.FIELD_WIDTH/2, y: GameConfig.FIELD_HEIGHT/2, x_velocity: 0, y_velocity: 0 };
        
        this.resetPlayerPositions(room);

        room.countdownTicks = GameConfig.COUNTDOWN_SEC * GameConfig.FPS; // Start countdown for next round
    
    }

    private handleCircleCollision(c1: any, c2: any, r1: number, r2: number) {
        const dx = c2.x - c1.x;
        const dy = c2.y - c1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = r1 + r2;

        if (distance < minDist && distance > 0) {
            // Resolve overlap (push them apart so they don't get stuck)
            const overlap = minDist - distance;
            const nx = dx / distance;
            const ny = dy / distance;
            
            // Move each away by half the overlap
            c1.x -= nx * (overlap / 2);
            c1.y -= ny * (overlap / 2);
            c2.x += nx * (overlap / 2);
            c2.y += ny * (overlap / 2);

            // Calculate simple elastic bounce (treating masses as equal for simplicity)
            const vCollisionX = c2.x_velocity - c1.x_velocity;
            const vCollisionY = c2.y_velocity - c1.y_velocity;
            const speed = vCollisionX * nx + vCollisionY * ny;

            // Only bounce if they are moving towards each other
            if (speed < 0) {
                const bounce = speed * GameConfig.BOUNCE_RESTITUTION;
                c1.x_velocity += nx * bounce;
                c1.y_velocity += ny * bounce;
                c2.x_velocity -= nx * bounce;
                c2.y_velocity -= ny * bounce;
            }
        }
    }
}