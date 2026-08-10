# Card Match v110 Board Fix

Fixes:
- Reliable Card Match state restoration after Socket.IO reconnects.
- Player session tokens let a mobile player resume the same seat.
- TV session token lets the TV reconnect without losing the room.
- A playing state with an incomplete deck now requests an authoritative server sync instead of rendering a blank board.
- GamesArena premium logo is used on every face-down card.
- Matched pairs retain the color of the player who found them.
- Added left/right game information panels while keeping the board centered.
- Side scoreboard and current/next player status stay synchronized.
- Refresh Board and New Game remain TV-only and preserve the expected room/players behavior.
