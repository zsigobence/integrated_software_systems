import { Server, ServerOptions, Socket } from "socket.io";
import { IncomingMessage, ServerResponse } from "http";
import { Server as HttpServer } from "http";
import { ServerMessageType, ClientMessageType } from "../../model"
import { ServerHandlers } from "./handlers";
import { RobosoccerDatabase } from "./database";
import { GameConfig } from "./constants";
import { PhysicsEngine } from "./physicsengine";

/** Realises the server side of socket communication */
export class SocketHandler {

  private io: Server;
  private handlers: ServerHandlers | null;
  private database: RobosoccerDatabase; 
  
  // NEW: Add the physics engine property
  private physicsEngine: PhysicsEngine; 

  constructor(httpServer: HttpServer<typeof IncomingMessage, typeof ServerResponse> | Partial<ServerOptions>, database: RobosoccerDatabase) {
    this.io = new Server(httpServer, {
      cors: {
        origin: (requestOrigin, callback) => {
          callback(null, requestOrigin);
        },
        methods: ["GET", "POST"],
        credentials: true
      }
    });
    this.database = database;
    this.handlers = null; 
    
    // NEW: Initialize the physics engine
    this.physicsEngine = new PhysicsEngine(); 

    this.setUp();

    // NEW: Start the loop as soon as the server boots up!
    this.startGameLoop(); 
  }

  // NEW: Add the loop method right here
  private startGameLoop() {
    // This setInterval runs continuously based on your TICK_RATE (e.g., 60 times a second)
    setInterval(() => {
      // 1. Get all rooms that are currently playing
      const activeRooms = this.database.getAllRooms().filter(room => room.isStarted);
      
      // 2. Calculate the physics for each active room
      activeRooms.forEach(room => {
        this.physicsEngine.updateRoom(room);

        // 3. Send the updated room back to the clients
        this.io.to(room.roomId.toString()).emit(ServerMessageType.ReceiveRoom, room);

        // 4. If the game ended during the update, notify the clients
        if (room.winner !== null) {
          this.io.to(room.roomId.toString()).emit(ServerMessageType.GameOver, room.winner);
          room.isStarted = false; // Stop the game loop for this room until it's restarted
        } 

      });

    }, GameConfig.TICK_RATE);
  }

  
  private setUp() {
    //Configure listener for socket connection
    this.handlers = new ServerHandlers(this.io, this.database, this.physicsEngine);

    this.io.on("connection", (socket) => {
      this.io.to(socket.id).emit(ServerMessageType.ConnectAck);

      //Configure listeners for different message types and disconnection on socket
      socket.on(ClientMessageType.TestMessage, (content) => this.handlers?.clientTestMessageHandler(socket, content));
      socket.on(ClientMessageType.CreateRoom, (username) => this.handlers?.createRoomHandler(socket, username));
      socket.on(ClientMessageType.JoinRoom, (join) => this.handlers?.joinRoomHandler(socket, join.username, join.roomId));
      socket.on(ClientMessageType.LeaveRoom, (content) => this.handlers?.leaveRoomHandler(socket));
      socket.on(ClientMessageType.GetId, (content) => this.handlers?.getIdHandler(socket));
      socket.on(ClientMessageType.PickTeam, (content) => this.handlers?.pickTeamHandler(socket, content.team));
      socket.on(ClientMessageType.StartGame, (content) => this.handlers?.startGameHandler(socket));
      socket.on(ClientMessageType.RestartGame, (content) => this.handlers?.restartGameHandler(socket));
      socket.on(ClientMessageType.MovementMessage, (content) => this.handlers?.movementMessageHandler(socket, content.x, content.y));

      socket.on('disconnect', () => {
        this.handlers?.disconnectHandler(socket); // Call leaveRoomHandler on disconnect
      });
    });
  }

  private checkHandlers(handler : any) {
    if (!this.handlers) {
      return console.error("Handlers are not initialized.");
    }
    return handler;
  }

}
