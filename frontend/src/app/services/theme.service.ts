import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type PlayerSkin = 'classic' | 'neon' | 'striped' | 'metallic';
export type FieldTheme = 'classic' | 'night' | 'ice' | 'clay';

export interface GameThemes {
  playerSkin: PlayerSkin;
  fieldTheme: FieldTheme;
}

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly SKIN_KEY = 'robotfoci_skin';
  private readonly FIELD_KEY = 'robotfoci_field';

  private themesSubject = new BehaviorSubject<GameThemes>(this.loadThemes());
  
  themes$ = this.themesSubject.asObservable();

  constructor() {}

  get currentThemes(): GameThemes {
    return this.themesSubject.value;
  }

  setPlayerSkin(skin: PlayerSkin): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.SKIN_KEY, skin);
    }
    this.themesSubject.next({ ...this.themesSubject.value, playerSkin: skin });
  }

  setFieldTheme(theme: FieldTheme): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.FIELD_KEY, theme);
    }
    this.themesSubject.next({ ...this.themesSubject.value, fieldTheme: theme });
  }

  private loadThemes(): GameThemes {
    let playerSkin: PlayerSkin = 'classic';
    let fieldTheme: FieldTheme = 'classic';

    if (typeof window !== 'undefined' && window.localStorage) {
      playerSkin = (localStorage.getItem(this.SKIN_KEY) as PlayerSkin) || 'classic';
      fieldTheme = (localStorage.getItem(this.FIELD_KEY) as FieldTheme) || 'classic';
    }

    return { playerSkin, fieldTheme };
  }
}
