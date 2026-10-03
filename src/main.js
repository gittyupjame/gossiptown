// Thistlewick: a living gossip village. Text prototype, played in the terminal.
// Run:  JEV_API_KEY=... node src/main.js        (node src/web.js for the browser version)

import { createInterface } from "node:readline";
import { createGame } from "./game.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const game = createGame({
  say(text) {
    process.stdout.write("\r\x1b[K" + text + "\n");
    rl.prompt(true);
  },
  status(text) {
    rl.setPrompt(`${text} > `);
    rl.prompt(true);
  },
  quit: () => process.exit(0),
  ended: () => process.exit(0),
}, { fresh: process.argv.includes("--new") });

console.log(game.intro());
rl.on("line", (line) => game.handle(line));
rl.on("close", () => { game.save(); process.exit(0); });
rl.setPrompt(`${game.status()} > `);
rl.prompt();
game.start();
