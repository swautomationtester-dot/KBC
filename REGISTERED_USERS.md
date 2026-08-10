# Persistent Registered Users

Player registrations are stored in `data/registered-users.json`.

Stored fields:
- name
- employee/register number
- registeredAt
- registeredRoom

The employee/register number is globally unique. Once registered, it cannot be
used again after a refresh, new room, or server restart.

Keep the `data` directory on the server and make sure Node.js has write
permission. Back up `data/registered-users.json` as part of your application data.

The host can request the stored list with the authenticated Socket.IO event
`host:registeredUsers`; it is not exposed as a public HTTP endpoint.
