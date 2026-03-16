export const GameConfig = {
    FPS: 60,
    TICK_RATE: 1000 / 60, // ~16.6ms
    FIELD_WIDTH: 2000,
    FIELD_HEIGHT: 1000,
    PLAYER_RADIUS: 50,
    BALL_RADIUS: 20,
    MAX_SPEED: 50,
    MAX_ACCELERATION: 10,
    FRICTION: 0.98, // Multiplier to slow down objects over time
    BOUNCE_RESTITUTION: 0.8, // Energy kept after a bounce (0 to 1)
    GOAL_MIN_Y: 400, // Add goal boundaries (e.g., a goal in the middle of the Y-axis, 200 units wide)
    GOAL_MAX_Y: 600,
    WIN_SCORE: 3, // Play until 3 goals
    COUNTDOWN_SEC: 3, // Countdown in ticks (e.g., 5 seconds at 60 FPS = 300 ticks)
    MINIMUM_PLAYERS_TO_START: 1, // Minimum players required to start the game
};