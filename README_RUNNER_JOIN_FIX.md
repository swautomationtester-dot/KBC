# GamesArena Runner — Card Match-style joining fix

Runner now uses the same room/join pattern as Card Match:

- Host creates a room from `/runner.html`.
- Host gets a 4-digit room code, Player Join QR, Player link, TV QR, and TV link.
- Players can scan the QR or open `/runner.html?join=1234` and enter their name.
- Player sessions use persistent tokens so reconnects do not create duplicate players.
- Host sessions use a persistent host token so the host can reconnect without losing the room.
- Up to 4 players can join before the host starts.
- Host remains a playable controller and can start/restart the race.
- TV can open through the secure TV link or by manually entering the 4-digit room code.
- Runner's original phone controls, platformer physics, coins, leaderboard, timer, finish line and winner screen remain intact.

The Mini Kart Race files are not included in this version.
