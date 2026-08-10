# Integrated session updates

This build incorporates the UI/game-flow changes requested during the session:

- 5-question game flow with a ₹50,000 final prize.
- 4-digit numeric room codes.
- Alphabet-only participant names.
- Numeric-only register numbers.
- Registration form disappears once a participant enters the live quiz.
- Players who lose Fastest Finger remain on the same waiting screen for later rounds.
- Players who enter the main quiz are marked as played and excluded from future Fastest Finger selections.
- Eliminated/completed players are excluded from future selections.
- Fastest Finger selection continues to use up to the first 30 registered players on the TV during registration.
- Persistent 50:50 state: two wrong answers are removed and the lifeline stays disabled for that participant for the entire quiz.
- Audience poll counts are normalized to A/B/C/D and persist until the host closes the poll.
- Audience poll results are shown live on contestant, host, and TV screens.
- Locked answers and revealed answer results are shown on the TV.
- TV question/answer typography is reduced to match the participant screen more closely.
- TV audience poll is a compact 2x2 panel and no longer covers the whole screen.
- TV registration/side-rail overflow is constrained to avoid the highlighted scrollbar issue.
- Question audio loading remains wired to /assets/kbc-question.mp3 for each new question.

Place the actual `kbc-question.mp3` file in `public/assets/` if it is not already present.
