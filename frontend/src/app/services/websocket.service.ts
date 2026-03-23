
import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: Socket;

  constructor(private zone: NgZone) {
    this.socket = io(environment.serverUrl, {
      withCredentials: true,
      transports: ['polling', 'websocket']
      });

    this.socket.on('connect', () => {
      console.log('Connected to WebSocket server at:', environment.serverUrl);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });
  }

  public connect(): void {
    this.socket.connect();
  }

  public disconnect(): void {
    this.socket.disconnect();
  }

  public send(eventName: string, data: any): void {
    if (!this.socket.connected) {
      console.warn(`Attempting to send ${eventName} while disconnected. Buffering...`);
      this.socket.connect();
    }
    console.log(`Sending event: ${eventName}`, data);
    this.socket.emit(eventName, data);
  }

  public listen(eventName: string): Observable<any> {
    return new Observable((observer) => {
      this.socket.on(eventName, (data) => {
        this.zone.run(() => {
          observer.next(data);
        });
      });
    });
  }
}
