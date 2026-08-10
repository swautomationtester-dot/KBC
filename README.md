# Perficient Office Quiz Arena v10

- Every room gets a unique TV/projector URL under `/screen/<random-token>?room=ROOM`.
- Every Fastest Finger round gets a new secure game token and a new QR code.
- The TV switches its QR from registration to the current Fastest Finger round automatically.
- Old Fastest Finger QR codes expire when a new round starts.
- The Fastest Finger QR is restricted server-side to the seven selected employee codes.
- Host dashboard shows the unique TV URL and current Fastest Finger QR.
- Existing v9 features remain: 1000+ Independence Day questions, host-only correct answer hints, participant status, live sequence/timer, restart same 7, and fresh Question 1 for each new contestant.

Render: `npm install` / `npm start`
Set `PUBLIC_URL=https://quiz.vrqaacademy.co.in` after the custom domain is connected.

\n## v11 fix\n- Fastest Finger winner remains on the participant/player page.\n- Winner receives the question and can select an answer on their phone.\n- The selected option is immediately displayed and highlighted on the TV/projector.\n- Other participants remain on the TV/projector view and cannot answer.\n- The host still controls when the new contestant game begins.\n
## v12
- Host must approve a locked contestant answer before reveal.
- TV highlights selected answer while waiting for approval.
- Host approval reveals green for correct and red for wrong.
- Wrong answer eliminates contestant after reveal.
- TV layout is responsive for projector, desktop and mobile-sized screens.

## v13 TV URL fix
- Unique TV URLs now resolve their room from the screen token, so `https://domain/screen/<token>` works without a `?room=` parameter.
- Invalid/expired screen tokens return a clear error.
- Host dashboard shows the TV URL as a clickable link.

\n## v14 TV screen fix\n- TV page assets now use absolute `/style.css` and `/tv.js` URLs, which is required when the TV is served at `/screen/<unique-token>`.
- This fixes the raw/un-styled TV page and ensures the TV JavaScript actually connects to the room.

\n## v15 TV live-state fix\n- TV/audience/roster sockets now receive the current room state immediately when they join an existing room.\n- This fixes the TV remaining on “Waiting for the Host” when the Host created the room before the TV opened.\n- TV screen URLs are now clean `/screen/<token>` URLs without a `?room=` parameter.\n- Added TV socket reconnect/error handling.\n
\n## v16\n- TV displays a QR code that opens the unique live TV screen URL for audience phones.\n- Player phone highlights the selected answer in gold while waiting for host approval.\n- Player phone highlights the locked answer green/red after host reveal.\n- Server generates and broadcasts the TV-screen QR code with each room.\n
\n## v17 TV rendering fix\n- Fixed the TV state-rendering crash caused by missing optional `joinLabel` / `joinUrlText` elements.\n- TV now continues rendering the live game even if optional UI elements are unavailable.\n- Added a visible TV error message instead of silently remaining on the initial Waiting screen.\n
\n## v18 participant screen\n- Participant answer turns green/red after host reveal.\n- Old answer result/points are cleared when the screen advances.\n- Participant screen now has a prize ladder, total points, and points earned display.\n- The current/reached ladder position is highlighted for the contestant.\n- Server includes question points with answer reveal events.\n
\n## v19 elimination result\n- Wrong-answer contestant sees their name, “Well Played”, and points secured on their phone.\n- The phone remains on the result screen for 30 seconds with a countdown before returning to the TV.\n- The TV elimination screen also shows the contestant name and points secured.\n
\n## v20 centered TV QR flow\n- When the unique TV URL is first opened, the TV shows the TV-screen QR code centered on the projector.\n- When the Host opens Registration, the TV switches to a centered registration QR with the room code.\n- Side QR cards are removed to keep the projector presentation clean.\n- The centered QR screen disappears automatically when the game moves into Fastest Finger or questions.\n
\n## v21 game flow\n- Correct answers are highlighted green and wrong answers red on the contestant phone.\n- Wrong-answer contestants receive a targeted 30-second farewell countdown that is not interrupted by the room moving to the next Fastest Finger.\n- Fastest Finger now gives 5 seconds of preparation time and shows all selected player names on the TV during the countdown.\n- Host selected-player panel continues to show all 7 selected names.\n- After a correct answer is approved, the next question starts automatically after 3 seconds; the host no longer needs to click Next Question.\n
\n## v22 TV reset flow\n- After a contestant fails, the TV waits 5 seconds, returns the room to Registration, reloads the TV page, and displays the centered registration QR + room code.\n- After the quiz is completed, the same 5-second reset returns the TV to Registration and the centered join QR.\n- When the Host opens Registration, the TV reloads once after 5 seconds and shows the centered join QR.\n- Session storage prevents repeated reload loops after the page reconnects.\n
\n## v23 participant table\n- TV now places the participant list directly below the prize ladder in the right-side rail.\n- Participant table shows number, name, employee code, pass/fail/fastest/winner status, and points.\n- The table scrolls within the TV side rail so it does not cover the main game area.\n
\n## v24 audience poll\n- Removed the “Add ?room=ABCD to this URL.” text from the TV waiting screen.\n- Host has an “Ask Audience Poll” button during a question.\n- When opened, the TV shows a large audience-poll QR code, the current question, and live percentage results.\n- Audience phones vote through the QR link; results update live on the TV.\n- Host can close the poll and the normal quiz screen returns.\n
\n## v25 admin security and home navigation\n- Home page options are now explicitly labeled Host Console, Join the Quiz, Quiz TV, Audience Poll, and Admin Login.\n- Admin uses a username + password login backed by an HttpOnly session cookie.\n- Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Render environment variables.\n- Question-bank GET/POST endpoints require an authenticated admin session.\n- Admin sessions expire after 8 hours.\n
\n## v26 TV QR fix\n- Fixed the Quiz TV lobby QR not displaying: `screenQr` is now included in every room state sent to the TV.\n- Added a clearer image fallback if a QR image cannot load.\n
\n## v27 TV robustness fix\n- Hardened Quiz TV DOM rendering against missing elements so a transient UI element cannot crash the whole TV state renderer.\n- Added safe class-list helpers and guards around QR, question, ladder, poll and fullscreen UI elements.\n- This addresses the “Cannot read properties of null (reading 'classList')” TV display error.\n
\n## v28 audience voting acknowledgement\n- Audience voting now uses a Socket.IO acknowledgement so the phone explicitly confirms whether the vote was accepted.\n- A submitted answer turns green and all options become disabled for that poll.\n- The status message confirms “Vote submitted” and live results continue updating.\n- QR audience links auto-join the room when opened with `?room=...`.\n- Invalid/closed polls now show a clear error instead of appearing to do nothing.\n
\n## v29 audience poll approval and live TV results\n- Fixed live TV poll counts: the TV now listens for the Socket.IO `poll` event and refreshes results immediately.\n- Audience Poll TV QR now displays the poll URL underneath it.\n- Contestant Audience Poll lifeline now creates a host approval request, matching the Answer Lock approve/reject workflow.\n- Host can Approve Poll or Reject Poll.\n- Contestant sees approval/rejection status.\n
\n## v30 — 10-question progressive randomized games\n- Every new contestant game uses exactly 10 questions.\n- Questions are freshly randomized from the 1,160-question Independence Day bank.\n- The sequence progresses easy → hard: 2 questions each at difficulty 1, 2, 3, 4 and 5.\n- The same source fact is not selected twice in one game.\n- Answer options are shuffled independently for every selected question, with the correct-answer index updated safely.\n- Points follow the 10-step prize ladder: ₹100, ₹200, ₹300, ₹500, ₹1,000, ₹2,000, ₹5,000, ₹10,000, ₹20,000, ₹50,000.\n- Manual/automatic question progression stops at question 10 and then finishes the game.\n
\n## v33 — 30-second winner celebration\nAfter the tenth correct answer, the room enters a 30-second winner celebration. The TV and winning participant screen display the champion's name, all-10-correct message, ₹50,000, countdown, and celebration audio controls.\n\nThe app looks for `/assets/kbc-theme.mp3`. The official KBC theme is copyrighted and is not included. If you have permission/licensing to use it, add your licensed recording at `public/assets/kbc-theme.mp3`; otherwise use music you are licensed to play. Browser autoplay can be blocked, so a Play Celebration Music button is provided.\n
\n## v34 — game-show visual refresh\nThe participant and TV question/answer screens now use angular, television-quiz-style question banners and A/B/C/D answer panels while retaining the existing Perficient teal/gold background and branding. Locked answers use gold, correct answers green, and wrong answers red. The participant lifeline buttons are presented in a compact top control strip.\n
\n## v35 — question wording and Fastest Finger timing\n- Removed the `Select the correct fact-answer pair for:` prefix from the Independence Day question bank (116 questions updated).\n- Fastest Finger letters are hidden during the pre-start countdown and appear only when the timer changes to GO.\n
\n## v36 — host question status cleanup\nRemoved the redundant `New contestant game • Question ...` status section from the Host Console while a question is active. The main host question card remains visible.\n
\n## v37 — Audience Poll live TV fix\nThe TV no longer exits its question renderer when an Audience Poll is active. This prevents the main TV area from becoming `Waiting for the Host`. Poll count events are also copied into TV state and re-rendered immediately so vote percentages and counts update live.\n
\n## v38 — Participant UI layout fix\nExpanded the participant game container independently from the registration form. The question, answer buttons, winner/elimination screens, score cards, and prize ladder now use the available phone/tablet width instead of being constrained by the old 620px registration wrapper. Added responsive breakpoints for tablets and phones and prevented horizontal overflow.\n
\n## v39 — Fixed 50,000-point total\nThe participant's **Total Points** is now always ₹50,000 (the maximum prize). Correct answers no longer accumulate the entire ladder (₹100+₹200+...); the contestant's score is set to the current question's prize value, so reaching question 10 correctly results in ₹50,000. Points Earned continues to show the contestant's current secured prize.\n

### v41 UI/validation update
- TV participant panel no longer displays PASS/FAIL.
- Room codes are 4 digits only.
- Participant names accept alphabetic characters and spaces only.
- Register numbers accept digits only.
- TV lobby/registration QR stage is centered and responsive.


### v42 TV screen UI polish
- Added cache-busting for TV CSS/JS so stale PASS/FAIL UI is not retained by the browser.
- Removed the TV page scrollbar on desktop and balanced the content around the right rail.
- Compact participant rail and centered Fastest Finger winner display.


## v46 fixes
- TV registration roster shows up to 30 users beside the QR code.
- Fastest Finger selection animates through registered users before revealing the selected 7.
- TV shows answer-lock state and selected answer while waiting for host approval.
- Audience Poll now correctly requests host approval, starts after approval, and streams live results.
- 50:50 and Audience Poll are mutually exclusive per question.
- Registered participant view stays in the live game UI instead of restoring the registration form.


## v48 Fastest Finger waiting-list fix
- Participants who are not selected in a Fastest Finger round remain on their participant screen.
- They are not redirected to the TV.
- Their registered/active status is preserved so the host can select them in a later Fastest Finger round.
- Timeout and non-winner result screens now return to a waiting state rather than redirecting.


## v49 Fastest Finger eligibility fix
- Once a player is selected as the quiz contestant, they are excluded from all subsequent Fastest Finger selections while they occupy the contestant seat.
- The player remains excluded during all question transitions.
- If the contestant is eliminated, the seat is cleared and they become eligible again for a future Fastest Finger round.
- If the contestant completes the game, they are marked completed and remain excluded.
- The TV selection roster therefore contains only players who are actually eligible for the next selection.

## v50 Participant quiz UI fix
- When the Fastest Finger winner enters the live quiz, the registration heading, room/name/register-number inputs, and Register & Join button are hidden.
- The live quiz area remains visible, including the contestant name, question, answers, and lifelines.
- The registration area is restored for waiting/non-contestant states.


## Expanded KBC Bank
The current `questions.json` contains 520 unique questions across South Indian Cinema, Indian Cinema, Politics & Indian Polity, Technology, and General Knowledge. The server tracks used question IDs per room to avoid repeats across contestants.
