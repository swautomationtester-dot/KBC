GamesArena update:
- Uses supplied premium GamesArena logo throughout home/card match.
- Host Socket.IO now prefers polling then upgrades to websocket, with infinite reconnect.
- Host room survives transient socket disconnects for 90 seconds.
- Host browser stores a private room token and automatically resumes the existing room after reconnect.
- Fastest Finger controls remain enabled after a reconnect because the server no longer deletes the room immediately.
