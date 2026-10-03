# Thistlewick

A living gossip village where every decision a villager makes comes from Jev.
You are a newcomer. Walk around, talk, eavesdrop, plant rumors, and watch what
your words do to the town. This is the text prototype: 8 villagers, real-time
days, no graphics yet.

## Run it

Needs Node 20+ and the `claude` CLI signed in (it writes the villagers' lines).

    cd gossip-town
    echo "JEV_API_KEY=your-key-here" > .env
    npm start            # continues save.json if there is one
    node src/main.js --new   # fresh town

Or play in the browser: `npm run web`, then open http://localhost:4747.
The clock only runs while the page is open.

With no key, or if Jev can't be reached, the game falls back to a rough offline
stand-in so you can still click around. The stand-in can't actually understand
what you say, so play with the real Jev to judge the design.

Settings (env or `.env`):

| Setting | Default | What it does |
| --- | --- | --- |
| `JEV_API_KEY` | none | Your TypeSafe key |
| `DAY_SECONDS` | 600 | Real seconds for one day, 08:00 to 20:00 |
| `CLAUDE_MODEL` | haiku | Model `claude -p` uses for dialogue |
| `SHOW_JEV` | off | `1` prints Jev's read of each line you say |
| `GOSSIP_FAKE_LLM` | off | `1` skips Claude and prints placeholders |

`log.txt` records every Jev call: the state, the questions and the answers.
`node src/selftest.js` plays a scripted day without the clock.

## Commands

    look, go <place>, talk <name> (then just type; "bye" to stop), listen,
    follow <name>, stop, give <name> <thing>, bag, note <name> <text>,
    do <anything>, map, journal, wait, stats, quit

## Design decisions (from Jamin's answers, Oct 3 2026)

| Topic | Decision |
| --- | --- |
| Town | 12 villagers in the full game (8 in this prototype), cozy fantasy, a top-down 2D pixel map later |
| Starting state | Villagers begin with secrets, feuds and friendships to uncover |
| Day | About 10 real minutes; the clock keeps running while you talk |
| Goal | Pure sandbox, over a season of about 30 days with a recap |
| You | A newcomer nobody trusts yet. Villagers can gossip about you, catch your lies, and run you out of town |
| Actions | Free typing, plus a wide set of actions (gifts, notes, following, eavesdropping, anything via `do`) |
| Words | `claude -p` writes all dialogue; Jev decides what each line has to do |
| Eavesdropping | You hear more the closer you are; `listen` hears everything but you may get caught |
| Off-screen talks | Jev decides the outcome; no words are written unless you are there |
| Consequences | Shoving fights, friendships and grudges, quitting and firing, moving away, banishment. No romance |
| People | Can leave town for good; newcomers may arrive (not built yet) |
| What you see | A social map you fill in from what you have seen and heard |

## How it works

Three layers: code keeps the state and the rules, Jev makes every judgement,
and Claude only writes words.

- **Every 15 game minutes** each villager gets a Jev call for where to go,
  and every pair of people in the same place gets one for whether they talk,
  what about, which piece of gossip gets passed on, how it changes their
  feelings, and whether an argument turns into a fight.
- **When gossip passes on**, a second Jev call decides whether the listener
  believes it, whether the teller exaggerated it (Claude then rewrites the
  rumor, so stories mutate), and what the listener does next: nothing, spread
  it, confront someone, or take it to the elder.
- **When you say something**, one Jev call reads your line: what you are
  doing, who it is about, how damaging and how plausible it is, whether they
  believe you, whether they catch you lying, how they now feel about you,
  their tone, and what they decide to do. Claude then writes their reply.
- **At night** each villager makes one big decision: carry on, quit, fire
  someone, leave town, make peace, or ask the elder to run you out. The elder
  weighs the town's mood about you.
- Answers are **sampled from Jev's probabilities**, not just the top one, so
  the same move can play out differently.
- Everything is **remembered**: who knows which rumor, how sure they are, who
  told them, and each person's recent memory, all of which feeds the next
  decisions. Saved to `save.json` after every step.

Feelings run from -3 to 3 for affinity and trust between every pair of
people, including you.

## Not built yet

The 2D map, the 30-day season and its ending recap, new people moving in,
jobs being taken over, and growing from 8 to 12 villagers.
