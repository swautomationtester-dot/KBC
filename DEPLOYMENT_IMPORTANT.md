# Important deployment note

This package combines:
- the latest MySQL persistence/backend fixes
- the latest modern animated GamesArena home UI

Upload/replace the contents of `KBC-main` in the Node.js application root. Do not leave an older `public/index.html` or old `public` directory in place.

After deployment:
1. Restart the Node.js application.
2. Open the site in an incognito/private window.
3. If using a CDN/proxy, purge its cache.
4. Hard refresh the browser.

The home page contains `data-gamesarena-home="modern-2026"` as a quick check that the new UI is being served.
