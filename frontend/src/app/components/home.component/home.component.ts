import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NgOptimizedImage } from '@angular/common';
import { GameService } from '../../services/game.service';
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

  constructor(private router: Router, private gameService: GameService) {}

  ngOnInit(): void {
    this.roomSubscription = this.gameService.roomState$.subscribe((room) => {
      if (room) {
        if (room.isStarted) {
          this.router.navigate(['/field']);
        } else {
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
  }

  singleplayer(): void {
    this.setActive('single');
    // For now, single player will just navigate to the field view
    this.router.navigate(['field']);
  }

  multiplayer(): void {
    this.setActive('multi');
    if (this.username) {
      this.gameService.createRoom(this.username);
    } else {
      // Handle case where username is not entered
      alert('Please enter a username.');
    }
  }

  joinGame(): void {
    this.setActive('join');
    if (this.username && this.roomId) {
      this.gameService.joinRoom(this.username, this.roomId);
    } else {
      // Handle case where username or room ID is not entered
      alert('Please enter a username and room ID.');
    }
  }

  leaderboard(): void {
    this.setActive('leader');
  }

  quit(): void {
    this.setActive('quit');
  }
}
