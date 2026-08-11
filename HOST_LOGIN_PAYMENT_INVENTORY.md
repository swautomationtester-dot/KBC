# GamesArena Host Login + Payment Inventory

## Host Console login

The Host Console is protected by `/api/host/login`.

Default username is `venkat`. The bundled default password is stored as a one-way scrypt hash in `server.js`; it is not stored as plaintext.

For production, set these Hostinger environment variables:
- `HOST_USERNAME`
- `HOST_PASSWORD_HASH`
- `HOST_PASSWORD_SALT`

The browser receives an HttpOnly session cookie and the Socket.IO host connection is only allowed to create/resume a host room after authentication.

## MySQL / Hostinger

Set:
- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT` (optional, defaults to 3306)

The server uses the four MySQL tables:
- `host_users` — Host Console credentials (scrypt hash + salt)
- `players` — player name, register number and phone
- `game_results` — play date/time, room, result and amount won
- `payments` — entry-fee/payment inventory and approval status

The server also performs a small compatibility migration on startup, adding the
extra status/room/result columns required by the live UI if they are missing.

## Payment flow

Host Console -> **Payment Inventory** -> display the QR code.

The QR opens `/payment.html`. The player manually enters:
- Player name
- Register number
- Phone number
- Date
- Entry fee
- Payment method
- Transaction/reference number
- Amount paid
- Notes

After submission, the record is stored in `payments` with `status=PENDING` and appears under **Pending Payments** in the Host Console. The host can select the registered player, review/edit the details and click **Save to Database**. Rejecting a submission marks it `REJECTED` rather than deleting it.

**Search Payments** accepts player name, phone number, or register number.

**Player Log** accepts the same search values and shows recorded quiz participation, date/time, room, result and amount won.

Quiz results are automatically written to `player_game_logs` when the host starts a contestant's quiz and when the contestant continues, wins, is eliminated, times out, or safely quits.
