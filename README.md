# Gossiptown

A cosy, catty reality show in a tiny storybook town. Ten women live in
Gossiptown. Every third evening they gather at the firepit and vote one of
them out of town. You are the newest arrival, and you are on the ballot too.

Make friends, form secret alliances, pass on (or invent) gossip, and steer the
vote. Every choice a cast member makes is decided by Jev from what she knows,
who she trusts, and what she heard today: where she goes, who she talks to,
whether she believes you, whether she keeps a promise, and who she votes for.
Claude writes what she says. Nothing is scripted.

## Play

The whole game runs in the browser. Open the published play link, press
**New Season**, and go.

| Key | What it does |
| --- | --- |
| Arrow keys / WASD | Walk |
| Enter | Talk to the woman next to you, say a line, or confirm |
| Tab | Open the Gossip Board (rumors you heard, what you told whom, how it spread, pacts, the cast, past votes) |
| P / Esc | Pause. Everything stops, including all Jev and Claude calls |

Speech appears as bubbles over people's heads. Stand close to a conversation to
hear every word; from a few steps away you only catch part of it. Cast members
walk up to you when they have a reason to.

On vote nights, walk up to the woman you want gone at the firepit and press
Enter twice. When three are left, the women already voted out pick the winner.

## Brains

- **Decisions (Jev).** Paste your Jev key in Settings on the title screen. The
  page calls Jev directly. If Jev can't be reached, a built-in stand-in makes
  decisions from each woman's personality so the game keeps going. The pill at
  the top right shows which one is running.
- **Dialogue (Claude).** On claude.ai the page asks Claude through your own
  account (you are asked once). Without it, each woman falls back to a small
  phrasebook in her own voice.

## Develop

Needs Node 20+.

    npm install
    npm run build      # bundles everything into one file: dist/index.html
    npm start          # optional local server on http://localhost:4747

The optional server keeps keys off the page: put `JEV_API_KEY=...` (and
optionally `ANTHROPIC_API_KEY=...`, otherwise it uses the `claude` CLI) in a
`.env` file. It forwards `/api/jev` and `/api/say` for the page.

Add `?fast` to the URL for 8x game speed with lighter graphics.

    node test/sim-smoke.mjs   # plays several days of the sim without a page
    node test/play.mjs        # headless browser run through talking and the Gossip Board
    node test/vote.mjs        # headless run of a vote night (FINALE=1 for the finale)

### Layout

- `src/core`: the game itself, no graphics. `cast.js` (the women, places,
  alliances), `sim.js` (encounters, rumors, alliances, walk-ups, votes),
  `game.js` (clock, days, vote nights, saving), `jev.js`, `voice.js`.
- `src/client`: the 3D town (three.js). `town.js` and `layout.js` build the
  town, `people.js` the characters, `bubbles.js` the speech, `hud.js` the
  HUD, tips and screens, `tracker.js` the Gossip Board, `vote.js` the vote
  ceremony, `main.js` ties it together.
