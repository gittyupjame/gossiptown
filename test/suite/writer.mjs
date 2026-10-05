// A deterministic stand-in for Claude in tests. It writes a line that does what the intent
// asks and returns the moves that line makes, each span copied from the line, the way Claude
// is asked to. Player lines are read by `extract`, from a table the test fills in (or from
// the moves this writer gave a line it wrote itself).

export function makeWriter() {
  const W = { s: null, said: new Map(), player: new Map(), calls: [], down: false, kinds: {} };
  const first = (id) => (id === "player" ? W.s.player.name : W.s.people[id]?.name.split(" ")[0] || id);
  const seg = (parts) => {
    const line = parts.map((p) => p.text).join(" ");
    const moves = parts.flatMap((p) => (p.moves || []).map((m) => ({ span: p.text, ...m })));
    return { line, moves };
  };
  const claim = (about, text, extra = {}) => ({ text: `${text.replace(/\.$/, "")}.`, moves: [{ type: "claim", about: first(about), content: text, stance: "affirm", ...extra }] });
  function turn(ctx) {
    const s = W.s, P = ctx.v.id, O = ctx.listener || null;
    const plan = ctx.plan || null, meta = plan?.meta || {}, kind = meta.kind || plan?.pick || null;
    const parts = [];
    for (const r of plan?.req || []) {
      if (r.startsWith("say yes")) parts.push({ text: "Yes, fine, I'll do it.", moves: [{ type: "agreement", content: "agrees to do it" }] });
      else if (r.startsWith("turn down")) parts.push({ text: "No, I won't do that.", moves: [{ type: "refusal", content: "refuses" }] });
      else if (/honestly: you mean to vote out (.+)$/.test(r)) { const n = r.match(/vote out (.+)$/)[1]; parts.push(claim(P, `${first(P)} is voting out ${n}`, { vote_target: n })); }
      else if (/with a lie: say you're voting out (.+)$/.test(r)) { const n = r.match(/voting out (.+)$/)[1]; parts.push(claim(P, `${first(P)} is voting out ${n}`, { vote_target: n, lie: true })); }
      else if (r.startsWith("answer honestly: you haven't decided")) parts.push({ text: "Honestly I haven't decided yet.", moves: [] });
      else if (r.startsWith("dodge")) parts.push({ text: "Wouldn't you like to know.", moves: [] });
    }
    const it = meta.item && s.people[P]?.agenda?.find((x) => x.id === meta.item);
    const k = kind === "agenda" && it ? (it.kind === "spread" || it.kind === "report" ? "spread" : it.kind) : kind;
    const rid = meta.rumor || it?.rumor || (ctx.intent?.match(/\[(r\d+)\]/) || [])[1];
    const r = rid && s.rumors[rid];
    const target = meta.target || it?.target || null;
    switch (k) {
      case "spread": case "warn": case "tell":
        if (r && meta.embellishing) parts.push(claim(r.about || P, `${r.text.replace(/\b(might|maybe|apparently|probably|I think|supposedly)\b ?/gi, "").replace(/\.$/, "")}, and she has done it more than once, the whole town knows it`, { belief: rid }));
        else if (r) parts.push(claim(r.about || P, r.text, { belief: rid }));
        break;
      case "ask": if (r) parts.push({ text: `Is it true that ${r.text.replace(/\.$/, "")}?`, moves: [{ type: "question", content: `asks whether ${r.text}`, about: first(r.about || O) }] }); break;
      case "confront": parts.push({ text: `I know what you did and I'm sick of it.`, moves: [{ type: "accusation", about: first(O), content: r ? r.text : `${first(O)} wronged ${first(P)}` }] }); break;
      case "probe": parts.push({ text: "So who are you voting for tonight?", moves: [{ type: "question", content: "asks who she is voting for", about: first(O) }] }); break;
      case "lobby": case "vote": if (target) parts.push({ text: `I'm voting out ${first(target)} and you should too.`, moves: [{ type: "plan", content: `vote out ${first(target)}`, kind: "vote", target: first(target) }, { type: "request", content: `vote out ${first(target)}`, kind: "vote", target: first(target), to: first(O) }] }); break;
      case "lie_vote": if (target) parts.push({ text: `I'm voting out ${first(target)} tonight.`, moves: [{ type: "claim", about: first(P), content: `${first(P)} is voting out ${first(target)}`, vote_target: first(target), lie: true }, { type: "plan", content: `vote out ${first(target)}`, kind: "vote", target: first(target) }] }); break;
      case "recruit": parts.push({ text: "You and me, a secret pact. We vote together.", moves: [{ type: "request", content: "a secret pact to vote together", kind: "pact", to: first(O) }] }); break;
      case "plant": if (target) parts.push(claim(target, `${first(target)} has been skimming money from the till`, { lie: true })); break;
      case "insult": parts.push({ text: "You really are the worst, you know that.", moves: [{ type: "insult", to: first(O), content: "calls her the worst" }] }); break;
      case "threaten": parts.push({ text: "Cross me again and you'll regret it.", moves: [{ type: "threat", to: first(O), content: "threatens her" }] }); break;
      case "flatter": parts.push({ text: "You look amazing today, honestly.", moves: [{ type: "compliment", to: first(O), content: "says she looks amazing" }] }); break;
      case "dish": if (target) { const who = target === "player" ? s.player.name : first(target); parts.push(meta.sign < 0 ? { text: `Between us, ${who} is a snake. I don't trust her one bit.`, moves: [{ type: "insult", about: who, content: `calls ${who} a snake` }] } : { text: `Honestly, I really like ${who}. She's good people.`, moves: [{ type: "compliment", about: who, content: `speaks well of ${who}` }] }); } break;
      case "apologize": parts.push({ text: "I'm sorry, I really am.", moves: [{ type: "apology", to: first(O), content: "apologizes" }] }); break;
      case "deny": parts.push({ text: "That is not true at all.", moves: r ? [{ type: "claim", about: first(r.about || P), content: r.text, stance: "deny", ...(ctx.lie ? { lie: true } : {}) }] : [] }); break;
      case "admit": if (r) parts.push(claim(r.about || P, r.text)); break;
      case "laugh_off": parts.push({ text: "Oh please, that's hilarious.", moves: [] }); break;
      case "call_out": parts.push({ text: `You're lying to me${meta.quote ? `, you told me ${meta.quote}` : ""}.`, moves: [{ type: "accusation", about: first(O), content: `${first(O)} is lying` }] }); break;
      case "call_favor": parts.push({ text: "You owe me one, so back me up tonight.", moves: [{ type: "request", content: "back her up at the vote", kind: "other", to: first(O) }] }); break;
      case "talk": if (it?.target) { const tp = it.topic && Object.values(s.people).find((x) => it.topic.includes(x.name.split(" ")[0])); parts.push({ text: `Can we talk about ${it.topic || first(it.target)}?`, moves: [{ type: "question", content: `asks about ${it.topic || first(it.target)}`, about: tp ? first(tp.id) : first(it.target) }] }); } break;
      case "end": parts.push({ text: "Anyway, I've got to run.", moves: [] }); break;
      default:
        if (!plan && ctx.intent) {
          // a turn at Primrose's show: the intent says what to do, in words
          const it2 = ctx.intent, nameIn = (re) => (it2.match(re) || [])[1];
          const who = nameIn(/(?:about|to|out|roast|heckle|for|at|send) ([A-Z][a-z]+)/);
          if (/genuinely lovely|stick up for/.test(it2) && who) parts.push({ text: `${who} is honestly the best of us.`, moves: [{ type: "compliment", to: who, about: who, content: `praises ${who}` }] });
          else if (/backhanded|roast|heckle|fire right back/.test(it2) && who) parts.push({ text: `Oh ${who}, bless your heart, you try so hard.`, moves: [{ type: "insult", to: who, about: who, content: `mocks ${who}` }] });
          else if (/^call out/.test(it2) && who) parts.push({ text: `${who}, everyone knows what you did.`, moves: [r ? { type: "accusation", about: r.about === "player" ? s.player.name : first(r.about) || who, content: r.text, belief: rid } : { type: "insult", to: who, about: who, content: `calls ${who} out` }] });
          else if (/^apologize/.test(it2) && who) parts.push({ text: `${who}, I'm sorry.`, moves: [{ type: "apology", to: who, content: "apologizes" }] });
          else if (/keep you around/.test(it2)) parts.push({ text: "Please keep me here, I've got so much more to give.", moves: [{ type: "request", to: "everyone", content: "asks the town to keep her", kind: "other" }] });
          else if (/send (\w+) home/.test(it2) && who) parts.push({ text: `I'd send ${who} home tonight.`, moves: [{ type: "plan", content: `vote out ${who}`, kind: "vote", target: who }] });
          else if (/^deny/.test(it2) && r) parts.push({ text: "That is a lie.", moves: [{ type: "claim", about: first(r.about || P), content: r.text, stance: "deny", ...(ctx.lie ? { lie: true } : {}) }] });
          else if (r) parts.push(claim(r.about || P, r.text, { belief: rid }));
        } else if (!plan && r) parts.push(claim(r.about || P, r.text, { belief: rid }));
    }
    if (ctx.lie && !parts.some((p) => p.moves?.some((m) => m.lie))) {
      const ab = ctx.lie.target && ctx.lie.about === P ? P : ctx.lie.about;
      if (ab && W.s.people[ab] || ab === "player") parts.push(claim(ab, ab === P && ctx.lie.target ? `${first(P)} is voting out ${first(ctx.lie.target)}` : `${first(ab)} has been skimming money from the till`, { lie: true, ...(ctx.lie.target ? { vote_target: first(ctx.lie.target) } : {}) }));
    }
    if (!parts.length) parts.push({ text: "Lovely weather for it, isn't it.", moves: [] });
    // asked again, strictly: claim only what she holds (Claude is told the same)
    if (ctx.strict) for (const p of parts) p.moves = (p.moves || []).filter((m) => !["claim", "accusation", "secret"].includes(m.type) || m.lie || (m.belief && ctx.allowed.includes(m.belief)) || W.s.people[P]?.name.split(" ")[0] === m.about);
    if (ctx.strict) for (const p of parts) if (p.moves.length === 0 && /\.$/.test(p.text) && p.text.length > 30) p.text = "Never mind, forget I said anything.";
    const out = seg(parts);
    out.moves.push({ type: "tone", content: k === "insult" || k === "threaten" || k === "confront" ? "hostile" : k === "flatter" ? "sweet-but-fake" : "friendly" });
    return out;
  }
  W.prompts = []; W.turns = []; W.hook = null;
  W.fn = async (prompt, meta) => {
    W.calls.push(meta?.kind);
    W.prompts.push(prompt); if (W.prompts.length > 4000) W.prompts.shift();
    W.kinds[meta?.kind] = (W.kinds[meta?.kind] || 0) + 1;
    if (W.down) return null;
    if (meta?.kind === "turn") { W.turns.push({ speaker: meta.speaker, prompt, setting: meta.ctx.setting }); if (W.turns.length > 3000) W.turns.shift(); if (W.hook) { const h = W.hook(meta.ctx); if (h) { W.said.set(h.line, h.moves); return JSON.stringify(h); } } const o = turn(meta.ctx); W.said.set(o.line, o.moves); return JSON.stringify(o); }
    if (meta?.kind === "extract") {
      const m = W.player.get(meta.line) || W.said.get(meta.line);
      if (typeof m === "function") return JSON.stringify({ moves: m(W.s) });
      return JSON.stringify({ moves: m || [{ type: "tone", content: "neutral" }] });
    }
    if (meta?.kind === "ballots") return JSON.stringify({ lines: meta.items.map((it) => ({ by: first(it.id), line: `${it.target}. ${it.why.split(";")[0]}.`, moves: [] })) });
    return "{}";
  };
  return W;
}
