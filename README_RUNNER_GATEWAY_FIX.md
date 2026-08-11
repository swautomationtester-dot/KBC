# Runner / 504 Gateway Fix

The uploaded `KBC-main_4.zip` had a critical deployment problem: `server.js` did not call
`server.listen(...)`. That means Node could start without opening the HTTP port, so nginx
returned `504 Gateway Time-out`.

This version:
- binds the Express/Socket.IO server to `0.0.0.0:${PORT}`;
- starts HTTP before optional MySQL initialization can block;
- adds `/healthz` for deployment checks;
- keeps the Runner/Card Match-style Socket.IO namespace intact.

After deploying, restart the Node application. Test:
- `/healthz`
- `/runner.html`
- `/runner-tv.html`

If Hostinger provides a port through `PORT`, the app uses it automatically.
