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

### The map

The overhead view plots each guess as a golf shot. Greens count double,
yellows count half — the more the board lights up, the closer to the pin you
finish. A drive that catches two letters is a decent poke down the middle; one
that catches three leaves you a wedge. Spray a guess full of dead letters and
you'll find the rough, the sand, or the trees.

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
| `js/hole-view.js` | The overhead hole renderer |
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
