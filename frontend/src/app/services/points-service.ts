import { Injectable } from '@angular/core';
import { ServerInterface } from '../models/points-interface';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PointsService {
  private base = 'http://localhost:3000/points'; //backend url-je
  constructor(private http: HttpClient) {}

  getAll(): Observable<ServerInterface[]> {
    return this.http.get<ServerInterface[]>(this.base);
  }

  getId(id: number): Observable<ServerInterface> {
    return this.http.get<ServerInterface>(`${this.base}/${id}`);
  }

  update(point: ServerInterface): Observable<ServerInterface> {
    return this.http.put<ServerInterface>(`${this.base}/${point.id}`, point);
  }
}
