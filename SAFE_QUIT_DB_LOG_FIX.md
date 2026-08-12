# Safe Quit + MySQL Game Log Fix

## Safe-money exit
When the Host approves Safe Quit, both the TV and the quitting participant now show:
- player name
- safe amount
- “left with the safe money”
- “Well played!”

The farewell is preserved for the transition even though the Host immediately advances to the next contestant.

## Game logs
The Host Console now has:
- **📜 Game Logs** search by name, register number, or phone
- **🗄️ DB Status** diagnostic

Every registration and quiz result is written to `players` + `game_results`. Safe Quit is stored as:
`result_status = SAFE_QUIT`, `safe_quit = 1`, `amount_won = safe amount`.

## MySQL reliability
If MySQL is temporarily unavailable during startup, game-log writes are queued in memory and flushed after a successful database connection. The server retries database initialization every 20 seconds when `DB_HOST` is configured.

## Required Hostinger environment variables
Set these in Hostinger for the Node app:
- DB_HOST
- DB_USER
- DB_PASSWORD
- DB_NAME
- DB_PORT (optional; defaults to 3306)

After changing environment variables, redeploy/restart the Node application.

If DB Status reports “DB_HOST is not configured”, the app cannot write to MySQL until those variables are configured.
