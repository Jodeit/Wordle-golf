# ⛳ Wordle Golf

Nine words. Nine holes. Your guesses are your strokes.

Every five-letter word gets a **par** based on how hard it actually is to crack.
Words stuffed with the letters your opener already tests — `STARE`, `LEARN`,
`CRANE` — play as short par 3s. Double letters and letters no opener ever
touches play as long par 5s. Solve in four on a par 5 and that's a birdie,
which is exactly what it feels like.

No build step, no dependencies, no server. Open `index.html` and play.

## Playing

- Guess the word. Each guess is one stroke.
- Solve it in fewer strokes than par for a birdie or better.
- Fail to solve in six and you take a lost ball: **8 strokes**.
- Nine holes make a round. Par is always 36, so cards from different courses
  are still comparable.

### How par is set

`rateWord()` in `js/course.js` scores each word:

| Factor | Effect |
| --- | --- |
| Repeated letter | plays **longer** (the classic Wordle wrecker) |
| `J Q X Z V K W` | plays **longer** — no common opener tests these |
| `Y F B H P G M` | plays slightly longer |
| Letters from `S T A R E L N C I O U D` | plays **shorter** |

Each course draws two par 3s, five par 4s and two par 5s from those buckets.

### The view

The hole is the page. A perspective view from behind your ball fills the
screen and the game floats over it on glass, with a small overhead inset in
the corner for where the ball actually lies.

`js/perspective-view.js` is a real pinhole projection, not a painted
backdrop: world coordinates are yards, the camera stands behind the ball at
eye height and yaws to keep the pin centred. Everything follows from that —
walk up the fairway and the green grows, the flag rises, the fairway edges
spread past you. Circles on the ground (greens, bunkers) are projected point
by point, so they sit flat in the plane instead of looking like stickers.

How far back the camera sits is solved per layout rather than fixed, because
the game panel leaves a band of very different heights on a phone versus a
desktop. Light tracks the round: the first hole is played at dawn, the turn
at midday, the ninth into a low sun.

### How a guess becomes a shot

Two separate questions, because they are separate in golf too.

**Where the ball ends up** is how much is still unknown — literally, how many
answers are still possible. Counting greens cannot tell a constraining three
greens from a loose one: `-ONE-` leaves one word and is a tap-in, while three
greens elsewhere can leave fifty and a long approach. Greys need no special
weighting either; eliminating letters shrinks the field by exactly as much as
it actually helps. On a 400-yard par 4:

| Answers still possible | Carry | Left |
| --- | --- | --- |
| ~350 | ~120 yds | 280 — a pop-up |
| ~90 | ~195 yds | 205 — a mediocre drive |
| ~30 | ~250 yds | 150 — down the middle |
| ~6 | ~320 yds | 80 — a wedge to the flag |
| 1 | ~398 yds | 2 — you know it; tap it in |

Candidates are counted over the **answer** pool, not the guess list. You can
guess `GONER`; the game will never choose it. That means the model sometimes
knows you are down to one word while you are still weighing two or three
plausible ones — it is measuring the strength of your position, not your
confidence. The in-game help says as much, so it is information you have too.

**How the shot was struck** comes from what *this* swing added, measured
against how much was left to find out. So the same gain is a wasted swing off
the tee and a great one when you are nearly there. A guess that teaches you
nothing is a shank even when you are sitting in the middle of the fairway,
and a guess that cracks the word open from a bad lie is a heroic recovery.

Solve it and the ball is in the cup, wherever it was lying.

Shots are seeded per hole and per guess, so replaying a round redraws it
exactly the same way.

## Courses and leaderboards

Every course has a name and a short code (`7KQ2F`). **The code is the course** —
type the same code and you get the same nine words, the same pars, the same
yardages. Send a friend the code (or the link, `?course=7KQ2F`) and you're
playing the same track.

There's no server here, so a leaderboard lives in your own browser. It travels
by share card: finish a round, copy the card, paste it into the group chat.

```
⛳ Wordle Golf — Bramble Commons Golf & Country Club
Course 7KQ2F · Par 36
Jo — 37 (+1)
⚪🐦⚪🟨⚪🟨🟨🐦⚪
Play it: https://…/?course=7KQ2F
```

Paste someone else's card into **🏆 → Add a friend's score** and their round
joins your board for that course. Because the code determines the pars, an
imported card reconstructs their real strokes rather than guessing at them.

> A share card is a claim, not a receipt. Cards are checked for internal
> consistency — right course, right number of holes, a total that matches the
> hole-by-hole marks — so a casually edited one gets rejected. Someone
> determined to fake a card still can. It's a game with your friends.

## Running it

```sh
python3 -m http.server 8000     # any static server will do
open http://localhost:8000
```

It's ES modules, so it needs to be served over http — opening the file
directly with `file://` won't work.

> The answer list seeds course generation. Changing its contents or its order
> repoints every course code that has already been shared, so the tests pin
> both, along with the nine holes that code `7KQ2F` produces.

## Tests

```sh
node test/run.mjs
```

Covers the duplicate-letter marking rule, par ratings, course determinism, the
shot model, share-card round-tripping and tamper rejection.

## Layout

| File | What's in it |
| --- | --- |
| `js/words.js` | Answer bank (seeds courses — do not edit) and legal guesses |
| `js/course.js` | Seeded RNG, par ratings, course names, hole geometry |
| `js/game.js` | Wordle marking, golf scoring, the shot model |
| `js/perspective-view.js` | The view down the hole — projection, scenery, light |
| `js/hole-view.js` | The overhead inset |
| `js/celebrate.js` | Confetti for birdies, rain for bogeys |
| `js/leaderboard.js` | Local storage, share cards, importing |
| `js/app.js` | UI glue |

## Screens

Phone-first: the stacked layout is the base, and a two-column layout kicks in
at 700px of width. Verified with nothing off-screen and no page scrolling on
small phones (375x667), tall phones (393x852), landscape phones (852x393),
tablets and desktop. Landscape phones need the two-column layout more than
desktops do — stacked, the keyboard falls off the bottom of the screen.

The on-screen keyboard is always there, and a physical keyboard works
everywhere too.

## Known limits

- Answers come from ~950 hand-picked ordinary words, so no hole is ever an
  obscurity. Guesses are checked against a full English dictionary (~12,650
  five-letter words, comparable to Wordle's own guess list).
- That dictionary accepts crude words as guesses, the same way Wordle does.
  They can never be answers, and the game never shows them back to you — but
  they won't be rejected if typed.
- Par comes from letter statistics, not from how people actually score. It
  ranks words sensibly, but it isn't calibrated against real play data.
- Leaderboards and in-progress rounds live in `localStorage` — they're
  per-browser, and private windows won't keep them.

## Hosting

It's a static site with no build step, so GitHub Pages can serve the
repository root as-is — no Actions workflow needed. In **Settings → Pages**,
set the source to *Deploy from a branch*, pick the branch, and choose
`/ (root)`.

`.nojekyll` is there to stop Pages running the files through Jekyll.

Project sites are served from a subpath (`https://<user>.github.io/Wordle-golf/`)
rather than the domain root. Every asset path is relative and share links are
built from `window.location`, so course links keep working under the subpath.
