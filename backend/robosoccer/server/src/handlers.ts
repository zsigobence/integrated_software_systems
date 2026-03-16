// This file contains the handlers for the socket events.

import { Socket, Server } from "socket.io";
import { RobosoccerDatabase } from "./database";
import { ServerMessageType } from "../../model";
import { ErrorMessage, ErrorType, IdMessage, TeamType } from "../../model/message-interfaces";
import { GameConfig } from "./constants";


import { PhysicsEngine } from "./physicsengine";


// Import necessary types from the model
export class ServerHandlers {
    // This class will handle the socket events

    private io: Server; // Socket.IO instance
    private database: RobosoccerDatabase; // Database instance
    private physicsEngine: PhysicsEngine;

    constructor(io: Server, database: RobosoccerDatabase, physicsEngine: PhysicsEngine) {
        this.io = io; // Assign the Socket.IO instance
        this.database = database
        this.physicsEngine = physicsEngine;
    }

    public clientTestMessageHandler(socket: Socket, content: any) {
        console.log(`Client ${socket.id} sent: ${content}`);
    }


    public createRoomHandler(socket: Socket, username: string) {

        console.log(`Client ${socket.id} requested to create a room with username: "${username}"`);

        let room = this.database.getRoomBySocketId(socket.id)
        if (room) {
            const idmessage: IdMessage = {
                playerId: this.database.getPlayerIdBySocketId(socket.id), // Player ID from room ids
                roomId: room.roomId, // Room ID from the created room
            };

            this.io.to(socket.id).emit(ServerMessageType.ReceiveId, idmessage); // Send the socket ID back to the client
            this.io.to(socket.id).emit(ServerMessageType.ReceiveRoom, room); // Send a message back to the client
            this.io.to(socket.id).emit(ServerMessageType.ReceiveConfig, {
                fieldWidth: GameConfig.FIELD_WIDTH,
                fieldHeight: GameConfig.FIELD_HEIGHT,
                playerRadius: GameConfig.PLAYER_RADIUS,
                ballRadius: GameConfig.BALL_RADIUS,
                goalMinY: GameConfig.GOAL_MIN_Y,
                goalMaxY: GameConfig.GOAL_MAX_Y,
                winScore: GameConfig.WIN_SCORE,
                countdown: GameConfig.COUNTDOWN_SEC
            });
            socket.join(room.roomId.toString()); // Join the room in the socket
            console.log(`Client ${socket.id} tried to create new room while having an already existing one (${room.roomId})`);
            return; // Return the room if it exists
        }

        if (username == '') {
            this.noUsernameError(socket); // If no username is provided, send an error message
            return;
        }

        room = this.database.createRoom(username, socket.id); // Create a new room in the database
        const idmessage: IdMessage = {
            playerId: room.players[0].id, // Player ID from room ids
            roomId: room.roomId, // Room ID from the created room
        };

        this.io.to(socket.id).emit(ServerMessageType.ReceiveId, idmessage); // Send the socket ID back to the client
        this.io.to(socket.id).emit(ServerMessageType.ReceiveRoom, room); // Send a message back to the client
        this.io.to(socket.id).emit(ServerMessageType.ReceiveConfig, {
            fieldWidth: GameConfig.FIELD_WIDTH,
            fieldHeight: GameConfig.FIELD_HEIGHT,
            playerRadius: GameConfig.PLAYER_RADIUS,
            ballRadius: GameConfig.BALL_RADIUS,
            goalMinY: GameConfig.GOAL_MIN_Y,
            goalMaxY: GameConfig.GOAL_MAX_Y,
            winScore: GameConfig.WIN_SCORE,
            countdown: GameConfig.COUNTDOWN_SEC
        });
        socket.join(room.roomId.toString()); // Join the room in the socket
        console.log(`Client (SID: ${socket.id}) created room (ID: ${room.roomId}) with username: ${username}`);
    }

    public joinRoomHandler(socket: Socket, username: string, roomId: number) {

        console.log(`Player ${username} requested to join room with ID: ${roomId}`);

        let existingRoom = this.database.getRoomBySocketId(socket.id)
        if (existingRoom) {

            if (existingRoom.isStarted) {
                console.log(`Room with ID (${existingRoom.roomId}) has already started.`);

                const error: ErrorMessage = {
                    errorType: ErrorType.RoomAlreadyStarted, // Error type for other errors
                    message: `Room with ID (${existingRoom.roomId}) has already started.` // Error message for room not found
                };
                this.io.to(socket.id).emit(ServerMessageType.Error, error); // Send an error message back to the client
                return;
            }

            const idmessage: IdMessage = {
                playerId: this.database.getPlayerIdBySocketId(socket.id), // Player ID from room ids
                roomId: existingRoom.roomId, // Room ID from the created room
            };
            
            this.io.to(socket.id).emit(ServerMessageType.ReceiveConfig, {
                fieldWidth: GameConfig.FIELD_WIDTH,
                fieldHeight: GameConfig.FIELD_HEIGHT,
                playerRadius: GameConfig.PLAYER_RADIUS,
                ballRadius: GameConfig.BALL_RADIUS,
                goalMinY: GameConfig.GOAL_MIN_Y,
                goalMaxY: GameConfig.GOAL_MAX_Y,
                winScore: GameConfig.WIN_SCORE,
                countdown: GameConfig.COUNTDOWN_SEC
            });
            this.io.to(socket.id).emit(ServerMessageType.ReceiveId, idmessage); // Send the socket ID back to the client
            this.io.to(socket.id).emit(ServerMessageType.ReceiveRoom, existingRoom); // Send a message back to the client

            socket.join(existingRoom.roomId.toString()); // Join the room in the socket

            console.log(`Client ${socket.id} tried to create new room while having an already existing one (${existingRoom.roomId})`);

            return; // Return the room if it exists
        }

        if (username == '') {
            this.noUsernameError(socket); // If no username is provided, send an error message
            return;
        }
        
        const roomToJoin = this.database.getRoomByRoomId(roomId);
        if (!roomToJoin) {
            this.roomWithIdNotFound(socket, roomId);
            return;
        }

        if (roomToJoin.isStarted) {
            const error: ErrorMessage = {
                errorType: ErrorType.RoomAlreadyStarted,
                message: `Room with ID (${roomId}) has already started.`
            };
            this.io.to(socket.id).emit(ServerMessageType.Error, error);
            return;
        }

        const room = this.database.joinRoom(username, socket.id, roomToJoin);
        const currentPlayerId = this.database.getPlayerIdBySocketId(socket.id); 

        const idmessage: IdMessage = {
            playerId: currentPlayerId, 
            roomId: room.roomId,
        };
        this.io.to(socket.id).emit(ServerMessageType.ReceiveId, idmessage);
        this.io.to(socket.id).emit(ServerMessageType.ReceiveConfig, {
            fieldWidth: GameConfig.FIELD_WIDTH,
            fieldHeight: GameConfig.FIELD_HEIGHT,
            playerRadius: GameConfig.PLAYER_RADIUS,
            ballRadius: GameConfig.BALL_RADIUS,
            goalMinY: GameConfig.GOAL_MIN_Y,
            goalMaxY: GameConfig.GOAL_MAX_Y,
            winScore: GameConfig.WIN_SCORE,
            countdown: GameConfig.COUNTDOWN_SEC
        });
        socket.join(room.roomId.toString()); 
        this.io.to(room.roomId.toString()).emit(ServerMessageType.ReceiveRoom, room);

        console.log(`Client ${socket.id} joined room with username: ${username}`);
    }

    public pickTeamHandler(socket: Socket, team: TeamType) {
        console.log(`Client ${socket.id} requested to pick team: ${team}`);
        const room = this.database.pickTeam(socket.id, team); // Pick a team in the database

        if (room) {
            this.io.to(room.roomId.toString()).emit(ServerMessageType.ReceiveRoom, room); // Send a message back to the client
            console.log(`Client switched to team ${team}`);

        } else {
            this.roomNotFoundError(socket); // If the room does not exist, send an error message
        }
    }

    public startGameHandler(socket: Socket) {
        console.log(`Client ${socket.id} requested to start game`);
        const room = this.database.startGame(socket.id); // Start the game in the database

        if (room) {
            this.physicsEngine.resetPlayerPositions(room);
            this.io.to(room.roomId.toString()).emit(ServerMessageType.ReceiveRoom, room); // Send a message back to the client
            console.log(`Client ${socket.id} started game in room with ID: ${room.roomId}`);

        } else {
            this.roomNotFoundError(socket); // If the room does not exist, send an error message
        }
    }

    public leaveRoomHandler(socket: Socket) {
        console.log(`Client ${socket.id} requested to leave their room`);

        const room = this.database.leaveRoom(socket.id)

        if (room) { // Leave the room in the database

            this.io.to(room.roomId.toString()).emit(ServerMessageType.ReceiveRoom, room); // Send a message back to the client
            socket.leave(room.roomId.toString()); // Leave the socket room
            console.log(`Client ${socket.id} left their room`);
            socket.disconnect(); // Disconnect the socket

        } else {
            this.roomNotFoundError(socket); // If the room does not exist, send an error message
        }
    }

    public disconnectHandler(socket: Socket) {
        console.log(`Client ${socket.id} disconnected, setting status to inactive`);
        const room = this.database.setPlayerInactive(socket.id); // Leave the room in the database

        if (room) { // If the room exists, send a message back to the client
            this.io.to(room.roomId.toString()).emit(ServerMessageType.ReceiveRoom, room); // Send a message back to the client
        }
    }

    public getIdHandler(socket: Socket) {
        console.log(`Client ${socket.id} requested their ID`);
        const idmessage: IdMessage = {
            playerId: this.database.getPlayerIdBySocketId(socket.id), // Player ID from room ids
            roomId: this.database.getRoomIdBySocketId(socket.id), // Room ID from the created room
        };
        this.io.to(socket.id).emit(ServerMessageType.ReceiveId, idmessage); // Send the socket ID back to the client
        console.log(`Client ${socket.id} received their ID`);
    }

    public restartGameHandler(socket: Socket) {
        console.log(`Client ${socket.id} requested to restart game`);
        const room = this.database.restartGame(socket.id); // Restart the game in the database
        if (room) {
            this.physicsEngine.resetPlayerPositions(room);
            this.io.to(room.roomId.toString()).emit(ServerMessageType.ReceiveRoom, room); // Send a message back to the client
            console.log(`Client ${socket.id} restarted game in room with ID: ${room.roomId}`);
        }
        else {
            this.roomNotFoundError(socket); // If the room does not exist, send an error message
        }
    }

    public movementMessageHandler(socket: Socket, x: any, y: any) {
        console.log(`Client ${socket.id} sent movement message: x=${x}, y=${y}`);
        const room = this.database.handleMovement(socket.id, x, y); // Handle the movement in the database
        if (!room) {
            this.roomNotFoundError(socket); // If the room does not exist, send an error message
        }
    }

    private roomNotFoundError(socket: Socket) {
        console.log(`Client ${socket.id} does not have an existing room`);

        const error: ErrorMessage = {
            errorType: ErrorType.RoomNotFound, // Error type for other errors
            message: `Room for player with socket.id (${socket.id}) no longer not exist.` // Error message for room not found
        };

        this.io.to(socket.id).emit(ServerMessageType.Error, error); // Send an error message back to the client
        return;
    }

    private roomWithIdNotFound(socket: Socket, roomId: number) {
        console.log(`Room with ID ${roomId} does not exist.`);

        const error: ErrorMessage = {
            errorType: ErrorType.RoomNotFound, // Error type for other errors
            message: `Room with ID ${roomId} does not exist.` // Error message for room not found
        };
        this.io.to(socket.id).emit(ServerMessageType.Error, error); // Send an error message back to the client
        return;
    }

    private noUsernameError(socket: Socket) {
        console.log(`Client ${socket.id} requested to join a room without username`)
        const error: ErrorMessage = {
            errorType: ErrorType.NoUsername, // Error type for other errors
            message: `Username cannot be empty.` // Error message for room not found
        };
        this.io.to(socket.id).emit(ServerMessageType.Error, error); // Send an error message back to the client
        return;
    }

}
