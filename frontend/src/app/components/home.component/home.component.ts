import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NgOptimizedImage } from '@angular/common';

@Component({
  selector: 'app-home.component',
  imports: [CommonModule, NgOptimizedImage],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  activeButton: string | null = 'single';

  constructor(private router: Router) {}

  setActive(button: string) {
    this.activeButton = button;
  }

  singleplayer(): void {
    this.setActive('single');
    this.router.navigate(['field']);
  }

  multiplayer(): void {
    this.setActive('multi');
    const username = window.prompt('Add meg a felhasználónevedet!');

    if (!username?.trim()) {
      return;
    }

    this.router.navigate(['field'], {
      queryParams: {
        action: 'create',
        username: username.trim(),
      },
    });
  }

  joinGame(): void {
    this.setActive('join');
    const username = window.prompt('Add meg a felhasználónevedet!');
    if (!username?.trim()) {
      return;
    }

    const roomIdValue = window.prompt('Add meg a room ID-t!');
    const roomId = Number(roomIdValue);

    if (!roomIdValue || Number.isNaN(roomId)) {
      return;
    }

    this.router.navigate(['field'], {
      queryParams: {
        action: 'join',
        username: username.trim(),
        roomId,
      },
    });
  }

  leaderboard(): void {
    this.setActive('leader');
  }

  quit(): void {
    this.setActive('quit');
    window.close();
  }
}
