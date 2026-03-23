import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface AIBrain {
  grid_n: number[];
  grid_min: number[];
  grid_max: number[];
  grid_step: number[];
  is_circular: boolean[];
  rules_action: number[];
  rules_q: number[];
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private brainData: AIBrain | null = null;
  private isLoaded = false;

  private readonly MAX_ACCEL = 10; 
  private readonly OPP_GOAL = [0, 500];   
  private readonly OWN_GOAL = [2000, 500]; 

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.loadBrain();
    }
  }

  private async loadBrain() {
    try {
      const response = await fetch('/assets/ai_brain.json');
      this.brainData = await response.json();
      this.isLoaded = true;
      console.log(`🤖 AI Agy betöltve! DUAL CONTROLLER (Optimal Control) aktiválva.`);
    } catch (error) {
      console.error('❌ Nem sikerült betölteni az AI agyat.', error);
    }
  }

  public calculate5DState(playerData: any, ballData: any, playerVel?: any): number[] {
    const p = [playerData.x, playerData.y];
    const b = [ballData.x, ballData.y];
    
    // Labda sebességvektor
    const bv = [
      ballData.x_velocity ?? ballData.vx ?? 0,
      ballData.y_velocity ?? ballData.vy ?? 0
    ];

    const d_vec = this.sub(b, p);
    const raw_dist = this.norm(d_vec);
    const dist = Math.min(raw_dist, 1000);

    const pb = d_vec;
    const bg = this.sub(this.OPP_GOAL, b);
    const attack_angle = Math.atan2(pb[0] * bg[1] - pb[1] * bg[0], pb[0] * bg[0] + pb[1] * bg[1]);

    const bo = this.sub(this.OWN_GOAL, b);
    const bp = this.sub(p, b);
    const defense_angle = Math.atan2(bo[0] * bp[1] - bo[1] * bp[0], bo[0] * bp[0] + bo[1] * bp[1]);

    // ÚJ: A régi v_approach helyett a labda abszolút sebessége kell a hálónak!
    const ball_speed = Math.min(this.norm(bv), 50);

    let ball_x_norm = (1000 - b[0]) / 1000;
    ball_x_norm = Math.max(-1, Math.min(1, ball_x_norm));

    return [dist, attack_angle, defense_angle, ball_speed, ball_x_norm];
  }

  public getBestAction(currentState: number[]): number {
    if (!this.isLoaded || !this.brainData) return 1;

    let index = 0;
    let multiplier = 1;

    for (let d = 0; d < 5; d++) {
        const val = currentState[d];
        const min = this.brainData.grid_min[d];
        const step = this.brainData.grid_step[d];
        const n = this.brainData.grid_n[d];
        const isCirc = this.brainData.is_circular[d];

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

    if (index >= this.brainData.rules_action.length || index < 0) return 1;
    return this.brainData.rules_action[index];
  }

  public getAccelerationFromAction(actionId: number, playerData: any, ballData: any): {ax: number, ay: number} {
    const player = [playerData.x, playerData.y];
    const ball = [ballData.x, ballData.y];
    const v_player = [playerData.x_velocity ?? playerData.vx ?? 0, playerData.y_velocity ?? playerData.vy ?? 0];
    const ball_v = [ballData.x_velocity ?? ballData.vx ?? 0, ballData.y_velocity ?? ballData.vy ?? 0];
    
    let ax = 0, ay = 0;
    const speed = this.norm(v_player);

    switch (actionId) {
      case 1: 
      case 2: { // === CHASE & ATK_POS (Bang-Bang Control - Nincs lassítás!) ===
        const to_ball = this.sub(ball, player);
        const to_own = this.sub(this.OWN_GOAL, ball);
        const bn = this.norm(to_ball);
        const tn = this.norm(to_own);
        
        const push_cos = (bn > 1e-6 && tn > 1e-6) ? this.dot(to_ball, to_own) / (bn * tn) : -1;
        
        // Rossz oldal -> Kerülés (Bypass) padlógázzal
        if (push_cos > 0.1 && bn > 60) {
            let from_opp = this.sub(ball, this.OPP_GOAL);
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
            // Jó oldal -> Padlógáz egyenesen a labdába!
            let dir = bn > 1e-6 ? this.scale(to_ball, 1/bn) : [0,0];
            ax = dir[0] * this.MAX_ACCEL; 
            ay = dir[1] * this.MAX_ACCEL;
        }
        break;
      }

      case 3: { // === SHOOT (Tökéletes Elfogás + Blow-through) ===
        let t_opt = 5;
        for (let t = 5; t <= 40; t += 5) {
            // Labda lassulásának predikciója
            const B_pred = this.add(ball, this.scale(ball_v, (1 - Math.pow(0.98, t)) / (1 - 0.98)));
            const shoot_tgt = ball[1] > 500 ? [0, 420] : [0, 580];
            let dir_to_tgt = this.sub(shoot_tgt, B_pred);
            dir_to_tgt = this.scale(dir_to_tgt, 1 / Math.max(1e-6, this.norm(dir_to_tgt)));
            
            // A robotnak a labda FELÜLETÉT kell elérnie
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
        
        // BLOW-THROUGH: Célpont a labdán TÚL, a kapuba tolva
        const aim_pt = this.add(B_pred, this.scale(btg_dir, 500)); 
        let dir = this.sub(aim_pt, player);
        const dn = this.norm(dir);
        dir = dn > 1e-6 ? this.scale(dir, 1/dn) : btg_dir;
        
        ax = dir[0] * this.MAX_ACCEL; 
        ay = dir[1] * this.MAX_ACCEL;
        break;
      }

      case 4: { // === DEFEND (Gyors PD + Velocity Feedforward) ===
        const T_LOOK = Math.max(2, Math.min(10, this.norm(this.sub(this.OWN_GOAL, ball)) / 100));
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
        const dist_to_goal = this.norm(this.sub(this.OWN_GOAL, B_pred));
        opt_d = Math.min(opt_d, dist_to_goal - 60, 200);
        opt_d = Math.max(opt_d, 60); 
        
        const btg = this.sub(this.OWN_GOAL, B_pred);
        const btg_dir = this.scale(btg, 1 / Math.max(1e-6, this.norm(btg)));
        const target = this.add(B_pred, this.scale(btg_dir, opt_d));
        target[0] = Math.max(50, Math.min(1950, target[0]));
        target[1] = Math.max(50, Math.min(950, target[1]));
        
        // GYORS PD VEZÉRLÉS ELŐRECSATOLÁSSAL
        const err = this.sub(target, player);
        const err_dist = this.norm(err);
        let f_tot = [0, 0];

        if (err_dist > 1e-6) {
            const req_accel = this.scale(err, this.MAX_ACCEL / err_dist);
            // Labda sebességének hozzáadása (hogy ne maradjon le a robot)
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
        
        // Vészhelyzeti labdatakarítás a védelmi vonalon
        if (this.norm(this.sub(ball, player)) < 85) {
            ax = -this.MAX_ACCEL; 
            ay = 0;
            if (Math.abs(ball[1] - 500) > 40) ay = Math.sign(ball[1] - 500) * this.MAX_ACCEL;
        }
        break;
      }

      case 5: { // === BRAKE ===
        if (speed > 1) {
            ax = -v_player[0] / speed * this.MAX_ACCEL;
            ay = -v_player[1] / speed * this.MAX_ACCEL;
        }
        break;
      }

      case 6: { // === CLEAR ===
        let clear_dir = this.sub(ball, this.OWN_GOAL);
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

  // --- Matematikai segédfüggvények vektorokhoz ---
  private add(a: number[], b: number[]): number[] { return [a[0] + b[0], a[1] + b[1]]; }
  private sub(a: number[], b: number[]): number[] { return [a[0] - b[0], a[1] - b[1]]; }
  private scale(a: number[], scalar: number): number[] { return [a[0] * scalar, a[1] * scalar]; }
  private dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1]; }
  private norm(a: number[]): number { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
}