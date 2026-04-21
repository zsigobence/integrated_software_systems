import { Component, OnDestroy, OnInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameService } from '../../services/game.service';
import * as models from '../../models/robosoccer.models';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';

@Component({
  selector: 'app-field',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './field.html',
  styleUrls: ['./field.scss'],
})
export class Field implements OnInit, OnDestroy {
  room: models.Room | null = null;
  config: models.GameConfigMessage | null = null;
  playerId: number | null = null;
  winner: models.TeamType | null = null;
  public TeamType = models.TeamType;
  public leftGoalColor = '#4444ff';
  public rightGoalColor = '#ff4444';

  private roomSubscription: Subscription | undefined;
  private configSubscription: Subscription | undefined;
  private idSubscription: Subscription | undefined;
  private gameOverSubscription: Subscription | undefined;
  private collisionSubscription: Subscription | undefined;
  private acceleration = { x: 0, y: 0 };
  private keysPressed: { [key: string]: boolean } = {};
  private readonly ACCELERATION_STEP = 10;
  private movementIntervalId: number | null = null;

  constructor(private gameService: GameService, private cdr: ChangeDetectorRef, private router: Router) {}

  ngOnInit() {
    this.roomSubscription = this.gameService.roomState$.subscribe((room) => {
      this.room = room;
      if (room && !room.isStarted && !this.winner) {
          this.router.navigate(['/lobby']);
      }
      this.cdr.detectChanges();
    });

    this.configSubscription = this.gameService.configState$.subscribe((config) => {
      this.config = config;
      this.cdr.detectChanges();
    });

    this.idSubscription = this.gameService.idState$.subscribe((ids) => {
      this.playerId = ids.playerId;
      this.cdr.detectChanges();
    });

    this.gameOverSubscription = this.gameService.gameOverState$.subscribe((winner) => {
      this.winner = winner;
      this.cdr.detectChanges();
    });

    this.collisionSubscription = this.gameService.collisionState$.subscribe((collision) => {
      if (collision) {
        console.log('Collision detected:', collision);
        // Here you could add logic to show a visual effect for the collision
      }
    });

    if (this.playerId === null) {
      this.gameService.getId();
    }
  }

  ngOnDestroy(): void {
    if (this.roomSubscription) this.roomSubscription.unsubscribe();
    if (this.configSubscription) this.configSubscription.unsubscribe();
    if (this.idSubscription) this.idSubscription.unsubscribe();
    if (this.gameOverSubscription) this.gameOverSubscription.unsubscribe();
    if (this.collisionSubscription) this.collisionSubscription.unsubscribe();
    if (this.movementIntervalId !== null) clearInterval(this.movementIntervalId);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].indexOf(key) === -1) return;
    if (this.keysPressed[key]) return;
    this.keysPressed[key] = true;
    this.updateAccelerationAndInterval();
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd'].indexOf(key) === -1) return;
    this.keysPressed[key] = false;
    this.updateAccelerationAndInterval();
  }

  private updateAccelerationAndInterval() {
    let ax = 0; let ay = 0;
    const up = this.keysPressed['w']; const down = this.keysPressed['s'];
    const left = this.keysPressed['a']; const right = this.keysPressed['d'];

    if (up && !down) ay = -this.ACCELERATION_STEP;
    else if (down && !up) ay = this.ACCELERATION_STEP;

    if (left && !right) ax = -this.ACCELERATION_STEP;
    else if (right && !left) ax = this.ACCELERATION_STEP;

    this.acceleration.x = ax;
    this.acceleration.y = ay;

    const isMoving = ax !== 0 || ay !== 0;

    if (isMoving && this.movementIntervalId === null) {
      this.movementIntervalId = window.setInterval(() => {
        if (this.playerId !== null && this.room) {
          const player = this.room.players.find(p => p.id === this.playerId);
          if (player) {
            const coordinates = player.characters
              .sort((a, b) => a.id - b.id)
              .map(() => ({ x: this.acceleration.x, y: this.acceleration.y }));
            this.gameService.sendMovement(coordinates);
          }
        }
      }, 33);
    } else if (!isMoving && this.movementIntervalId !== null) {
      clearInterval(this.movementIntervalId);
      this.movementIntervalId = null;
      if (this.playerId !== null && this.room) {
        const player = this.room.players.find(p => p.id === this.playerId);
        if (player) {
          const coordinates = player.characters.map(() => ({ x: 0, y: 0 }));
          this.gameService.sendMovement(coordinates);
        }
      }
    }
  }

  restart(): void {
    this.winner = null;
    this.gameService.restartGame();
  }

  stopGame(): void {
    this.gameService.leaveRoom();
    this.router.navigate(['/']);
  }

  getAllCharacters(): (models.Character & { team: models.TeamType | null })[] {
    if (!this.room) return [];
    return this.room.players.flatMap(player =>
      player.characters.map(character => ({ ...character, team: player.team }))
    ).filter(c => c.team === models.TeamType.Red || c.team === models.TeamType.Blue);
  }

  leaveRoom(): void {
    this.gameService.leaveRoom();
    this.router.navigate(['/']);
  }
}