import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import * as models from '../models/robosoccer.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: Socket;
  public lastAiVersion: models.AiVersion | null = null;

  constructor() {
    this.socket = io(environment.serverUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log('Socket connected with ID:', this.socket.id);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected. Reason:', reason);
    });
  }

  public isConnected(): boolean {
    return this.socket.connected;
  }

  public connect(): void {
    if (!this.socket.connected) {
      console.log('Manually connecting socket...');
      this.socket.connect();
    }
  }

  listen<T>(eventName: models.ServerMessageType): Observable<T> {
    return new Observable((subscriber) => {
      this.socket.on(eventName, (data) => {
        subscriber.next(data);
      });
    });
  }

  send(eventName: models.ClientMessageType, data: any): void {
    console.log("SOCKET EMIT EVENT:", eventName);
    
    if (this.socket.connected) {
      this.socket.emit(eventName, data);
    } else {
      console.log("Socket not connected, waiting for connection to send:", eventName);
      this.socket.once('connect', () => {
        console.log("Connected! Sending buffered message:", eventName);
        this.socket.emit(eventName, data);
      });
      this.socket.connect();
    }
  }
}