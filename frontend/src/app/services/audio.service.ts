import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface SoundSettings {
  enabled: boolean;
  volume: number;
}

const STORAGE_KEY = 'robosoccer_audio_settings';

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private audioContext: AudioContext | null = null;
  private sounds: Map<string, AudioBuffer> = new Map();
  
  private settingsSubject: BehaviorSubject<SoundSettings>;
  public settings$: import('rxjs').Observable<SoundSettings>;

  constructor() {
    // Load settings from localStorage
    const savedSettings = this.loadSettings();
    this.settingsSubject = new BehaviorSubject<SoundSettings>(savedSettings);
    this.settings$ = this.settingsSubject.asObservable();
    
    this.initAudioContext();
    this.generateSounds();
  }

  private loadSettings(): SoundSettings {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { enabled: true, volume: 0.5 };
    }
    
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load audio settings:', e);
    }
    
    return { enabled: true, volume: 0.5 };
  }

  private saveSettings(settings: SoundSettings): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save audio settings:', e);
    }
  }

  private initAudioContext() {
    if (typeof window !== 'undefined' && (window as any).AudioContext) {
      this.audioContext = new (window as any).AudioContext();
    }
  }

  private generateSounds() {
    if (!this.audioContext) return;

    // Gól hang - ünneplő hang
    this.sounds.set('goal', this.createGoalSound());
    
    // Ütközés hang - tompa puffanás
    this.sounds.set('collision', this.createCollisionSound());
    
    // Játék start hang - fütty
    this.sounds.set('gameStart', this.createGameStartSound());
    
    // Gomb megnyomás hang
    this.sounds.set('click', this.createClickSound());
    
    // Játék vége hang
    this.sounds.set('gameOver', this.createGameOverSound());
  }

  private createGoalSound(): AudioBuffer {
    const ctx = this.audioContext!;
    const duration = 0.8;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    // Ünneplő hang - emelkedő hangok
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const freq = 400 + t * 800;
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.3;
      data[i] += Math.sin(2 * Math.PI * (freq * 1.5) * t) * 0.2;
      // Leromlás
      const envelope = Math.exp(-t * 3);
      data[i] *= envelope;
    }

    return buffer;
  }

  private createCollisionSound(): AudioBuffer {
    const ctx = this.audioContext!;
    const duration = 0.15;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    // Tompa puffanás
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const freq = 80 + Math.random() * 40;
      data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 30);
      // Zaj hozzáadása
      data[i] += (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.3;
    }

    return buffer;
  }

  private createGameStartSound(): AudioBuffer {
    const ctx = this.audioContext!;
    const duration = 0.5;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    // Fütty hang
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const freq = 800 + t * 400;
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.4;
      const envelope = Math.sin(Math.PI * t / duration);
      data[i] *= envelope;
    }

    return buffer;
  }

  private createClickSound(): AudioBuffer {
    const ctx = this.audioContext!;
    const duration = 0.08;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    // Kattintás hang
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      data[i] = Math.sin(2 * Math.PI * 600 * t) * Math.exp(-t * 50);
      data[i] += (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.2;
    }

    return buffer;
  }

  private createGameOverSound(): AudioBuffer {
    const ctx = this.audioContext!;
    const duration = 1.0;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    // Szomorú lezárás
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const freq = 300 - t * 150;
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.3;
      data[i] += Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.2;
      const envelope = Math.exp(-t * 2);
      data[i] *= envelope;
    }

    return buffer;
  }

  play(soundName: string) {
    const settings = this.settingsSubject.value;
    if (!settings.enabled || !this.audioContext) return;

    const buffer = this.sounds.get(soundName);
    if (!buffer) return;

    // Resume audio context if suspended (browser policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();

    source.buffer = buffer;
    gainNode.gain.value = settings.volume;

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    source.start(0);
  }

  setEnabled(enabled: boolean) {
    const current = this.settingsSubject.value;
    const newSettings = { ...current, enabled };
    this.settingsSubject.next(newSettings);
    this.saveSettings(newSettings);
  }

  setVolume(volume: number) {
    const current = this.settingsSubject.value;
    const newSettings = { ...current, volume: Math.max(0, Math.min(1, volume)) };
    this.settingsSubject.next(newSettings);
    this.saveSettings(newSettings);
  }

  get settings(): SoundSettings {
    return this.settingsSubject.value;
  }
}