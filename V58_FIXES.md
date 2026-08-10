# v58 fixes

- Hard-fixed the game to exactly 5 questions.
- Hard-fixed the prize ladder to:
  Q1 ₹1,000
  Q2 ₹2,000
  Q3 ₹500
  Q4 ₹1,000
  Q5 ₹50,000
- TV and Host ladders render exactly five rows from a local fixed configuration.
- Fixed 50:50 state synchronization: the real contestant record and winner snapshot now both mark 50:50 as used.
- 50:50 removed options are stored server-side per question and sent in every state update.
- Removed options remain disabled after any UI/state re-render.
- Bumped TV/Host cache versions to v58.
