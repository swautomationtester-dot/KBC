Randomly Select 7 / Fastest Finger crash fixed.

Root cause: startFastest(r) referenced socket variable s even though s is not
in scope. The Host:pick7 event awaits pick7(r), which then calls startFastest(r).

Fix: derive the public origin from r.joinUrl (created when the room is created),
with PUBLIC_URL as a fallback.
