import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
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
  
  get roomStateSubjectValue(): models.Room | null {
    return this.roomStateSubject.value;
  }

  private configStateSubject= new BehaviorSubject<models.GameConfigMessage| null>(null);
  public configState$ = this.configStateSubject.asObservable();

  private errorStateSubject= new BehaviorSubject<models.ErrorMessage| null>(null);
  public errorState$ = this.errorStateSubject.asObservable();
  
  private gameOverStateSubject= new BehaviorSubject<models.TeamType | null>(null);
  public gameOverState$ = this.gameOverStateSubject.asObservable();

  // ÚJ: Ütközések állapota
  private collisionStateSubject = new BehaviorSubject<models.CollisionMessage | null>(null);
  public collisionState$ = this.collisionStateSubject.asObservable();

  constructor(private websocketService: WebsocketService) {
    this.websocketService.listen<models.Room>(models.ServerMessageType.ReceiveRoom).subscribe((room) => {
      console.log('Received room update:', room);
      
      if (this.isRestarting && room?.isStarted) {
        return;
      }

      if (room && !room.isStarted) {
        this.isRestarting = false;
      }

      if (this.isleavingRoom){
        console.log('Ignoring room update because isleavingRoom is true');
        this.roomStateSubject.next(null);
        this.isleavingRoom = false;
      } else{
        this.roomStateSubject.next(room);
      }
    });

    this.websocketService.listen<models.GameConfigMessage>(models.ServerMessageType.ReceiveConfig).subscribe((config) => {
      this.configStateSubject.next(config);
    });

    this.websocketService.listen<models.ErrorMessage>(models.ServerMessageType.Error).subscribe((error) => {
      this.errorStateSubject.next(error);
    });

    this.websocketService.listen<models.TeamType | null>(models.ServerMessageType.GameOver).subscribe((winner) => {
      this.gameOverStateSubject.next(winner);
    });

    this.websocketService.listen<models.IdMessage>(models.ServerMessageType.ReceiveId).subscribe((ids) => {
      this.idStateSubject.next(ids);
    });

    // ÚJ: Ütközések lehallgatása
    this.websocketService
      .listen<models.CollisionMessage>(models.ServerMessageType.Collision)
      .subscribe((collision) => {
        console.log('Received collision:', collision);
        this.collisionStateSubject.next(collision);
      });
  }

  public createRoom(username: string): void {
    console.log('Creating room for:', username);
    this.websocketService.connect(); // Biztosítsuk a kapcsolatot
    this.isleavingRoom = false;
    this.isRestarting = false;
    this.websocketService.send(models.ClientMessageType.CreateRoom, username);
  }

  public joinRoom(username: string, roomId: number): void {
    this.isleavingRoom = false;
    this.isRestarting = false;
    const payload: models.JoinMessage = { username, roomId };
    this.websocketService.send(models.ClientMessageType.JoinRoom, payload);
  }

  public clearLocalState(): void {
    this.roomStateSubject.next(null);
    this.idStateSubject.next({ playerId: null, roomId: null });
    this.configStateSubject.next(null);
    this.gameOverStateSubject.next(null);
    this.errorStateSubject.next(null);
    this.collisionStateSubject.next(null);
    this.isleavingRoom = false;
    this.isRestarting = false;
  }

  public leaveRoom(): void {
    console.log('Leaving room...');
    this.websocketService.send(models.ClientMessageType.LeaveRoom, null);
    this.clearLocalState();
    this.isleavingRoom = true; // Jelezzük, hogy várunk egy esetleges utolsó frissítésre (bár a szerver lekapcsol)
  }

  public getId(): void {
    this.websocketService.send(models.ClientMessageType.GetId, null);
  }

  public pickTeam(playerId: number, team: models.TeamType): void {
    const payload: models.TeamPickerMessage = { playerId, team };
    this.websocketService.send(models.ClientMessageType.PickTeam, payload);
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

  
  public sendMovement(coordinates: { x: number, y: number }[]): void {
    console.log("SEND MOVEMENT CALLED WITH:", coordinates);
  
    this.websocketService.send(
      models.ClientMessageType.MovementMessage,
      { coordinates }
    );
  }
}