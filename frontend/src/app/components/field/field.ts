import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  GameConfigMessage,
  Player,
  Room,
  TeamType,
} from '../../models/socket-models';
import { SocketGameService } from '../../services/socket-game.service';

@Component({
  selector: 'app-field',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './field.html',
  styleUrls: ['./field.scss'],
})
export class Field implements OnInit, OnDestroy {
  room: Room | null = null;
  config: GameConfigMessage | null = null;
  myPlayerId: number | null = null;
  roomId: number | null = null;
  connected = false;
  errorMessage: string | null = null;
  username = '';
  private sub = new Subscription();
  private pressedKeys = new Set<string>();
  private movementIntervalId: number | null = null;
  private readonly isBrowser: boolean;
  private pendingAction: 'create' | 'join' | null = null;
  private pendingRoomId: number | null = null;
  private actionSent = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private gameService: SocketGameService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: Object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {
    if (!this.isBrowser) {
      return;
    }

    this.sub.add(
      this.gameService.room$.subscribe((room) => {
        this.room = room;
        this.cdr.detectChanges();
      })
    );

    this.sub.add(
      this.gameService.config$.subscribe((config) => {
        this.config = config;
        this.cdr.detectChanges();
      }),
    );

    this.sub.add(
      this.gameService.connected$.subscribe((connected) => {
        this.connected = connected;

        if (connected) {
          this.tryExecutePendingAction();
        }

        this.cdr.detectChanges();
      }),
    );

    this.sub.add(
      this.gameService.error$.subscribe((message) => {
        this.errorMessage = message;
        this.cdr.detectChanges();
      }),
    );

    this.sub.add(
      this.gameService.id$.subscribe((idMessage) => {
        this.myPlayerId = idMessage?.playerId ?? null;
        this.roomId = idMessage?.roomId ?? null;
        this.cdr.detectChanges();
      }),
    );

    this.sub.add(
      this.gameService.winner$.subscribe((winner) => {
        if (winner && this.isBrowser) {
          window.alert(`Játék vége! Nyertes csapat: ${winner}`);
        }
        this.cdr.detectChanges();
      }),
    );

    this.sub.add(
      this.route.queryParamMap.subscribe((params) => {
        const action = params.get('action');
        const username = params.get('username')?.trim() ?? '';
        const roomIdParam = params.get('roomId');
        const roomId = roomIdParam ? Number(roomIdParam) : null;

        this.username = username;
        this.pendingAction =
          action === 'create' || action === 'join' ? action : null;
        this.pendingRoomId =
          roomId !== null && !Number.isNaN(roomId) ? roomId : null;

        this.actionSent = false;
        this.tryExecutePendingAction();
        this.cdr.detectChanges();
      }),
    );

    this.gameService.connect();
    this.startMovementLoop();
  }

  ngOnDestroy() {
    this.stopMovementLoop();
    this.sub.unsubscribe();
  }

  private tryExecutePendingAction() {
    if (!this.isBrowser) return;
    if (!this.connected) return;
    if (this.actionSent) return;
    if (!this.username || !this.pendingAction) return;

    this.gameService.resetState();

    if (this.pendingAction === 'create') {
      this.gameService.createRoom(this.username);
      this.actionSent = true;
      return;
    }

    if (this.pendingAction === 'join' && this.pendingRoomId !== null) {
      this.gameService.joinRoom(this.username, this.pendingRoomId);
      this.actionSent = true;
    }
  }

  chooseTeam(team: TeamType) {
    this.gameService.chooseTeam(team);
  }

  goBack(): void {
    this.gameService.leaveRoom();
    this.gameService.disconnect();
    this.router.navigate(['/']);
  }

  startGame() {
    this.gameService.startGame();
  }

  restartGame() {
    this.gameService.restartGame();
  }

  leaveRoom() {
    this.gameService.leaveRoom();
    this.gameService.disconnect();
    this.router.navigate(['/']);
  }

  clearError() {
    this.gameService.clearError();
  }

  get players(): Player[] {
    return this.room?.players ?? [];
  }

  get myPlayer(): Player | undefined {
    return this.players.find((player) => player.id === this.myPlayerId);
  }

  trackByPlayerId(_: number, player: Player) {
    return player.id;
  }

  fieldWidth(): number {
    return this.config?.fieldWidth ?? 800;
  }

  fieldHeight(): number {
    return this.config?.fieldHeight ?? 500;
  }

  playerRadius(): number {
    return this.config?.playerRadius ?? 20;
  }

  ballRadius(): number {
    return this.config?.ballRadius ?? 12;
  }

  isOwnPlayer(player: Player): boolean {
    return player.id === this.myPlayerId;
  }

  playerColor(player: Player): string {
    if (player.team === 'red') return '#d62828';
    if (player.team === 'blue') return '#1d4ed8';
    return '#6b7280';
  }

  private startMovementLoop() {
    if (!this.isBrowser) return;

    this.movementIntervalId = window.setInterval(() => {
      if (!this.room || this.myPlayerId === null) {
        return;
      }

      const movement = this.getMovementVector();
      this.gameService.move(movement.x, movement.y);
    }, 1000 / 30);
  }

  private stopMovementLoop() {
    if (!this.isBrowser) return;

    if (this.movementIntervalId !== null) {
      window.clearInterval(this.movementIntervalId);
      this.movementIntervalId = null;
    }
  }

  private getMovementVector() {
    let x = 0;
    let y = 0;

    if (this.pressedKeys.has('arrowleft') || this.pressedKeys.has('a')) x -= 1;
    if (this.pressedKeys.has('arrowright') || this.pressedKeys.has('d')) x += 1;
    if (this.pressedKeys.has('arrowup') || this.pressedKeys.has('w')) y -= 1;
    if (this.pressedKeys.has('arrowdown') || this.pressedKeys.has('s')) y += 1;

    return { x, y };
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    this.pressedKeys.add(event.key.toLowerCase());
  }

  @HostListener('window:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) {
    this.pressedKeys.delete(event.key.toLowerCase());
  }
}
