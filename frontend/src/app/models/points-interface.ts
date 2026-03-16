export interface ServerInterface {
    id: number;
    type: 'playerBlue' | 'playerRed' | 'ball';
    x: number;
    y: number;
    updatedAt: string;
}
