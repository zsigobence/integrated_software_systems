import { Injectable, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { io, Socket } from 'socket.io-client';
import { GameService } from './game.service';
import { Room, TeamType, AiVersion, ClientMessageType, ServerMessageType, GameConfigMessage } from '../models/robosoccer.models';

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
  private serverBotAis: { [playerId: number]: AiVersion } = {};
  private currentRoom: Room | null = null;
  private currentConfig: GameConfigMessage | null = null;
  private rescueState: { [playerId: number]: {
    phase: 'NONE' | 'PREPARE' | 'STRIKE', 
    startTime: number, 
    kickerId: number | null,
    wallEnterTime: number 
  } } = {};
  private aiStrategies: { [key: string]: any } = {};

  private readonly Kp = 0.3;
  private readonly Kd = 0.4;
  private readonly MAX_ACCEL = 10;

  private lastBallPos: { x: number; y: number } = { x: -1, y: -1 };
  private ballStuckSince: number = Date.now();
  private isBallStuck: boolean = false;
  private readonly STUCK_PX = 10; // Kisebb mozgásra is már "stuck"-nak vesszük
  private readonly STUCK_MS = 2000;

  constructor(private gameService: GameService, @Inject(PLATFORM_ID) private platformId: Object) {
    this.gameService.roomState$.subscribe(r => {
      this.currentRoom = r;
      this.runReactiveAiLoop(); // Azonnal futtatjuk az AI-t, ha jön új állapot
    });
    this.gameService.configState$.subscribe(c => this.currentConfig = c);

    if (isPlatformBrowser(this.platformId)) {
      this.loadAiJSON(AiVersion.PerfectStrategy, '/assets/play_perfect_strategy.json');
      this.loadAiJSON(AiVersion.Final1Strategy, '/assets/final1_strategy.json');
      this.loadAiJSON(AiVersion.Elite, '/assets/elite_strategy.json');
    }
  }

  private async loadAiJSON(version: AiVersion, path: string) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP hiba: ${response.status}`);
      this.aiStrategies[version] = await response.json();
    } catch (e) {
      console.error(`[AI BOT] HIBA: Nem sikerült betölteni a ${version} JSON-t (${path}).`, e);
    }
  }

  ngOnDestroy() {
    this.clearBots();
  }

  addBot(roomId: number, team: TeamType, aiVersion: AiVersion) {
    const socket = io('http://localhost:3000', { withCredentials: true, transports: ['polling', 'websocket'] });
    const botId = Math.random().toString(36).substr(2, 9);

    const bot: ManagedBot = { id: botId, socket, playerId: null, team, aiVersion };

    socket.on('connect', () => {
      const botName = `AI_${Math.floor(Math.random() * 1000)}`;
      socket.emit(ClientMessageType.JoinRoom, { username: botName, roomId });
    });

    socket.on(ServerMessageType.ReceiveId, (data: any) => {
      bot.playerId = data.playerId;
      socket.emit(ClientMessageType.PickTeam, { playerId: bot.playerId, team });
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
    this.serverBotAis = {};
  }

  isLocalBot(playerId: number): boolean {
    return this.bots.some(b => b.playerId === playerId);
  }

  getBotAiVersion(playerId: number): AiVersion {
    const localBot = this.bots.find(b => b.playerId === playerId);
    if (localBot) return localBot.aiVersion;
    return this.serverBotAis[playerId] || AiVersion.Default;
  }

  changeBotAi(playerId: number, newVersion: AiVersion) {
    const localBot = this.bots.find(b => b.playerId === playerId);
    if (localBot) {
      localBot.aiVersion = newVersion;
    } else {
      this.serverBotAis[playerId] = newVersion;
    }
  }

  private runReactiveAiLoop() {
    if (!this.currentRoom || !this.currentRoom.isStarted || !this.currentConfig) return;

    const room = this.currentRoom;
    const config = this.currentConfig;

    // Beszorulásgátló
    const ball = room.ball;
    if (Math.hypot(ball.x - this.lastBallPos.x, ball.y - this.lastBallPos.y) > this.STUCK_PX) {
      this.lastBallPos = { x: ball.x, y: ball.y };
      this.ballStuckSince = Date.now();
      this.isBallStuck = false;
    } else if (!this.isBallStuck && Date.now() - this.ballStuckSince >= this.STUCK_MS) {
      this.isBallStuck = true;
    }

    // BOTOK KEZELÉSE
    for (const bot of this.bots) {
      if (bot.playerId === null) continue;
      const player = room.players.find(p => p.id === bot.playerId);
      if (!player) continue;

      const coords: { x: number; y: number }[] = [];
      this.processBotLogic(
        bot.team,
        bot.aiVersion,
        player,
        room,
        config,
        (_charId, ax, ay) => {
          coords.push({ x: ax, y: ay });
        }
      );

      if (coords.length > 0) {
        bot.socket.emit(ClientMessageType.MovementMessage, { coordinates: coords });
      }
    }

    // HUMAN / SERVER AI PLAYERS FIX
    for (const player of room.players) {
      if ((player.isBot || player.name.includes('AI_')) && !this.isLocalBot(player.id)) {
        const aiVersion = this.serverBotAis[player.id] || AiVersion.Default;

        if (aiVersion !== AiVersion.Default) {
          const coords: { x: number; y: number }[] = [];
          this.processBotLogic(
            player.team as any,
            aiVersion,
            player,
            room,
            config,
            (_charId, ax, ay) => {
              coords.push({ x: ax, y: ay });
            }
          );
          if (coords.length > 0) {
            this.gameService.sendMovement(coords);
          }
        }
      }
    }
  }


  private processBotLogic(botTeam: TeamType, aiVersion: AiVersion, player: any, room: Room, config: GameConfigMessage, sendMovementFn: (charId: number, ax: number, ay: number) => void) {
    const ball = room.ball;
    const direction = botTeam === TeamType.Blue ? 1 : -1;
    const characters = [...player.characters];

    if (characters.length === 0) return;

    const strategy = this.aiStrategies[aiVersion];

    if (strategy && strategy.roles) {
      const Kp = strategy.Kp || this.Kp;
      const Kd = strategy.Kd || this.Kd;

      let dynamicChars: any[] = [];

      // ÚJ: Célpontok egyértelmű azonosítása a karakter ID-ja alapján
      let charTargets: { [charId: number]: { x?: number, y?: number, ax?: number, ay?: number } } = {};

      let context: any = {
        Math: Math,
        bx: ball.x,
        by: ball.y,
        bvx: ball.x_velocity ?? 0,
        bvy: ball.y_velocity ?? 0,
        normBx: direction === 1 ? ball.x : config.fieldWidth - ball.x,
        fieldWidth: config.fieldWidth,
        fieldHeight: config.fieldHeight
      };

      const evaluate = (expr: any, ctx: any) => {
        if (typeof expr === 'number') return expr;
        try {
          const keys = Object.keys(ctx);
          const values = Object.values(ctx);
          return new Function(...keys, `return ${expr};`)(...values);
        } catch (e) {
          return 0;
        }
      };

      // 1. Kapusok (Fix pozíciók) hozzárendelése ID alapján
      if (strategy.roles.fixed) {
        for (let i = 0; i < strategy.roles.fixed.length && i < characters.length; i++) {
          charTargets[characters[i].id] = {
            x: evaluate(strategy.roles.fixed[i].x, context),
            y: evaluate(strategy.roles.fixed[i].y, context)
          };
        }
      }

      // 2. Támadók (Dinamikus szerepek) hozzárendelése ID alapján
      const fixedCount = strategy.roles.fixed ? strategy.roles.fixed.length : 0;
      if (strategy.roles.dynamic && characters.length > fixedCount) {

        // Távolság alapú sorbarendezés
        dynamicChars = characters.slice(fixedCount).sort((a, b) => {
          return Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y);
        });

        let activePhase = strategy.roles.dynamic.phases[0];

        for (const phase of strategy.roles.dynamic.phases) {
          if (evaluate(phase.condition, context)) {
            activePhase = phase;
            break;
          }
        }

        if (activePhase) {
          let phaseContext = { ...context };

          if (activePhase.vars) {
            for (const [key, expr] of Object.entries(activePhase.vars)) {
              phaseContext[key] = evaluate(expr, phaseContext);
            }
          }

          // Kiosztjuk a dinamikus célpontokat az épp kiszámolt sorrend alapján, de már ID-hoz kötve!
          for (let i = 0; i < activePhase.targets.length && i < dynamicChars.length; i++) {
            const target = activePhase.targets[i];
            charTargets[dynamicChars[i].id] = {
              x: target.x ? evaluate(target.x, phaseContext) : undefined,
              y: target.y ? evaluate(target.y, phaseContext) : undefined,
              ax: target.ax ? evaluate(target.ax, phaseContext) : undefined,
              ay: target.ay ? evaluate(target.ay, phaseContext) : undefined
            };
          }
        }
      }

      // Ha a labda el van akadva
      if (this.isBallStuck && dynamicChars.length > 0) {
        const normBallX = direction === 1 ? ball.x : config.fieldWidth - ball.x;
        if (normBallX <= config.fieldWidth / 2) {
          // Saját térfél: az alapvonalhoz legközelebbi csatár rohamoz
          const ownGoalX = direction === 1 ? 0 : config.fieldWidth;
          const rusher = [...dynamicChars].sort((a, b) =>
            Math.abs(a.x - ownGoalX) - Math.abs(b.x - ownGoalX)
          )[0];
          charTargets[rusher.id] = { x: ball.x, y: ball.y };
        } else if (aiVersion === AiVersion.Final1Strategy || aiVersion === AiVersion.Elite) {
          const cSide = ball.y < config.fieldHeight / 2 ? -1 : 1;

          if (normBallX > config.fieldWidth - 250) {
            // Ellenfél alapvonalánál ragadt – 3 szerep
            if (dynamicChars.length > 0) {
              // Faltoló: fal és labda közé, nagyon kicsit kapu felé
              charTargets[dynamicChars[0].id] = {
                x: Math.min(config.fieldWidth - 80, normBallX + 25),
                y: cSide === -1 ? Math.max(80, ball.y - 45) : Math.min(config.fieldHeight - 80, ball.y + 45)
              };
            }
            if (dynamicChars.length > 1) {
              // Alapvonali: teljesen az alapvonalon, kapuszög felőli oldalról közelít
              charTargets[dynamicChars[1].id] = {
                x: config.fieldWidth - 65,
                y: Math.max(80, Math.min(config.fieldHeight - 80,
                  cSide === -1
                    ? Math.min(ball.y + 90, config.fieldHeight / 2 - 40)
                    : Math.max(ball.y - 90, config.fieldHeight / 2 + 40)
                ))
              };
            }
            if (dynamicChars.length > 2) {
              // Oszcilláló rohamozó: hátra-előre a kapu felé
              const rusher = dynamicChars[2];
              const rusherNormX = direction === 1 ? rusher.x : config.fieldWidth - rusher.x;
              const BACKUP_DIST = 200;
              const backupNormX = Math.max(config.fieldWidth / 2 + 50, normBallX - BACKUP_DIST);
              const backupRawX = direction === 1 ? backupNormX : config.fieldWidth - backupNormX;
              charTargets[rusher.id] = rusherNormX > normBallX - BACKUP_DIST + 40
                ? { x: backupRawX, y: ball.y }
                : { x: normBallX, y: ball.y };
            }
          } else {
            // Ellen félpálya, nem az alapvonalon – backup-rush
            const rusher = dynamicChars[0];
            const rusherNormX = direction === 1 ? rusher.x : config.fieldWidth - rusher.x;
            const BACKUP_DIST = 180;
            const backupNormX = Math.max(config.fieldWidth / 2 + 50, normBallX - BACKUP_DIST);
            const backupRawX = direction === 1 ? backupNormX : config.fieldWidth - backupNormX;
            const safeY = Math.max(150, Math.min(config.fieldHeight - 150, ball.y));
            charTargets[rusher.id] = rusherNormX > normBallX - BACKUP_DIST + 40
              ? { x: backupRawX, y: safeY }
              : { x: normBallX, y: ball.y };
          }
        } else {
          // Többi stratégia: a labdához legközelebbi rohamoz
          charTargets[dynamicChars[0].id] = { x: ball.x, y: ball.y };
        }
      }

      // 3. Végrehajtás: Minden karakter pontosan a saját parancsát kapja meg az ID-ja alapján
      if (aiVersion === AiVersion.Elite) {
        const ball = room.ball;
        const isRed = botTeam === TeamType.Red;
        const direction = isRed ? -1 : 1;
        const ownGoalX = isRed ? config.fieldWidth : 0;
        const enemyGoalX = isRed ? 0 : config.fieldWidth;
        const centerY = config.fieldHeight / 2;

        // 0. STATE INITIALIZATION
        if (!this.rescueState[player.id]) {
          this.rescueState[player.id] = { phase: 'NONE', startTime: 0, kickerId: null, wallEnterTime: 0 };
        }

        const rs = this.rescueState[player.id];

        // 1. RESCUE STATE HANDLING
        const isNearXWall = ball.x < 120 || ball.x > config.fieldWidth - 120;
        const isNearYWall = ball.y < 120 || ball.y > config.fieldHeight - 120;
        const isBallInCorner = isNearXWall && isNearYWall;

        if (isBallInCorner) {
          if (rs.wallEnterTime === 0) rs.wallEnterTime = Date.now();
          if (Date.now() - rs.wallEnterTime > 1200 && rs.phase === 'NONE') {
            rs.phase = 'PREPARE';
            rs.startTime = Date.now();
            let bestDist = Infinity;
            for (let i = 1; i < characters.length; i++) {
              const d = Math.hypot(characters[i].x - ball.x, characters[i].y - ball.y);
              if (d < bestDist) {
                bestDist = d;
                rs.kickerId = characters[i].id;
              }
            }
            if (rs.kickerId === null) rs.kickerId = characters[0].id;
          }
        } else {
          rs.wallEnterTime = 0;
          rs.phase = 'NONE';
          rs.kickerId = null;
        }

        if (rs.phase !== 'NONE') {
          const elapsed = Date.now() - rs.startTime;
          if (elapsed < 800) rs.phase = 'PREPARE';
          else if (elapsed < 1400) rs.phase = 'STRIKE';
          else rs.startTime = Date.now();
        }

        // 2. CHASER IDENTIFICATION
        let chaserId = characters[0].id;
        let bestScore = Infinity;
        for (let i = 0; i < characters.length; i++) {
          const c = characters[i];
          const dist = Math.hypot(c.x - ball.x, c.y - ball.y);
          const role = ['GK', 'DEF_L', 'DEF_R', 'ATT', 'SUP'][i % 5];
          let weight = (role === 'ATT' || role === 'SUP') ? 0.6 : 1.6;
          if (role === 'GK') weight = dist < 220 ? 0.35 : 12.0;

          if (dist * weight < bestScore) {
            bestScore = dist * weight;
            chaserId = c.id;
          }
        }

        // 3. ROLES & TARGETS
        for (const char of characters) {
          let finalTarget = { x: 0, y: 0 };
          const roleIndex = characters.findIndex(c => c.id === char.id);
          const role = ['GK', 'DEF_L', 'DEF_R', 'ATT', 'SUP'][roleIndex % 5];
          const isChaser = char.id === chaserId;

          if (rs.phase !== 'NONE') {
            if (char.id === rs.kickerId) {
              if (rs.phase === 'PREPARE') {
                const toCenterX = config.fieldWidth / 2 - ball.x;
                const toCenterY = config.fieldHeight / 2 - ball.y;
                const len = Math.hypot(toCenterX, toCenterY) || 1;
                finalTarget = { x: ball.x + (toCenterX / len) * 160, y: ball.y + (toCenterY / len) * 160 };
              } else {
                finalTarget = { x: ball.x, y: ball.y };
              }
            } else {
              const dx = char.x - ball.x;
              const dy = char.y - ball.y;
              const dist = Math.hypot(dx, dy) || 1;
              if (dist < 320) {
                finalTarget = { x: ball.x + (dx / dist) * 450, y: ball.y + (dy / dist) * 450 };
              } else {
                finalTarget = { x: char.x, y: char.y };
              }
            }
          } else if (isChaser) {
            finalTarget = this.getEliteKickTarget(room, config, direction, char);
          } else if (role === 'GK') {
            const distToBall = Math.hypot(char.x - ball.x, char.y - ball.y);
            const isBallDangerous = ball.y > config.goalMinY - 120 && ball.y < config.goalMaxY + 120;
            const isBallOwnHalf = isRed ? ball.x > config.fieldWidth * 0.6 : ball.x < config.fieldWidth * 0.4;

            if (distToBall < 280 && isBallDangerous && isBallOwnHalf) {
              finalTarget = { x: ball.x, y: ball.y };
            } else {
              const goalX = ownGoalX + direction * 65;
              const goalY = Math.max(config.goalMinY + 40, Math.min(config.goalMaxY - 40, ball.y));
              finalTarget = { x: goalX, y: goalY };
            }
          } else if (role.startsWith('DEF')) {
            const side = role === 'DEF_L' ? -1 : 1;
            const isBallOnOurHalf = isRed ? ball.x > config.fieldWidth * 0.45 : ball.x < config.fieldWidth * 0.55;
            const distToBall = Math.hypot(char.x - ball.x, char.y - ball.y);

            if (isBallOnOurHalf && distToBall < 350) {
              finalTarget = this.getEliteKickTarget(room, config, direction, char);
            } else {
              const angle = side * 0.55;
              finalTarget = {
                x: ownGoalX + direction * Math.cos(angle) * 450,
                y: centerY + Math.sin(angle) * 450
              };
            }
          } else {
            const side = role === 'ATT' ? -1 : 1;
            finalTarget = { x: enemyGoalX - direction * 650, y: ball.y + side * 180 };
          }

          const steering = this.applyEliteSteering(char, finalTarget, characters, ball, isChaser || char.id === rs.kickerId);
          sendMovementFn(char.id, steering.ax, steering.ay);
        }
        return;
      }

      // Legacy support for other versions
      for (const char of characters) {
        let ax = 0;
        let ay = 0;

        let target = charTargets[char.id];
        if (!target) {
          sendMovementFn(char.id, 0, 0);
          continue;
        }

        if (target.ax !== undefined && target.ay !== undefined) {
          sendMovementFn(char.id, target.ax, target.ay);
          continue;
        }

        let tX = target.x!;
        let tY = target.y!;
        let finalX = direction === 1 ? tX : config.fieldWidth - tX;
        finalX = Math.max(40, Math.min(config.fieldWidth - 40, finalX));
        let finalY = Math.max(40, Math.min(config.fieldHeight - 40, tY));

        const rawAx = Kp * (finalX - char.x) - Kd * char.x_velocity;
        const rawAy = Kp * (finalY - char.y) - Kd * char.y_velocity;
        ax = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAx));
        ay = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAy));

        sendMovementFn(char.id, ax, ay);
      }
      return;
    }

    const moveChar = (character: any, targetX: number, targetY: number) => {
      const rawAx = this.Kp * (targetX - character.x) - this.Kd * character.x_velocity;
      const rawAy = this.Kp * (targetY - character.y) - this.Kd * character.y_velocity;
      const ax = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAx));
      const ay = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAy));
      sendMovementFn(character.id, ax, ay);
    };

    const centerX = config.fieldWidth / 2;
    const centerY = config.fieldHeight / 2;
    const wallMargin = config.playerRadius + config.ballRadius + 30;
    const nearLeftWall = ball.x <= wallMargin;
    const nearRightWall = ball.x >= config.fieldWidth - wallMargin;
    const nearTopWall = ball.y <= wallMargin;
    const nearBottomWall = ball.y >= config.fieldHeight - wallMargin;
    const cornerTrap = (nearLeftWall || nearRightWall) && (nearTopWall || nearBottomWall);

    for (const char of characters) {
      let targetX = ball.x;
      let targetY = ball.y;

      if (cornerTrap) {
        targetX = ball.x + (centerX - ball.x) * 0.45;
        targetY = ball.y + (centerY - ball.y) * 0.45;
      } else {
        if (nearLeftWall || nearRightWall) targetY = ball.y + Math.sign(centerY - ball.y) * 80;
        if (nearTopWall || nearBottomWall) targetX = ball.x + Math.sign(centerX - ball.x) * 80;
      }

      targetX = Math.max(config.playerRadius, Math.min(config.fieldWidth - config.playerRadius, targetX));
      targetY = Math.max(config.playerRadius, Math.min(config.fieldHeight - config.playerRadius, targetY));

      const dist = Math.hypot(targetX - char.x, targetY - char.y);
      if (dist > 30) moveChar(char, targetX, targetY);
    }
  }

  private getEliteKickTarget(room: Room, config: GameConfigMessage, direction: number, char: any): { x: number, y: number } {
    const ball = room.ball;
    const MAX_SPEED = 50;
    const FRICTION = 0.98;

    // --- ACCURATE INTERCEPTION LOGIC ---
    const bvx = ball.x_velocity || 0;
    const bvy = ball.y_velocity || 0;

    let bestT = 0;
    let minDistAtT = Infinity;

    // We simulate up to 40 ticks to find the best meeting point
    for (let t = 1; t <= 40; t++) {
      // Friction-aware ball position: P(t) = P(0) + V(0) * (1 - friction^t) / (1 - friction)
      const multiplier = (1 - Math.pow(FRICTION, t)) / (1 - FRICTION);
      const predX = ball.x + bvx * multiplier;
      const predY = ball.y + bvy * multiplier;

      const distBotMustTravel = Math.hypot(predX - char.x, predY - char.y);
      const maxDistBotCanTravel = MAX_SPEED * t;

      if (maxDistBotCanTravel >= distBotMustTravel + 40) { // +40 for safety
        bestT = t;
        break;
      }
      
      if (distBotMustTravel - maxDistBotCanTravel < minDistAtT) {
        minDistAtT = distBotMustTravel - maxDistBotCanTravel;
        bestT = t;
      }
    }

    const multiplier = (1 - Math.pow(FRICTION, bestT)) / (1 - FRICTION);
    const predX = ball.x + bvx * multiplier;
    const predY = ball.y + bvy * multiplier;

    // --- SNIPER LOGIC ---
    const enemyGoalX = direction === 1 ? config.fieldWidth : 0;
    const targetGoalY = ball.y < config.fieldHeight / 2 ? config.goalMaxY - 30 : config.goalMinY + 30;

    let shotDx = enemyGoalX - predX;
    let shotDy = targetGoalY - predY;
    const shotDist = Math.hypot(shotDx, shotDy) || 1;
    shotDx /= shotDist;
    shotDy /= shotDist;

    // Approach point behind the ball relative to the goal
    let approachX = predX - shotDx * 85;
    let approachY = predY - shotDy * 85;

    // Wall correction
    if (predX < 110 || predX > config.fieldWidth - 110 || predY < 110 || predY > config.fieldHeight - 110) {
      const toCenterX = config.fieldWidth / 2 - predX;
      const toCenterY = config.fieldHeight / 2 - predY;
      const distToCenter = Math.hypot(toCenterX, toCenterY) || 1;
      approachX = predX - (toCenterX / distToCenter) * 115;
      approachY = predY - (toCenterY / distToCenter) * 115;
    }

    const distToBall = Math.hypot(char.x - ball.x, char.y - ball.y);
    if (distToBall < 110) {
      // Strike through the ball
      return { x: predX + shotDx * 200, y: predY + shotDy * 200 };
    } else {
      return { x: approachX, y: approachY };
    }
  }

  private applyEliteSteering(char: any, target: { x: number, y: number }, teammates: any[], _ball: any, isActive: boolean): { ax: number, ay: number } {
    const MAX_SPEED = 50;
    const MAX_ACCEL = 10;
    
    const dx = target.x - char.x;
    const dy = target.y - char.y;
    const dist = Math.hypot(dx, dy) || 1;

    // 1. DESIRED VELOCITY
    let desiredSpeed = MAX_SPEED;
    if (!isActive && dist < 150) {
      desiredSpeed = MAX_SPEED * (dist / 150);
    }

    let desiredVx = (dx / dist) * desiredSpeed;
    let desiredVy = (dy / dist) * desiredSpeed;

    // 2. AGGRESSIVE SEPARATION (Only for non-active)
    if (!isActive) {
      for (const other of teammates) {
        if (other.id === char.id) continue;
        const ox = char.x - other.x;
        const oy = char.y - other.y;
        const d = Math.hypot(ox, oy);
        if (d > 0 && d < 140) {
          const push = (140 - d) / 140;
          desiredVx += (ox / d) * MAX_SPEED * push * 2.5;
          desiredVy += (oy / d) * MAX_SPEED * push * 2.5;
        }
      }
    }

    // 3. VELOCITY MATCHING
    let steerX = (desiredVx - char.x_velocity) * 1.5;
    let steerY = (desiredVy - char.y_velocity) * 1.5;

    const steerLen = Math.hypot(steerX, steerY) || 1;
    if (steerLen > MAX_ACCEL) {
      steerX = (steerX / steerLen) * MAX_ACCEL;
      steerY = (steerY / steerLen) * MAX_ACCEL;
    }

    return { ax: steerX, ay: steerY };
  }

}