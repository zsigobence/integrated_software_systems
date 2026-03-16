import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import {
  GameConfigMessage,
  IdMessage,
  Room,
  TeamType,
} from '../models/socket-models';

@Injectable({
  providedIn: 'root',
})
export class SocketGameService {
  private socket: Socket | null = null;

  connected$ = new BehaviorSubject<boolean>(false);
  room$ = new BehaviorSubject<Room | null>(null);
  config$ = new BehaviorSubject<GameConfigMessage | null>(null);
  id$ = new BehaviorSubject<IdMessage | null>(null);
  error$ = new BehaviorSubject<string | null>(null);
  winner$ = new BehaviorSubject<string | null>(null);

  constructor(private zone: NgZone) {}

  private runInZone(fn: () => void): void {
    this.zone.run(fn);
  }

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    if (this.socket && !this.socket.connected) {
      this.socket.connect();
      return;
    }

    this.socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    this.socket.on('connect', () => {
      this.runInZone(() => {
        this.connected$.next(true);
        this.error$.next(null);
      });
    });

    this.socket.on('disconnect', () => {
      this.runInZone(() => {
        this.connected$.next(false);
      });
    });

    this.socket.on('connectAck', () => {
      this.runInZone(() => {
        this.connected$.next(true);
      });
    });

    this.socket.on('receiveId', (message: IdMessage) => {
      this.runInZone(() => {
        this.id$.next(message);
      });
    });

    this.socket.on('receiveRoom', (room: Room) => {
      this.runInZone(() => {
        this.room$.next(room);

        if (room?.winner) {
          this.winner$.next(room.winner);
        }
      });
    });

    this.socket.on('receive-config', (config: GameConfigMessage) => {
      this.runInZone(() => {
        this.config$.next(config);
      });
    });

    this.socket.on('gameOver', (winner: string) => {
      this.runInZone(() => {
        this.winner$.next(winner);
      });
    });

    this.socket.on('error', (error: unknown) => {
      this.runInZone(() => {
        if (typeof error === 'string') {
          this.error$.next(error);
          return;
        }

        if (
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
        ) {
          this.error$.next((error as { message: string }).message);
          return;
        }

        this.error$.next('Ismeretlen socket hiba.');
      });
    });
  }

  createRoom(username: string): void {
    if (!this.socket) return;

    this.runInZone(() => {
      this.error$.next(null);
      this.winner$.next(null);
      this.room$.next(null);
      this.id$.next(null);
    });

    this.socket.emit('createRoom', username);
  }

  joinRoom(username: string, roomId: number): void {
    if (!this.socket) return;

    this.runInZone(() => {
      this.error$.next(null);
      this.winner$.next(null);
      this.room$.next(null);
      this.id$.next(null);
    });

    this.socket.emit('joinRoom', { username, roomId });
  }

  chooseTeam(team: TeamType): void {
    this.socket?.emit('pickTeam', { team });
  }

  startGame(): void {
    this.socket?.emit('startGame');
  }

  restartGame(): void {
    this.socket?.emit('restartGame');
  }

  move(x: number, y: number): void {
    this.socket?.emit('movementMessage', { x, y });
  }

  leaveRoom(): void {
    this.socket?.emit('leaveRoom');
    this.resetState();
  }

  resetState(): void {
    this.runInZone(() => {
      this.room$.next(null);
      this.config$.next(null);
      this.id$.next(null);
      this.error$.next(null);
      this.winner$.next(null);
    });
  }

  clearError(): void {
    this.runInZone(() => {
      this.error$.next(null);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.runInZone(() => {
      this.connected$.next(false);
      this.resetState();
    });
  }
}