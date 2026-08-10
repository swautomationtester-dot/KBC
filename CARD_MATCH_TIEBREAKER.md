# Card Match Tie-Breaker

When the Card Match board is completed:

1. Players are ranked by pairs collected.
2. If one player has more pairs, that player wins normally.
3. If two or more players have the same number of pairs, the server compares their **total active turn time**.
4. The player with the lowest total active turn time wins the tie-break.
5. If both pairs and total active turn time are exactly equal, the result remains a tie.

Time is measured server-side from the beginning of a player's turn until that turn resolves, so refreshing or reconnecting does not reset the accumulated time.
