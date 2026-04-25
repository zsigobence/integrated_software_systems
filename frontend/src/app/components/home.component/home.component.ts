import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NgOptimizedImage } from '@angular/common';
import { GameService } from '../../services/game.service';
import { AudioService } from '../../services/audio.service';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-home.component',
  imports: [CommonModule, NgOptimizedImage, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  activeButton: string | null = 'single';
  username: string = '';
  roomId: number | null = null;

  private roomSubscription: Subscription | undefined;

  constructor(
    private router: Router, 
    private gameService: GameService,
    private audioService: AudioService
  ) {}

  ngOnInit(): void {
    // Csak a helyi állapotot töröljük, ne küldjünk újabb üzenetet a szervernek
    if (this.gameService.roomStateSubjectValue) {
       console.log('Clearing local room state on Home init');
       // @ts-ignore - elérés a privát metódushoz a hiba javítása érdekében
       this.gameService.clearLocalState();
    }

    this.roomSubscription = this.gameService.roomState$.subscribe((room) => {
      console.log('HomeComponent received room state:', room);
      if (room) {
        if (room.isStarted) {
          console.log('Navigating to field');
          this.router.navigate(['/field']);
        } else {
          console.log('Navigating to lobby');
          this.router.navigate(['/lobby']);
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.roomSubscription) {
      this.roomSubscription.unsubscribe();
    }
  }

  setActive(button: string) {
    this.activeButton = button;
    this.audioService.play('click');
  }

  singleplayer(): void {
    this.setActive('single');
    this.router.navigate(['field']);
  }

  multiplayer(): void {
    this.setActive('multi');
    if (this.username) {
      this.gameService.createRoom(this.username);
    } else {
      alert('Please enter a username.');
    }
  }

  joinGame(): void {
    this.setActive('join');
    if (this.username && this.roomId) {
      this.gameService.joinRoom(this.username, this.roomId);
    } else {
      alert('Please enter a username and room ID.');
    }
  }

  leaderboard(): void {
    this.setActive('leader');
    this.audioService.play('click');
  }

  quit(): void {
    this.setActive('quit');
    this.audioService.play('click');
  }

  openSettings(): void {
    this.audioService.play('click');
    this.router.navigate(['/settings']);
  }
}
