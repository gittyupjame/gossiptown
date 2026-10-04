# Gossiptown

A cosy, catty reality show in a tiny storybook town. Ten women live in
Gossiptown. Every evening they gather at the firepit and vote one of
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

On vote nights, walk up to the woman you want gone at the firepit (or click
her card) and press Enter twice. When three are left, the women already voted
out pick the winner.

## Things to do

Everything is something you walk up to and press Enter on.

- **Gifts.** Pick up a cupcake at Marigold's, nail polish at the salon, cider
  at the Crooked Kettle, wildflowers in the garden or a trinket at the market.
  Then talk to someone and hand it over ("I brought you this"). Every woman
  has one thing she adores and one she can't stand, and the schemers wonder
  what you want for it.
- **Snooping.** Peek in a woman's mailbox on the lane. The first look can turn
  up her secret. Anyone nearby may see you, and if she's home she may be
  watching from the window. Get caught and she comes looking for you.
- **Anonymous notes.** Pin a note on the Whisper's board at the top of the
  square. It stays up for two days. Women who pass by read it, decide whether
  to believe it, and the nosy ones may work out that you wrote it.

## Cat fights

Arguments can turn into hair-pulling cat fights when the grudge, the insult
or the temper is real. Jev decides when it happens, who comes out on top, and
whose side everyone watching takes. Fights travel as gossip and count against
whoever started them at the vote.

A woman can come for you too: if you push her too far in a conversation, or
she storms over after catching you in her mail or reading your note about
her. You can also start one ("fight me"). In a fight, mash Enter to hold your
own or walk away to back down.

## Primrose's daily show

Once a day Primrose gathers the whole town somewhere for a show, and everyone
has to come. The show pill in the HUD says which one, where and when, and the
women head over half an hour before. There are nine formats, each with its own
place and rules:

| Show | Where | What happens |
|---|---|---|
| The Toast | the tavern | everyone raises a glass to someone, sweetly or not |
| Clear the Air | the plaza | call someone out to her face; she answers back |
| The Hot Seat | the town hall | one woman answers for the juiciest story about her, and the crowd heckles or defends |
| Who Would You Send Home? | the firepit | name the woman you'd vote out, out loud |
| Hot & Cold | the salon | Primrose hands you a target: one compliment, one dig |
| Morning Tea | the bakery | everyone spills one piece of gossip in public |
| The Soapbox | the market | stand on a crate and tell the town why you should stay |
| True Confessions | the garden | confess something or apologize to someone |
| The Roast | the smithy | roast someone; she can fire back |

Jev picks the show (Primrose plays producer and never repeats one from the
last three days), who gets the floor and what each woman does with it. You
always get a turn: type what you say in front of everyone. Every woman in the
crowd decides how it landed (loved it, laughed, shrugged, cringed, offended),
and that changes how she feels about the speaker, what she believes, who she
plans to vote for, and sometimes it turns into a cat fight on the spot. It all
goes into their memories, so it comes up again in conversations and at the
vote.

## Your look

After you pick a name you dress yourself for your debut with a 150 coin budget: 60 priced pieces across outfits, shoes, hair, hair color, hats, necklaces, earrings, glasses and bags, plus free colors and skin tone. Every piece carries style words (glam, classy, cute, boho, edgy, practical, sporty, frumpy, flashy, modest).

How you look matters because the women decide what they think of it, not a script:

- Every woman has her own taste and vanity (Celeste lives for glamour and hates being outshone, Brenna thinks fussy clothes are for show-offs, Hesper wants proper and modest). It is written into her Jev state.
- At the welcome party, and whenever a woman first sees a new outfit, Jev decides her verdict (hideous to stunning), her reaction (admires, sneers, jealous, thinks you copied her, wonders how you paid for it), whether she gossips about it and whether it makes you a threat.
- That verdict goes into every later decision about you: conversations, walk-ups (she may come over just to gush or to snipe), crowd reactions at Primrose's shows, overnight plans and the vote. Gossip about your outfit spreads like any other rumor.
- Wearing the same thing for days, dressing like one of the women, or looking far richer than anyone else are all things they notice.
- The producers add 40 coins every morning. Spend them at the clothes rack outside the salon; pieces you own are free to put back on. The Gossip Board shows what each woman thinks of your current look.

## Sound

Everything you hear is synthesized live in the browser with Web Audio (no sound files):

- Music for each part of the day (morning, evening, night), plus themes for the title screen, Primrose's show, the vote and cat fights, crossfading as things change.
- Stingers for big moments: gossip breaking, the show opening, the drumroll and elimination at the vote, the season finale.
- Every woman babbles in her own voice as her speech bubble types out, quieter the farther away she is.
- Crowd gasps, laughs and boos at the shows, footsteps that change with the ground, and town ambience (wind, the river, birds, crickets, the firepit, the clock tower).
- `M` mutes, Settings has music and sound sliders, and pausing silences everything.

## Brains

- **Decisions (Jev).** Paste your Jev key in Settings on the title screen. The
  page calls Jev directly. If Jev can't be reached, a built-in stand-in makes
  decisions from each woman's personality so the game keeps going. The pill at
  the top right shows which one is running.
- **Dialogue (Claude).** On claude.ai the page asks Claude through your own
  account (you are asked once). Without it, each woman falls back to a small
  phrasebook in her own voice.

## How the town thinks

Code keeps the books and Jev reads them before every decision (`src/core/mind.js`).

- **Feelings come with reasons.** Every change in how one woman feels about
  another carries a dated reason ("voted to send me home, day 3"). Strong
  feelings are hard to push further. Overnight they drift back toward where
  they started, unless fresh reasons hold them in place.
- **Memory.** The day's small talk fades. Betrayals, fights, lies, pacts and
  votes are never forgotten, and Jev sees them every time.
- **Rumors.** Each woman tracks how sure she is of a rumor and who told her.
  Hearing a story from a second, independent source makes her surer.
  Unconfirmed hearsay fades.
- **Plans.** Each woman keeps a short queue of plans. A promise isn't pushed
  aside by a passing idea, plans she never gets round to lapse, and a broken
  promise is remembered.
- **Vote plans.** A vote plan has a strength and a reason. A grudge or a
  promise outweighs a passing remark. Pact partners share their plans, so
  blocs form. Women notice who is coming for them.
- **One decision, then the next.** A conversation first settles what happened
  (a row, a pact, a piece of gossip), then how it landed. The outcome can't
  contradict the topic.
- **Your words.** What you type is read for intent, who it's about, and how it
  makes them look (`src/core/reading.js`). Negation is handled ("she's not
  fake"). Jev reads the words themselves; the reading steers the offline
  stand-in and gives Jev a hint.
- `node test/realism.mjs [days]` measures all of this over a few days.

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
    node test/acts-smoke.mjs  # gifts, snooping, notes and fights without a page
    node test/acts.mjs        # the same things in a headless browser
    node test/show-smoke.mjs  # every show format through the core (offline stand-in)
    FORMAT=roast node test/show.mjs   # headless run of one show
    node test/audio.mjs       # music and sound levels, pause and mute
    node test/looks-smoke.mjs # outfits, budget and first impressions without a page
    node test/looks.mjs       # the outfit chooser and clothes rack in a headless browser

### Layout

- `src/core`: the game itself, no graphics. `cast.js` (the women, places,
  alliances), `sim.js` (encounters, rumors, alliances, walk-ups, votes),
  `game.js` (clock, days, vote nights, saving), `events.js` (Primrose's shows), `wardrobe.js` (pieces and prices), `looks.js` (what the women make of your outfit), `jev.js`, `voice.js`.
- `src/client`: the 3D town (three.js). `town.js` and `layout.js` build the
  town, `people.js` the characters, `bubbles.js` the speech, `hud.js` the
  HUD, tips and screens, `tracker.js` the Gossip Board, `vote.js` the vote
  ceremony, `fight.js` the cat fight dust cloud, `spotlight.js` Primrose's show, `audio.js` all music and sound, `closet.js` the outfit chooser, `main.js` ties it together.
