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
    console.log("SOCKET EMIT EVENT:", eventName);
    console.log("SOCKET EMIT DATA:", data);
  
    this.socket.emit(eventName, data);
  }
}