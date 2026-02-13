# Robotfoci – Kliens–Szerver játék

## Leírás

A projekt egy valós idejű 2D robotfoci játék, amely kliens–szerver architektúrában működik.  
A kommunikáció WebSocketen keresztül történik JSON formátumban.

A szerver authoritative módon kezeli:
- a játékállapotot (robotok, labda, pontszám)
- a fizikai szimulációt
- az ütközéseket és gólokat

A kliens:
- megjeleníti a játékot
- kezeli a felhasználói inputot
- elküldi a vezérlési parancsokat a szervernek

## Főbb funkciók

- 2 játékos támogatása
- Valós idejű állapotfrissítés
- Egyszerű 2D fizikai modell
- Opcionális AI vezérlés

## Futtatás

### Szerver indítása
```bash
node server.js
