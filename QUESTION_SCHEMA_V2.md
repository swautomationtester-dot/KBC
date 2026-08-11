# GamesArena Question Schema V2

All 541 questions in `questions.json` now expose a normalized KBC-style schema while retaining the legacy fields used by the existing game engine.

```js
{
  id: "IND-FLAG-001",
  category: "Indian History",
  difficulty: 1,
  difficultyLabel: "Easy",
  question: "Who designed the national flag of India?",
  text: "Who designed the national flag of India?", // legacy compatibility
  options: ["Rabindranath Tagore", "Pingali Venkayya", "Sarojini Naidu", "Madame Cama"],
  correctAnswer: 1,
  answer: 1, // legacy compatibility
  prize: null, // populated by the live game for the current question
  points: null, // populated by the live game for the current question
  explanation: "...",
  referenceImage: "/assets/question-references/science.svg",
  image: "/assets/question-references/science.svg", // legacy compatibility
  source: "...",
  imageCredit: "..." // legacy compatibility
}
```

## Runtime behavior

The server continues to use `text`, `answer`, `image`, and related legacy fields so existing Host/TV/participant screens remain compatible. It additionally sends `question`, `correctAnswer`, `prize`, `referenceImage`, and `source` in live question payloads.

`prize`/`points` are assigned when the five-question game is created, so the bank remains reusable across different prize ladders.

Questions that previously had no custom explanation/reference visual now have a safe fallback explanation and a category-appropriate GamesArena reference visual. Existing custom explanations/images are preserved.
