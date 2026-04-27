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
  private loopInterval: any;
  private rescueState: { [playerId: number]: { 
    phase: 'NONE' | 'PREPARE' | 'STRIKE', 
    startTime: number, 
    kickerId: number | null,
    wallEnterTime: number 
  } } = {};
  private godState: { [playerId: number]: {
    lastKickTime: number,
    targetCorner: number, // 1 or -1
    interceptT: number
  } } = {};

  private aiStrategies: { [key: string]: any } = {};
  private rlBrain: any = null;

  private readonly Kp = 0.3;
  private readonly Kd = 0.4;
  private readonly MAX_ACCEL = 10;

  private lastBallPos: { x: number; y: number } = { x: -1, y: -1 };
  private ballStuckSince: number = Date.now();
  private isBallStuck: boolean = false;
  private readonly STUCK_PX = 10; // Kisebb mozgásra is már "stuck"-nak vesszük
  private readonly STUCK_MS = 2000;

  private readonly RL_OPP_GOAL = [0, 500];
  private readonly RL_OWN_GOAL = [2000, 500];

  constructor(private gameService: GameService, @Inject(PLATFORM_ID) private platformId: Object) {
    this.gameService.roomState$.subscribe(r => {
      this.currentRoom = r;
      this.runReactiveAiLoop(); // Azonnal futtatjuk az AI-t, ha jön új állapot
    });
    this.gameService.configState$.subscribe(c => this.currentConfig = c);

    if (isPlatformBrowser(this.platformId)) {
      this.loadAiJSON(AiVersion.PerfectStrategy, '/assets/play_perfect_strategy.json');
      this.loadAiJSON(AiVersion.HybridStrategy, '/assets/hybrid_strategy.json');
      this.loadAiJSON(AiVersion.HybridV2Strategy, '/assets/hybrid_strategy_v2.json');
      this.loadAiJSON(AiVersion.HybridV3Strategy, '/assets/hybrid_strategy_v3.json');
      this.loadAiJSON(AiVersion.Final1Strategy, '/assets/final1_strategy.json');
      this.loadAiJSON(AiVersion.Elite, '/assets/elite_strategy.json');
      this.loadRLBrain('/assets/ai_brain.json');
      // A startAiLoop() hívást eltávolítjuk, mert átállunk reaktív módra
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

  private async loadRLBrain(path: string) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP hiba: ${response.status}`);
      this.rlBrain = await response.json();
    } catch (e) {
      console.error(`[AI BOT] HIBA: Nem sikerült betölteni az RL Brain-t (${path}).`, e);
    }
  }

  ngOnDestroy() {
    if (this.loopInterval) clearInterval(this.loopInterval);
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
        (charId, ax, ay) => {
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
            (charId, ax, ay) => {
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

  // A régi startAiLoop-ot törölhetjük
  private startAiLoop() {}

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

        let rlCache: { [charId: number]: { ax: number, ay: number } } = {};

        context.rl_ax = (charIndex: number) => {
          const char = dynamicChars[charIndex];
          if (!char) return 0;
          if (!rlCache[char.id]) rlCache[char.id] = this.getRlAccel(char, ball, direction);
          return rlCache[char.id].ax;
        };

        context.rl_ay = (charIndex: number) => {
          const char = dynamicChars[charIndex];
          if (!char) return 0;
          if (!rlCache[char.id]) rlCache[char.id] = this.getRlAccel(char, ball, direction);
          return rlCache[char.id].ay;
        };

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
      if (aiVersion === AiVersion.Elite || aiVersion === AiVersion.GodTier) {
        const ball = room.ball;
        const isRed = botTeam === TeamType.Red;
        const direction = isRed ? -1 : 1;
        const ownGoalX = isRed ? config.fieldWidth : 0;
        const enemyGoalX = isRed ? 0 : config.fieldWidth;
        const centerY = config.fieldHeight / 2;
        const isGod = aiVersion === AiVersion.GodTier;

        // 0. STATE INITIALIZATION
        if (!this.rescueState[player.id]) {
          this.rescueState[player.id] = { phase: 'NONE', startTime: 0, kickerId: null, wallEnterTime: 0 };
        }
        if (isGod && !this.godState[player.id]) {
          this.godState[player.id] = { lastKickTime: 0, targetCorner: 1, interceptT: 0 };
        }

        const rs = this.rescueState[player.id];
        const gs = isGod ? this.godState[player.id] : null;

        // 1. RESCUE STATE HANDLING
        const wallLimit = isGod ? 100 : 120;
        const isNearXWall = ball.x < wallLimit || ball.x > config.fieldWidth - wallLimit;
        const isNearYWall = ball.y < wallLimit || ball.y > config.fieldHeight - wallLimit;
        const isBallInCorner = isNearXWall && isNearYWall;

        if (isBallInCorner) {
          if (rs.wallEnterTime === 0) rs.wallEnterTime = Date.now();
          if (Date.now() - rs.wallEnterTime > (isGod ? 800 : 1200) && rs.phase === 'NONE') {
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
          if (elapsed < (isGod ? 500 : 800)) rs.phase = 'PREPARE';
          else if (elapsed < (isGod ? 1000 : 1400)) rs.phase = 'STRIKE';
          else rs.startTime = Date.now();
        }

        // 1.1 ENEMY AWARENESS (GodTier only)
        let enemyInCorner = false;
        if (isGod && isBallInCorner) {
          for (const p of room.players) {
            if (p.team !== botTeam) {
              for (const ec of p.characters) {
                if (Math.hypot(ec.x - ball.x, ec.y - ball.y) < 150) {
                  enemyInCorner = true;
                  break;
                }
              }
            }
            if (enemyInCorner) break;
          }
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
                finalTarget = { x: ball.x + (toCenterX / len) * (isGod ? 170 : 160), y: ball.y + (toCenterY / len) * (isGod ? 170 : 160) };
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
            if (isGod && enemyInCorner && rs.phase === 'NONE') {
              // TACTICAL PATIENCE: Don't rush into a trapped enemy. Block the exit instead.
              const toCenterX = config.fieldWidth / 2 - ball.x;
              const toCenterY = config.fieldHeight / 2 - ball.y;
              const len = Math.hypot(toCenterX, toCenterY) || 1;
              finalTarget = { x: ball.x + (toCenterX / len) * 280, y: ball.y + (toCenterY / len) * 280 };
            } else {
              finalTarget = isGod ? this.getGodKickTarget(room, config, direction, char, gs!) : this.getEliteKickTarget(room, config, direction, char);
            }
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

            if (isBallOnOurHalf && distToBall < (isGod ? 400 : 350)) {
               finalTarget = isGod ? this.getGodKickTarget(room, config, direction, char, gs!) : this.getEliteKickTarget(room, config, direction, char); 
            } else {
               const angle = side * 0.55;
               const radius = isGod ? 550 : 450;
               finalTarget = { 
                 x: ownGoalX + direction * Math.cos(angle) * radius, 
                 y: centerY + Math.sin(angle) * radius 
               };
            }
          } else {
            const side = role === 'ATT' ? -1 : 1;
            const isAggressive = isGod && (isRed ? ball.x < config.fieldWidth * 0.4 : ball.x > config.fieldWidth * 0.6);
            const attLineX = isAggressive ? (enemyGoalX - direction * 350) : (enemyGoalX - direction * 650);
            finalTarget = { x: attLineX, y: ball.y + side * 180 };
          }

          const steering = isGod 
            ? this.applyGodSteering(char, finalTarget, characters, isChaser || char.id === rs.kickerId)
            : this.applyEliteSteering(char, finalTarget, characters, ball, aiVersion, isChaser || char.id === rs.kickerId);
          
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

    // Default 5v5 és Basic AI...
    const defendX = botTeam === TeamType.Blue ? 50 : config.fieldWidth - 50;

    const moveChar = (character: any, targetX: number, targetY: number) => {
      const rawAx = this.Kp * (targetX - character.x) - this.Kd * character.x_velocity;
      const rawAy = this.Kp * (targetY - character.y) - this.Kd * character.y_velocity;
      const ax = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAx));
      const ay = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAy));
      sendMovementFn(character.id, ax, ay);
    };

    if (aiVersion === AiVersion.Brain5v5) {
      if (characters[0]) moveChar(characters[0], defendX, config.fieldHeight / 2);
      if (characters[1]) moveChar(characters[1], defendX + (direction * 150), ball.y - 100);
      if (characters[2]) moveChar(characters[2], defendX + (direction * 150), ball.y + 100);
      if (characters[3]) moveChar(characters[3], ball.x, ball.y);
      if (characters[4]) moveChar(characters[4], ball.x + (direction * 100), config.fieldHeight / 2);
      return;
    }

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

  // =====================================================================
  // VISSZAÁLLÍTOTT RÉGI AI LOGIKA (Tükrözés támogatással mindkét oldalra)
  // =====================================================================

  private getRlAccel(char: any, ball: any, direction: number): { ax: number, ay: number } {
    const isMirrored = (direction === 1);

    const v_char = {
      x: isMirrored ? 2000 - char.x : char.x,
      y: char.y,
      x_velocity: isMirrored ? -char.x_velocity : char.x_velocity,
      y_velocity: char.y_velocity
    };

    const v_ball = {
      x: isMirrored ? 2000 - ball.x : ball.x,
      y: ball.y,
      x_velocity: isMirrored ? -ball.x_velocity : ball.x_velocity,
      y_velocity: ball.y_velocity
    };

    const state = this.calculate5DState(v_char, v_ball);
    const action = this.getBestAction(state);
    const rawAccel = this.getAccelerationFromAction(action, v_char, v_ball);

    return {
      ax: isMirrored ? -rawAccel.ax : rawAccel.ax,
      ay: rawAccel.ay
    };
  }

  private calculate5DState(playerData: any, ballData: any): number[] {
    const p = [playerData.x, playerData.y];
    const b = [ballData.x, ballData.y];
    const bv = [ballData.x_velocity ?? 0, ballData.y_velocity ?? 0];

    const d_vec = this.sub(b, p);
    const raw_dist = this.norm(d_vec);
    const dist = Math.min(raw_dist, 1000);

    const pb = d_vec;
    const bg = this.sub(this.RL_OPP_GOAL, b);
    const attack_angle = Math.atan2(pb[0] * bg[1] - pb[1] * bg[0], pb[0] * bg[0] + pb[1] * bg[1]);

    const bo = this.sub(this.RL_OWN_GOAL, b);
    const bp = this.sub(p, b);
    const defense_angle = Math.atan2(bo[0] * bp[1] - bo[1] * bp[0], bo[0] * bp[0] + bo[1] * bp[1]);

    const ball_speed = Math.min(this.norm(bv), 50);

    let ball_x_norm = (1000 - b[0]) / 1000;
    ball_x_norm = Math.max(-1, Math.min(1, ball_x_norm));

    return [dist, attack_angle, defense_angle, ball_speed, ball_x_norm];
  }

  private getBestAction(currentState: number[]): number {
    if (!this.rlBrain || !this.rlBrain.rules_action) return 1;

    let index = 0;
    let multiplier = 1;

    for (let d = 0; d < 5; d++) {
      const val = currentState[d];
      const min = this.rlBrain.grid_min[d];
      const step = this.rlBrain.grid_step[d];
      const n = this.rlBrain.grid_n[d];
      const isCirc = this.rlBrain.is_circular[d];

      let coord = (val - min) / step;

      if (isCirc) {
        coord = coord % n;
        if (coord < 0) coord += n;
      } else {
        coord = Math.max(0, Math.min(n - 1, coord));
      }

      let safeIdx = Math.round(coord);
      if (isCirc) {
        safeIdx = safeIdx % n;
      } else {
        safeIdx = Math.max(0, Math.min(n - 1, safeIdx));
      }

      index += safeIdx * multiplier;
      multiplier *= n;
    }

    if (index >= this.rlBrain.rules_action.length || index < 0) return 1;
    return this.rlBrain.rules_action[index];
  }

  private getAccelerationFromAction(actionId: number, playerData: any, ballData: any): { ax: number, ay: number } {
    const player = [playerData.x, playerData.y];
    const ball = [ballData.x, ballData.y];
    const v_player = [playerData.x_velocity ?? 0, playerData.y_velocity ?? 0];
    const ball_v = [ballData.x_velocity ?? 0, ballData.y_velocity ?? 0];

    let ax = 0, ay = 0;
    const speed = this.norm(v_player);

    switch (actionId) {
      case 1:
      case 2: {
        const to_ball = this.sub(ball, player);
        const to_own = this.sub(this.RL_OWN_GOAL, ball);
        const bn = this.norm(to_ball);
        const tn = this.norm(to_own);

        const push_cos = (bn > 1e-6 && tn > 1e-6) ? this.dot(to_ball, to_own) / (bn * tn) : -1;

        if (push_cos > 0.1 && bn > 60) {
          let from_opp = this.sub(ball, this.RL_OPP_GOAL);
          from_opp = this.scale(from_opp, 1 / Math.max(1e-6, this.norm(from_opp)));

          let side = Math.sign(500 - player[1]);
          if (side === 0) side = 1;
          const perp = [-from_opp[1] * side, from_opp[0] * side];

          const target = this.add(this.add(ball, this.scale(from_opp, 80)), this.scale(perp, 50));
          let dir = this.sub(target, player);
          const dn = this.norm(dir);
          dir = dn > 1e-6 ? this.scale(dir, 1 / dn) : [0, 0];

          ax = dir[0] * this.MAX_ACCEL;
          ay = dir[1] * this.MAX_ACCEL;
        } else {
          let dir = bn > 1e-6 ? this.scale(to_ball, 1 / bn) : [0, 0];
          ax = dir[0] * this.MAX_ACCEL;
          ay = dir[1] * this.MAX_ACCEL;
        }
        break;
      }

      case 3: {
        let t_opt = 5;
        for (let t = 5; t <= 40; t += 5) {
          const B_pred = this.add(ball, this.scale(ball_v, (1 - Math.pow(0.98, t)) / (1 - 0.98)));
          const shoot_tgt = ball[1] > 500 ? [0, 420] : [0, 580];
          let dir_to_tgt = this.sub(shoot_tgt, B_pred);
          dir_to_tgt = this.scale(dir_to_tgt, 1 / Math.max(1e-6, this.norm(dir_to_tgt)));

          const P_contact = this.sub(B_pred, this.scale(dir_to_tgt, 60));
          if (this.norm(this.sub(P_contact, player)) < 20 * t) {
            t_opt = t;
            break;
          }
        }

        const B_pred = this.add(ball, this.scale(ball_v, (1 - Math.pow(0.98, t_opt)) / (1 - 0.98)));
        const shoot_tgt = ball[1] > 500 ? [0, 420] : [0, 580];
        const btg = this.sub(shoot_tgt, B_pred);
        const btg_dir = this.scale(btg, 1 / Math.max(1e-6, this.norm(btg)));

        const aim_pt = this.add(B_pred, this.scale(btg_dir, 500));
        let dir = this.sub(aim_pt, player);
        const dn = this.norm(dir);
        dir = dn > 1e-6 ? this.scale(dir, 1 / dn) : btg_dir;

        ax = dir[0] * this.MAX_ACCEL;
        ay = dir[1] * this.MAX_ACCEL;
        break;
      }

      case 4: {
        const T_LOOK = Math.max(2, Math.min(10, this.norm(this.sub(this.RL_OWN_GOAL, ball)) / 100));
        const B_pred = this.add(ball, this.scale(ball_v, (1 - Math.pow(0.98, T_LOOK)) / (1 - 0.98)));
        B_pred[0] = Math.max(20, Math.min(1980, B_pred[0]));
        B_pred[1] = Math.max(20, Math.min(980, B_pred[1]));

        const POST_TOP = [2000, 400];
        const POST_BOT = [2000, 600];
        const v_top = this.sub(POST_TOP, B_pred);
        const v_bot = this.sub(POST_BOT, B_pred);
        const ang_top = Math.atan2(v_top[1], v_top[0]);
        const ang_bot = Math.atan2(v_bot[1], v_bot[0]);

        let cone_angle = Math.abs(ang_top - ang_bot);
        if (cone_angle > Math.PI) cone_angle = 2 * Math.PI - cone_angle;
        const cone_half = cone_angle / 2;

        let opt_d = 50 / Math.max(0.1, Math.sin(cone_half));
        const dist_to_goal = this.norm(this.sub(this.RL_OWN_GOAL, B_pred));
        opt_d = Math.min(opt_d, dist_to_goal - 60, 200);
        opt_d = Math.max(opt_d, 60);

        const btg = this.sub(this.RL_OWN_GOAL, B_pred);
        const btg_dir = this.scale(btg, 1 / Math.max(1e-6, this.norm(btg)));
        const target = this.add(B_pred, this.scale(btg_dir, opt_d));
        target[0] = Math.max(50, Math.min(1950, target[0]));
        target[1] = Math.max(50, Math.min(950, target[1]));

        const err = this.sub(target, player);
        const err_dist = this.norm(err);
        let f_tot = [0, 0];

        if (err_dist > 1e-6) {
          const req_accel = this.scale(err, this.MAX_ACCEL / err_dist);
          const feedforward = this.scale(ball_v, 0.4);
          const damping = (err_dist < 40) ? this.scale(v_player, -0.3) : this.scale(v_player, -0.05);
          f_tot = this.add(this.add(req_accel, feedforward), damping);
        } else {
          f_tot = this.scale(v_player, -0.3);
        }

        const fn = this.norm(f_tot);
        if (fn > this.MAX_ACCEL) f_tot = this.scale(f_tot, this.MAX_ACCEL / fn);
        ax = f_tot[0];
        ay = f_tot[1];

        if (this.norm(this.sub(ball, player)) < 85) {
          ax = -this.MAX_ACCEL;
          ay = 0;
          if (Math.abs(ball[1] - 500) > 40) ay = Math.sign(ball[1] - 500) * this.MAX_ACCEL;
        }
        break;
      }

      case 5: {
        if (speed > 1) {
          ax = -v_player[0] / speed * this.MAX_ACCEL;
          ay = -v_player[1] / speed * this.MAX_ACCEL;
        }
        break;
      }

      case 6: {
        let clear_dir = this.sub(ball, this.RL_OWN_GOAL);
        clear_dir = this.scale(clear_dir, 1 / Math.max(1e-6, this.norm(clear_dir)));
        const side_dir = ball[1] > 500 ? [0.5, 1] : [0.5, -1];

        let dir = this.add(clear_dir, side_dir);
        dir = this.scale(dir, 1 / this.norm(dir));
        ax = dir[0] * this.MAX_ACCEL;
        ay = dir[1] * this.MAX_ACCEL;
        break;
      }
    }

    ax = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, ax));
    ay = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, ay));

    return { ax, ay };
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

  private applyEliteSteering(char: any, target: { x: number, y: number }, teammates: any[], ball: any, aiVersion: AiVersion, isActive: boolean): { ax: number, ay: number } {
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

  // =====================================================================
  // GOD-TIER AI HELPER METHODS
  // =====================================================================

  private getGodKickTarget(room: Room, config: GameConfigMessage, direction: number, char: any, gs: any): { x: number, y: number } {
    const ball = room.ball;
    const MAX_SPEED = 50;
    const FRICTION = 0.98;

    // 1. ADVANCED INTERCEPTION
    const bvx = ball.x_velocity || 0;
    const bvy = ball.y_velocity || 0;
    let bestT = 1;
    let minD = Infinity;

    for (let t = 1; t <= 50; t++) {
      const mult = (1 - Math.pow(FRICTION, t)) / (1 - FRICTION);
      const px = ball.x + bvx * mult;
      const py = ball.y + bvy * mult;

      const dBot = Math.hypot(px - char.x, py - char.y);
      const dMax = MAX_SPEED * t;

      if (dMax >= dBot + 30) {
        bestT = t;
        break;
      }
      if (dBot - dMax < minD) {
        minD = dBot - dMax;
        bestT = t;
      }
    }

    const mult = (1 - Math.pow(FRICTION, bestT)) / (1 - FRICTION);
    const predX = ball.x + bvx * mult;
    const predY = ball.y + bvy * mult;

    // 2. SNIPER LOGIC (Aim for corners)
    const enemyGoalX = direction === 1 ? config.fieldWidth : 0;
    
    // Choose corner that is furthest from enemy goalkeeper
    let enemyGK = room.players.find(p => (direction === 1 ? p.team === TeamType.Red : p.team === TeamType.Blue))?.characters[0];
    if (enemyGK) {
       gs.targetCorner = enemyGK.y > config.fieldHeight / 2 ? -1 : 1;
    } else {
       gs.targetCorner = ball.y > config.fieldHeight / 2 ? -1 : 1;
    }

    const targetY = config.fieldHeight / 2 + gs.targetCorner * (config.goalMaxY - config.goalMinY) * 0.45;

    let shotDx = enemyGoalX - predX;
    let shotDy = targetY - predY;
    const shotDist = Math.hypot(shotDx, shotDy) || 1;
    shotDx /= shotDist;
    shotDy /= shotDist;

    // 3. APPROACH & STRIKE with Wall-Awareness
    const distToBall = Math.hypot(char.x - ball.x, char.y - ball.y);
    if (distToBall < 100) {
      // Powerful follow-through
      return { x: predX + shotDx * 350, y: predY + shotDy * 350 };
    } else {
      // Precise approach
      let appX = predX - shotDx * 98;
      let appY = predY - shotDy * 98;

      // Anti-Wall Logic: If ball is near wall, approach from the wall side
      const wallLimit = 85;
      if (predY < wallLimit) appY = Math.min(appY, predY - 40);
      if (predY > config.fieldHeight - wallLimit) appY = Math.max(appY, predY + 40);
      if (predX < wallLimit && direction === -1) appX = Math.min(appX, predX - 40);
      if (predX > config.fieldWidth - wallLimit && direction === 1) appX = Math.max(appX, predX + 40);

      // Final wall-clamping to prevent bots from going out of bounds
      appX = Math.max(30, Math.min(config.fieldWidth - 30, appX));
      appY = Math.max(30, Math.min(config.fieldHeight - 30, appY));

      return { x: appX, y: appY };
    }
  }

  private applyGodSteering(char: any, target: { x: number, y: number }, teammates: any[], isActive: boolean): { ax: number, ay: number } {
    const MAX_SPEED = 50;
    const MAX_ACCEL = 10;
    
    const dx = target.x - char.x;
    const dy = target.y - char.y;
    const dist = Math.hypot(dx, dy) || 1;

    // 1. DESIRED VELOCITY with Anti-Overshoot
    let speed = MAX_SPEED;
    if (!isActive && dist < 180) {
      speed = MAX_SPEED * (dist / 180);
    }
    
    let dVx = (dx / dist) * speed;
    let dVy = (dy / dist) * speed;

    // 2. SMART SEPARATION
    if (!isActive) {
      for (const other of teammates) {
        if (other.id === char.id) continue;
        const ox = char.x - other.x;
        const oy = char.y - other.y;
        const d = Math.hypot(ox, oy);
        if (d > 0 && d < 150) {
          const push = Math.pow((150 - d) / 150, 1.5);
          dVx += (ox / d) * MAX_SPEED * push * 3.0;
          dVy += (oy / d) * MAX_SPEED * push * 3.0;
        }
      }
    }

    // 3. HIGH-GAIN MOMENTUM COMPENSATION
    // We try to kill current velocity that is NOT in the desired direction
    let steerX = (dVx - char.x_velocity) * 2.2;
    let steerY = (dVy - char.y_velocity) * 2.2;

    const sLen = Math.hypot(steerX, steerY) || 1;
    if (sLen > MAX_ACCEL) {
      steerX = (steerX / sLen) * MAX_ACCEL;
      steerY = (steerY / sLen) * MAX_ACCEL;
    }

    return { ax: steerX, ay: steerY };
  }

  private add(a: number[], b: number[]): number[] { return [a[0] + b[0], a[1] + b[1]]; }
  private sub(a: number[], b: number[]): number[] { return [a[0] - b[0], a[1] - b[1]]; }
  private scale(a: number[], scalar: number): number[] { return [a[0] * scalar, a[1] * scalar]; }
  private dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1]; }
  private norm(a: number[]): number { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
}