# Thistlewick

A reality show in a very small town. Nine women live in Thistlewick, and you
are the new girl. Every three days the whole town gathers at the bandstand in
the square and votes one woman out. Last one standing wins.

Every decision anyone makes comes from Jev: where she goes, who she talks to,
what she brings up, whether she believes a rumor, who she teams up with,
whether she means it, and who she votes for. Claude only writes the words,
after Jev has decided what they have to say.

## Play it

Needs Node 20+ and the `claude` CLI signed in (it writes everyone's lines).

    cd gossiptown
    echo "JEV_API_KEY=your-key-here" > .env
    npm run web          # then open http://localhost:4747

`node src/web.js --new` starts a fresh town; otherwise it carries on from
`save.json`.

The controls:

- **Walk:** arrow keys or WASD.
- **Talk:** walk up to someone and press Enter. She stops where she is. Type
  what you say in the bubble over your head and press Enter. Press Enter on an
  empty line to say goodbye.
- **Rumors:** Tab opens the rumor panel.
- **Pause:** P, or the button at the top right.

Women will also walk up to you and start a conversation when Jev decides they
want something from you: gossip, a deal, your vote, or a word about something
you did.

The game starts paused. While paused, nothing moves, the clock stops, and no
Jev or Claude calls are made. It also stops when no page is open, and each new
day waits until you start it. The 3D drawing uses three.js, loaded from
cdn.jsdelivr.net, so the page needs the internet.

## How a season goes

- **Days.** A day runs from 08:00 to 20:00 and lasts 6 real minutes. Everyone
  wakes at home. Every 15 game minutes Jev picks where each woman goes, from
  her job, the time, her mood, her plans and the game.
- **Talking.** Stand close to two women talking and you hear every word; a few
  steps away you only catch part of it. Stand too close and they may notice.
  When you talk to someone, Jev reads each line you say: is it gossip, a
  question, an offer to team up, a request to vote someone out? It decides if
  she believes you, catches you lying, agrees, or says yes while planning to
  break her word, and what gossip she hands over. If she decides to act on
  what you told her, she goes and does it.
- **Rumors.** What you say about someone becomes a rumor that spreads. It can
  change as it is passed on. If someone asks the woman it is about and finds
  out you made it up, people trust you less, and that becomes gossip too.
- **Nights.** Each woman lies awake and decides who she most wants gone.
- **The vote.** On vote days at 18:00 everyone gathers at the bandstand. The
  host, Mayor Honey Bellweather, opens the vote. You pick a name. Each vote is
  read out with a line from the woman who cast it, and a counter goes up over
  the woman named. A tie goes to the host. The one with the most votes says
  goodbye and walks out of town. If it's you, the game is over.

## The rumor panel (Tab)

- **The women:** how each one treats you, and what she has told you (that she
  is with you, who she says she'll vote out, who she says she wants gone).
  What people tell you is what they say. They might be lying.
- **What I've heard:** every rumor you overheard or were told, and from whom.
- **What I've said:** every story you started, who has heard it now, who
  believes it, and how it changed on the way.
- **About me:** what people are saying about you.
- **Votes:** every past vote, ballot by ballot.

## Settings (env or `.env`)

| Setting | Default | What it does |
| --- | --- | --- |
| `JEV_API_KEY` | none | Your TypeSafe key |
| `DAY_SECONDS` | 360 | Real seconds for one day, 08:00 to 20:00 |
| `VOTE_EVERY` | 3 | Days between votes |
| `CLAUDE_MODEL` | haiku | Model `claude -p` uses for lines |
| `CLAUDE_AT_ONCE` | 3 | How many `claude` calls run at the same time |
| `GOSSIP_FAKE_LLM` | off | `1` skips Claude and shows placeholders |
| `SHOW_JEV` | off | `1` logs Jev's read of each line you say |

With no key, or if Jev can't be reached, the game falls back to a rough offline
stand-in so you can still walk around. The stand-in can't understand what you
say, so play with the real Jev to judge the design.

`log.txt` records every Jev call: the state, the questions and the answers.
`node src/selftest.js` plays a scripted day and a vote without the clock.
There is also a bare terminal version: `npm start`.

## The files

- `src/world.js`: the cast, the places, starting feelings and secrets.
- `src/sim.js`: the town: moving, meeting, rumors, deals, the vote. Every
  decision is a Jev call.
- `src/llm.js`: every Claude prompt.
- `src/game.js`: the clock, the days, nights and the vote.
- `src/web.js`: the server for the 3D page.
- `src/public/`: the page. `map.js` is the town layout, `town.js` builds the
  town in 3D, `people.js` the women, `fx.js` the lighting and camera effects,
  `client.js` everything else.
