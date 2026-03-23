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
    this.socket = io(environment.serverUrl);
  }

  listen<T>(eventName: models.ServerMessageType): Observable<T> {
    return new Observable((subscriber) => {
      this.socket.on(eventName, (data) => {
        subscriber.next(data);
      });
    });
  }

  send(eventName: models.ClientMessageType, data: any): void {
    // Eltároljuk az AI verziót a StartGame és RestartGame üzenetekből
    if (eventName === models.ClientMessageType.StartGame || eventName === models.ClientMessageType.RestartGame) {
      if (data && data.aiVersion) {
        this.lastAiVersion = data.aiVersion;
      }
    }
    this.socket.emit(eventName, data);
  }
}