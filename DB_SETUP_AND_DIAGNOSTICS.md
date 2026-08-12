# GamesArena MySQL persistence

After deployment/restart, the server now:
1. Tests the Hostinger MySQL connection with `SELECT 1`.
2. Creates/migrates the application tables.
3. Synchronizes all questions from `questions.json` into the `questions` table.
4. Creates/updates the `host_users` and `payment_users` bootstrap accounts.
5. Records player registration/game results and payment submissions.

Hostinger environment variables required:
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD

After logging into the Host Console, open:
`/api/host/db-status`

It returns connection status and row counts for:
players, game_results, payments, host_users, payment_users, questions.

If the page says DB_HOST is not configured, the Node.js application is not receiving the environment variables.
If the connection fails, check the exact MySQL host/user/database/password in Hostinger.
