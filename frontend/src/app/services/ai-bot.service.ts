import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { GameService } from './game.service';
import { Room, TeamType, AiVersion, ClientMessageType, ServerMessageType, GameConfigMessage } from '../models/robosoccer.models';
import { environment } from '../../environments/environment';

export interface ManagedBot {
  id: string;
  socket: Socket;
  playerId: number | null;
  team: TeamType;
  aiVersion: AiVersion;
}

@Injectable({
  providedIn: 'root'
})
export class AiBotManagerService implements OnDestroy {
  private bots: ManagedBot[] = [];
  private currentRoom: Room | null = null;
  private currentConfig: GameConfigMessage | null = null;
  private loopInterval: any;

  private readonly Kp = 0.3;
  private readonly Kd = 0.4;
  private readonly MAX_ACCEL = 10;

  constructor(private gameService: GameService) {
    this.gameService.roomState$.subscribe(r => this.currentRoom = r);
    this.gameService.configState$.subscribe(c => this.currentConfig = c);
    this.startAiLoop();
  }

  ngOnDestroy() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
    }
    this.clearBots();
  }

  addBot(roomId: number, team: TeamType, aiVersion: AiVersion) {
    const socket = io(environment.serverUrl, { withCredentials: true, transports: ['polling', 'websocket'] });
    const botId = Math.random().toString(36).substr(2, 9);
    
    const bot: ManagedBot = {
      id: botId,
      socket,
      playerId: null,
      team,
      aiVersion
    };

    socket.on('connect', () => {
      const botName = `AI_${Math.floor(Math.random() * 1000)}`;
      socket.emit(ClientMessageType.JoinRoom, { username: botName, roomId });
    });

    socket.on(ServerMessageType.ReceiveId, (data: any) => {
      bot.playerId = data.playerId;
      socket.emit(ClientMessageType.PickTeam, { playerId: bot.playerId, team });
    });

    socket.on(ServerMessageType.Error, (err) => {
      console.error(`Bot ${botId} error:`, err);
    });

    this.bots.push(bot);
  }

  removeBot(playerId: number) {
    const index = this.bots.findIndex(b => b.playerId === playerId);
    if (index > -1) {
      this.bots[index].socket.disconnect();
      this.bots.splice(index, 1);
    }
  }

  clearBots() {
    this.bots.forEach(b => b.socket.disconnect());
    this.bots = [];
  }

  isLocalBot(playerId: number): boolean {
    return this.bots.some(b => b.playerId === playerId);
  }

  // ÚJ FÜGGVÉNY: Bot agyának lekérdezése
  getBotAiVersion(playerId: number): AiVersion | null {
    const bot = this.bots.find(b => b.playerId === playerId);
    return bot ? bot.aiVersion : null;
  }

  // ÚJ FÜGGVÉNY: Bot agyának módosítása
  changeBotAi(playerId: number, newVersion: AiVersion) {
    const bot = this.bots.find(b => b.playerId === playerId);
    if (bot) {
      bot.aiVersion = newVersion;
    }
  }

  private startAiLoop() {
    this.loopInterval = setInterval(() => {
      if (!this.currentRoom || !this.currentRoom.isStarted || !this.currentConfig) return;

      const room = this.currentRoom;
      const config = this.currentConfig;

      for (const bot of this.bots) {
        if (bot.playerId === null) continue;
        const player = room.players.find(p => p.id === bot.playerId);
        if (!player) continue;

        this.processBotLogic(bot, player, room, config);
      }
    }, 33);
  }

  private processBotLogic(bot: ManagedBot, player: any, room: Room, config: GameConfigMessage) {
    const ball = room.ball;
    const characters = [...player.characters];
    if (characters.length === 0) return;

    // Kék = bal oldal (kapu x=0), Piros = jobb oldal (kapu x=fieldWidth)
    const isRed = bot.team === TeamType.Red;
    const ownGoalX = isRed ? config.fieldWidth : 0;
    const oppGoalX = isRed ? 0 : config.fieldWidth;
    const oppGoalY = config.fieldHeight / 2;
    const defendX = isRed ? config.fieldWidth - 50 : 50;
    const direction = isRed ? -1 : 1;

    if (bot.aiVersion === AiVersion.PerfectStrategy) {
      this.runPerfectStrategy(bot, characters, ball, config, defendX, direction, oppGoalX, oppGoalY);
    } else if (bot.aiVersion === AiVersion.Brain5v5) {
      this.runBrain5v5(bot, characters, ball, config, defendX, direction);
    } else {
      for (const char of characters) {
        this.moveCharacter(bot, char, ball.x, ball.y);
      }
    }
  }

  /**
   * MATLAB perfect_strategy bulldozer + sarok-kezelés + aktív védekezés.
   * Mindkét oldalhoz adaptálódik: a logika "kék perspektívában" (saját kapu x=0)
   * számol, majd toFieldX() tükrözi a piros oldalra.
   */
  private runPerfectStrategy(
    bot: ManagedBot, characters: any[], ball: any,
    config: GameConfigMessage, defendX: number, direction: number,
    oppGoalX: number, oppGoalY: number
  ) {
    const W = config.fieldWidth;
    const H = config.fieldHeight;
    const isRed = bot.team === TeamType.Red;
    const bx = ball.x;
    const by = ball.y;

    // Normalizált labda x: saját kapu = 0, ellenfél kapu = W
    const nbx = isRed ? W - bx : bx;
    // X konverzió normalizáltból valós pályakoordinátába
    const toFieldX = (x: number) => isRed ? W - x : x;

    // === KAPUSOK (1-2): Széthúzott fal ===
    const goalieCount = Math.min(2, characters.length);
    const goalieTargets = [
      { x: toFieldX(50), y: H / 2 - 55 },
      { x: toFieldX(50), y: H / 2 + 55 }
    ];
    for (let i = 0; i < goalieCount; i++) {
      this.moveCharacter(bot, characters[i], goalieTargets[i].x, goalieTargets[i].y);
    }

    // === TÁMADÓK: távolság alapú szereposztás ===
    const fieldPlayers = characters.slice(goalieCount);
    if (fieldPlayers.length === 0) return;

    const sorted = [...fieldPlayers].sort((a, b) =>
      Math.hypot(a.x - bx, a.y - by) - Math.hypot(b.x - bx, b.y - by)
    );
    const carrier = sorted[0];
    const w1 = sorted.length >= 2 ? sorted[1] : null;
    const w2 = sorted.length >= 3 ? sorted[2] : null;

    let tCarrier = { x: 0, y: 0 };
    let tW1 = { x: 0, y: 0 };
    let tW2 = { x: 0, y: 0 };

    // --- SAROK DETEKTÁLÁS ---
    let cornerType = 0;
    if (nbx > W - 200 && by < 200) cornerType = 1;       // Ellenfél felső sarok
    else if (nbx > W - 200 && by > H - 200) cornerType = 2; // Ellenfél alsó sarok
    else if (nbx < 200 && by < 200) cornerType = 3;       // Saját felső sarok
    else if (nbx < 200 && by > H - 200) cornerType = 4;   // Saját alsó sarok

    if (cornerType > 0) {
      // --- BLOKÁD MANŐVER (sarokból kiszabadítás) ---
      if (cornerType === 1) {
        tCarrier = { x: toFieldX(W - 300), y: 250 };
        tW1 = { x: toFieldX(W - 600), y: 300 };
        tW2 = { x: toFieldX(W - 600), y: 600 };
      } else if (cornerType === 2) {
        tCarrier = { x: toFieldX(W - 300), y: H - 250 };
        tW1 = { x: toFieldX(W - 600), y: H - 300 };
        tW2 = { x: toFieldX(W - 600), y: H - 600 };
      } else if (cornerType === 3) {
        tCarrier = { x: toFieldX(300), y: 250 };
        tW1 = { x: toFieldX(600), y: 300 };
        tW2 = { x: toFieldX(600), y: 600 };
      } else if (cornerType === 4) {
        tCarrier = { x: toFieldX(300), y: H - 250 };
        tW1 = { x: toFieldX(600), y: H - 300 };
        tW2 = { x: toFieldX(600), y: H - 600 };
      }

    } else if (nbx < 600) {
      // --- AKTÍV VÉDEKEZÉS: Élő Pajzs a saját térfélen ---
      // Carrier: labda mögé áll, kifelé (az ellenfél felé) tolja
      tCarrier = { x: toFieldX(Math.max(70, nbx - 40)), y: by };

      // W1, W2: dinamikus pajzsfal a kapu és labda között
      const dirX = nbx - 50;
      const dirY = by - H / 2;
      const dirN = Math.hypot(dirX, dirY);
      const dX = dirN > 1e-6 ? dirX / dirN : 1;
      const dY = dirN > 1e-6 ? dirY / dirN : 0;
      const perpX = -dY;
      const perpY = dX;

      const baseX = 50 + dX * 200;
      const baseY = H / 2 + dY * 200;

      tW1 = { x: toFieldX(baseX + perpX * 80), y: baseY + perpY * 80 };
      tW2 = { x: toFieldX(baseX - perpX * 80), y: baseY - perpY * 80 };

    } else {
      // --- NORMÁL BULLDÓZER (támadás) ---
      let aimX = W;
      let aimY = H / 2;
      let modNbx = nbx;
      let modBy = by;

      // Falsúrolás korrekció: ha a labda a fal közelében van, eltérítjük a célpontot
      if (by < 80) { modBy = 120; aimY = 700; }
      else if (by > H - 80) { modBy = H - 120; aimY = 300; }

      let dtgX = aimX - modNbx;
      let dtgY = aimY - modBy;
      const dtgN = Math.hypot(dtgX, dtgY);
      if (dtgN > 1e-6) { dtgX /= dtgN; dtgY /= dtgN; }
      const pX = -dtgY;
      const pY = dtgX;

      // Carrier: labda mögött 45-tel a kapu irányában
      tCarrier = { x: toFieldX(modNbx - dtgX * 45), y: modBy - dtgY * 45 };
      // Szélsők: 75-tel hátrább, oldalirányban 65-tel széthúzva
      tW1 = { x: toFieldX(modNbx - dtgX * 75 + pX * 65), y: modBy - dtgY * 75 + pY * 65 };
      tW2 = { x: toFieldX(modNbx - dtgX * 75 - pX * 65), y: modBy - dtgY * 75 - pY * 65 };
    }

    // --- Határok & mozgatás ---
    const clampX = (x: number) => Math.max(70, Math.min(W - 70, x));
    const clampY = (y: number) => Math.max(70, Math.min(H - 70, y));

    this.moveCharacter(bot, carrier, clampX(tCarrier.x), clampY(tCarrier.y));
    if (w1) this.moveCharacter(bot, w1, clampX(tW1.x), clampY(tW1.y));
    if (w2) this.moveCharacter(bot, w2, clampX(tW2.x), clampY(tW2.y));

    for (let i = 3; i < sorted.length; i++) {
      this.moveCharacter(bot, sorted[i], bx, by);
    }
  }

  private runBrain5v5(
    bot: ManagedBot, characters: any[], ball: any,
    config: GameConfigMessage, defendX: number, direction: number
  ) {
    if (characters.length >= 5) {
      this.moveCharacter(bot, characters[0], defendX, config.fieldHeight / 2);
      this.moveCharacter(bot, characters[1], defendX + (direction * 150), ball.y - 100);
      this.moveCharacter(bot, characters[2], defendX + (direction * 150), ball.y + 100);
      this.moveCharacter(bot, characters[3], ball.x, ball.y);
      this.moveCharacter(bot, characters[4], ball.x + (direction * 100), config.fieldHeight / 2);
    } else {
      for (const char of characters) {
        this.moveCharacter(bot, char, ball.x, ball.y);
      }
    }
  }

  private moveCharacter(bot: ManagedBot, character: any, targetX: number, targetY: number) {
    const rawAx = this.Kp * (targetX - character.x) - this.Kd * character.x_velocity;
    const rawAy = this.Kp * (targetY - character.y) - this.Kd * character.y_velocity;

    const ax = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAx));
    const ay = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAy));

    bot.socket.emit(ClientMessageType.MovementMessage, {
      playerId: bot.playerId,
      characterId: character.id,
      x: ax,
      y: ay
    });
  }
}