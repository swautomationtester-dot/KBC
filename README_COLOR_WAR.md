# Color War integration

This package adds Color War to GamesArena.

## URLs
- `/color-war.html` — host + player entry page
- `/color-war.html?join=1234` — direct player join link
- `/color-war-tv.html?room=1234&token=...` — dedicated read-only TV screen

## Flow
1. Open Color War from the GamesArena homepage.
2. Host clicks **Create Color War**.
3. Put the generated **TV link** on the venue TV/projector.
4. Players scan the **Scan to join** QR or enter the 4-digit code.
5. Host starts when 2–4 players are ready.
6. Players play from their phones; the TV updates live.
7. Last player with territory wins.

The game uses the existing Express + Socket.IO server. No second server is required.
