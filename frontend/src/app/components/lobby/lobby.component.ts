import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { GameService } from '../../services/game.service';
import { AiBotManagerService } from '../../services/ai-bot.service';
import * as models from '../../models/robosoccer.models';
import { TeamType, AiVersion } from '../../models/robosoccer.models';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lobby.component.html',
  styleUrls: ['./lobby.component.scss']
})
export class LobbyComponent implements OnInit, OnDestroy {
  room: models.Room | null = null;
  playerId: number | null = null;
  
  private roomSubscription: Subscription | undefined;
  private idSubscription: Subscription | undefined;
  
  public TeamType = TeamType;
  public AiVersion = AiVersion;

  constructor(
    private router: Router, 
    private gameService: GameService, 
    public aiBotManager: AiBotManagerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.roomSubscription = this.gameService.roomState$.subscribe(room => {
      this.room = room;
      if (!room) {
        this.router.navigate(['/']);
        return;
      }
      if (this.room?.isStarted) {
        this.router.navigate(['/field']);
        return;
      }
      this.cdr.detectChanges();
    });

    this.idSubscription = this.gameService.idState$.subscribe(idMessage => {
      this.playerId = idMessage.playerId;
      this.cdr.detectChanges();
    });

    this.gameService.getId();
  }

  ngOnDestroy(): void {
    this.roomSubscription?.unsubscribe();
    this.idSubscription?.unsubscribe();
  }

  getTeam(team: models.TeamType): models.Player[] {
    return this.room ? this.room.players.filter(p => p.team === team) : [];
  }

  getSpectators(): models.Player[] {
    return this.room ? this.room.players.filter(p => p.team === TeamType.Spectator || p.team === null) : [];
  }

  joinTeam(team: models.TeamType): void {
    if (this.playerId !== null) {
      this.gameService.pickTeam(this.playerId, team);
    }
  }

  addBot(team: TeamType): void {
    if (this.room) {
      this.aiBotManager.addBot(this.room.roomId, team, AiVersion.Default);
    }
  }

  removeBot(playerId: number): void {
    this.aiBotManager.removeBot(playerId);
  }

  getBotAiVersion(playerId: number): AiVersion | null {
    return this.aiBotManager.getBotAiVersion(playerId);
  }

  onBotAiChange(playerId: number, event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const newVersion = selectElement.value as AiVersion;
    this.aiBotManager.changeBotAi(playerId, newVersion);
  }

  startGame(): void {
    this.gameService.startGame();
  }

  leaveRoom(): void {
    this.aiBotManager.clearBots();
    this.gameService.leaveRoom();
  }
}