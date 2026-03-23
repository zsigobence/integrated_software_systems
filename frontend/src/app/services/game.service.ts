
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { WebsocketService } from './websocket.service';
import * as models from '../models/robosoccer.models';

@Injectable({
  providedIn: 'root'
})
export class GameService {
  private isRestarting = false;
  private isleavingRoom = false;

  private roomStateSubject = new BehaviorSubject<models.Room | null>(null);
  public roomState$ = this.roomStateSubject.asObservable();

  private idStateSubject = new BehaviorSubject<models.IdMessage>({ playerId: null, roomId: null });
  public idState$ = this.idStateSubject.asObservable();

  private configStateSubject= new BehaviorSubject<models.GameConfigMessage| null>(null);
  public configState$ = this.configStateSubject.asObservable();

  private errorStateSubject= new BehaviorSubject<models.ErrorMessage| null>(null);
  public errorState$ = this.errorStateSubject.asObservable();
  
  private gameOverStateSubject= new BehaviorSubject<models.TeamType | null>(null);
  public gameOverState$ = this.gameOverStateSubject.asObservable();

  constructor(private websocketService: WebsocketService) {
    this.websocketService.listen(models.ServerMessageType.ReceiveRoom).subscribe((room) => {
      const ids = this.idStateSubject.value;

      // Guard: Ignore room updates if we are waiting for the server to acknowledge a restart (ignore 'started' rooms)
      if (this.isRestarting && room?.isStarted) {
        return;
      }

      if (room && !room.isStarted) {
        this.isRestarting = false;
      }

      if (this.isleavingRoom){
        this.roomStateSubject.next(null);
        this.isleavingRoom = false;
    
      } else{
        this.roomStateSubject.next(room);
        console.log('Received room:', room);
      }

    });

    this.websocketService.listen(models.ServerMessageType.ReceiveConfig).subscribe((config) => {
      console.log('Received config:', config);
      this.configStateSubject.next(config);
    });

    this.websocketService.listen(models.ServerMessageType.Error).subscribe((error) => {
      console.log('Received error:', error);
      this.errorStateSubject.next(error);
    });

    this.websocketService.listen(models.ServerMessageType.GameOver).subscribe((winner) => {
      console.log('Received game over:', winner);
      this.gameOverStateSubject.next(winner);
    });

    this.websocketService.listen(models.ServerMessageType.ReceiveId).subscribe((ids) => {
      console.log('Received ID:', ids);
      this.idStateSubject.next(ids);
    });
  }

  // Client to Server Message Handlers

  public createRoom(username: string): void {
    this.isleavingRoom = false;
    this.isRestarting = false;
    console.log('Creating room with username:', username);
    this.websocketService.send(models.ClientMessageType.CreateRoom, username);
  }

  public joinRoom(username: string, roomId: number): void {
    this.isleavingRoom = false;
    this.isRestarting = false;
    const payload: models.JoinMessage = { username, roomId };
    this.websocketService.send(models.ClientMessageType.JoinRoom, payload);
  }

  public leaveRoom(): void {
    this.websocketService.send(models.ClientMessageType.LeaveRoom, null);
    this.isRestarting = false;
    this.isleavingRoom = true;
    this.roomStateSubject.next(null);
    this.idStateSubject.next({ playerId: null, roomId: null });
    this.configStateSubject.next(null);
  }

  public getId(): void {
    this.websocketService.send(models.ClientMessageType.GetId, null);
  }

  public pickTeam(playerId: number, team: models.TeamType): void {
    const payload: models.TeamPickerMessage = { playerId, team };
    this.websocketService.send(models.ClientMessageType.PickTeam, payload);
    console.log('Picking team with payload:', payload);
  }

  public startGame(): void {
    this.isRestarting = false;
    this.gameOverStateSubject.next(null);
    this.websocketService.send(models.ClientMessageType.StartGame, null);
  }

  public restartGame(): void {
    this.websocketService.send(models.ClientMessageType.RestartGame, null);
    this.gameOverStateSubject.next(null);
    this.isRestarting = true;
    const currentRoom = this.roomStateSubject.value;
    if (currentRoom) {
      this.roomStateSubject.next({ ...currentRoom, isStarted: false });
    }
  }

  public sendMovement(playerId: number, characterId: number, x: number, y: number): void {
    const payload: models.MovementMessage = { playerId, characterId, x, y };
    this.websocketService.send(models.ClientMessageType.MovementMessage, payload);
  }
}
