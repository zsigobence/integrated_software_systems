import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AudioService, SoundSettings } from '../../services/audio.service';
import { ThemeService, PlayerSkin, FieldTheme } from '../../services/theme.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.html',
  styleUrls: ['./settings.scss']
})
export class SettingsComponent implements OnInit, OnDestroy {
  soundEnabled: boolean;
  soundVolume: number;
  selectedSkin: PlayerSkin;
  selectedField: FieldTheme;
  
  private settingsSubscription: Subscription | undefined;

  constructor(
    private router: Router,
    private audioService: AudioService,
    private themeService: ThemeService
  ) {
    const settings = this.audioService.settings;
    this.soundEnabled = settings.enabled;
    this.soundVolume = settings.volume;
    this.selectedSkin = this.themeService.currentThemes.playerSkin;
    this.selectedField = this.themeService.currentThemes.fieldTheme;
  }

  ngOnInit(): void {
    // Listen for changes (e.g. from other components or storage events if implemented)
    this.settingsSubscription = this.audioService.settings$.subscribe(settings => {
      if (this.soundEnabled !== settings.enabled) {
        this.soundEnabled = settings.enabled;
      }
      if (this.soundVolume !== settings.volume) {
        this.soundVolume = settings.volume;
      }
    });
  }

  ngOnDestroy(): void {
    this.settingsSubscription?.unsubscribe();
  }

  onSoundEnabledChange(): void {
    this.audioService.setEnabled(this.soundEnabled);
  }

  onSoundVolumeChange(): void {
    this.audioService.setVolume(this.soundVolume);
  }

  onSkinChange(skin: PlayerSkin): void {
    this.selectedSkin = skin;
    this.themeService.setPlayerSkin(skin);
    this.audioService.play('click');
  }

  onFieldChange(theme: FieldTheme): void {
    this.selectedField = theme;
    this.themeService.setFieldTheme(theme);
    this.audioService.play('click');
  }

  testSound(): void {
    this.audioService.play('click');
  }

  back(): void {
    this.router.navigate(['/']);
  }
}