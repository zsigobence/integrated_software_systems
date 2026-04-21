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
  
  private aiStrategies: { [key: string]: any } = {};
  private rlBrain: any = null; 

  private readonly Kp = 0.3;
  private readonly Kd = 0.4;
  private readonly MAX_ACCEL = 10;
  
  private readonly RL_OPP_GOAL = [0, 500];   
  private readonly RL_OWN_GOAL = [2000, 500]; 

  constructor(private gameService: GameService, @Inject(PLATFORM_ID) private platformId: Object) {
    this.gameService.roomState$.subscribe(r => this.currentRoom = r);
    this.gameService.configState$.subscribe(c => this.currentConfig = c);

    if (isPlatformBrowser(this.platformId)) {
      this.loadAiJSON(AiVersion.PerfectStrategy, '/assets/play_perfect_strategy.json');
      this.loadAiJSON(AiVersion.HybridStrategy, '/assets/hybrid_strategy.json');
      this.loadAiJSON(AiVersion.HybridV2Strategy, '/assets/hybrid_strategy_v2.json');
      this.loadAiJSON(AiVersion.HybridV3Strategy, '/assets/hybrid_strategy_v3.json');
      this.loadRLBrain('/assets/ai_brain.json');
      this.startAiLoop();
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

  private startAiLoop() {
    this.loopInterval = setInterval(() => {
      if (!this.currentRoom || !this.currentRoom.isStarted || !this.currentConfig) return;
  
      const room = this.currentRoom;
      const config = this.currentConfig;
  
      // 👉 Botonként gyűjtjük a koordinátákat
      const botCoordinatesMap = new Map<string, { x: number; y: number }[]>();
  
      // =========================
      // BOTOK KEZELÉSE
      // =========================
      for (const bot of this.bots) {
        if (bot.playerId === null) continue;
        if (!bot.socket.id) continue; // ✅ TypeScript fix
  
        const socketId = bot.socket.id;
  
        const player = room.players.find(p => p.id === bot.playerId);
        if (!player) continue;
  
        // inicializáljuk a koordináta listát
        botCoordinatesMap.set(socketId, []);
  
        this.processBotLogic(
          bot.team,
          bot.aiVersion,
          player,
          room,
          config,
          (charId, ax, ay) => {
            const coords = botCoordinatesMap.get(socketId);
            if (!coords) return;
  
            coords.push({ x: ax, y: ay });
          }
        );
      }
  
      // =========================
      // EMIT BOTONKÉNT (1 emit / bot)
      // =========================
      for (const bot of this.bots) {
        if (bot.playerId === null) continue;
        if (!bot.socket.id) continue; // ✅ TypeScript fix
  
        const socketId = bot.socket.id;
  
        const coords = botCoordinatesMap.get(socketId);
  
        if (!coords || coords.length === 0) continue;
  
        bot.socket.emit(ClientMessageType.MovementMessage, {
          coordinates: coords
        });
      }
  
      // =========================
      // HUMAN / SERVER AI PLAYERS
      // (eredeti logika megtartva)
      // =========================
      for (const player of room.players) {
        if ((player.isBot || player.name.includes('AI_')) && !this.isLocalBot(player.id)) {
          const aiVersion = this.serverBotAis[player.id] || AiVersion.Default;
  
          if (aiVersion !== AiVersion.Default) {
            this.processBotLogic(
              player.team as any,
              aiVersion,
              player,
              room,
              config,
              (charId, ax, ay) => {
                this.gameService.sendMovement([{ x: ax, y: ay }]);
              }
            );
          }
        }
      }
  
    }, 33);
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
      let charTargets: {[charId: number]: {x?: number, y?: number, ax?: number, ay?: number}} = {};

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

        let rlCache: {[charId: number]: {ax: number, ay: number}} = {};

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

      // 3. Végrehajtás: Minden karakter pontosan a saját parancsát kapja meg az ID-ja alapján
      for (const char of characters) {
        const target = charTargets[char.id];

        // Ha valamiért nem kapott parancsot (pl. kevesebb a célpont, mint a játékos)
        if (!target) {
            sendMovementFn(char.id, 0, 0);
            continue;
        }

        // Ha direkt RL gyorsulás jött (Hybrid stratégia támadói)
        if (target.ax !== undefined && target.ay !== undefined) {
            sendMovementFn(char.id, target.ax, target.ay);
            continue;
        }

        // Ha X, Y koordináta jött (Perfect stratégia, vagy kapusok)
        let tX = target.x!;
        let tY = target.y!;
        
        let finalX = direction === 1 ? tX : config.fieldWidth - tX;
        finalX = Math.max(70, Math.min(config.fieldWidth - 70, finalX));
        let finalY = Math.max(70, Math.min(config.fieldHeight - 70, tY));

        const rawAx = Kp * (finalX - char.x) - Kd * char.x_velocity;
        const rawAy = Kp * (finalY - char.y) - Kd * char.y_velocity;
        
        const ax = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAx));
        const ay = Math.max(-this.MAX_ACCEL, Math.min(this.MAX_ACCEL, rawAy));
        
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

  private getRlAccel(char: any, ball: any, direction: number): {ax: number, ay: number} {
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

  private getAccelerationFromAction(actionId: number, playerData: any, ballData: any): {ax: number, ay: number} {
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
            dir = dn > 1e-6 ? this.scale(dir, 1/dn) : [0,0];
            
            ax = dir[0] * this.MAX_ACCEL; 
            ay = dir[1] * this.MAX_ACCEL;
        } else { 
            let dir = bn > 1e-6 ? this.scale(to_ball, 1/bn) : [0,0];
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
        dir = dn > 1e-6 ? this.scale(dir, 1/dn) : btg_dir;
        
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

  private add(a: number[], b: number[]): number[] { return [a[0] + b[0], a[1] + b[1]]; }
  private sub(a: number[], b: number[]): number[] { return [a[0] - b[0], a[1] - b[1]]; }
  private scale(a: number[], scalar: number): number[] { return [a[0] * scalar, a[1] * scalar]; }
  private dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1]; }
  private norm(a: number[]): number { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
}