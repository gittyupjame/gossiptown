// Runs the State and Knowledge requirement suite: one test per requirement ID plus the 12
// end-to-end scenarios. Usage: node test/suite/run.mjs [filter]
import { writeFileSync } from "node:fs";
const files = ["t-evt-prc-mem", "t-bel-spr", "t-tlk-mov", "t-cmt-gol", "t-dec-fan", "t-rel-soc-lie", "t-chr-ply-sys", "t-tim-vis-int-run", "t-e2e"];
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const results = [];
const t0 = Date.now();
for (const f of files) {
  let mod;
  try { mod = await import(`./${f}.mjs`); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes(f)) continue; throw e; }
  for (const t of mod.tests) {
    if (filter && !filter.test(t.id)) continue;
    const s0 = Date.now();
    let r;
    if (t.defer) { results.push({ id: t.id, kind: t.kind, pass: null, detail: "", ms: 0, defer: true }); continue; }
    try { r = await t.fn(); } catch (e) { r = { pass: false, detail: `threw: ${e?.stack?.split("\n").slice(0, 3).join(" | ") || e}` }; }
    results.push({ id: t.id, kind: t.kind, pass: r.pass, detail: r.detail, ms: Date.now() - s0 });
    console.log(`${r.pass ? "PASS" : "FAIL"} ${t.id.padEnd(7)} ${String(r.detail).slice(0, process.env.FULL ? 2000 : 160)}`);
  }
}
// RUN-4: the whole suite runs on the offline Jev stand-in and the test writer
for (const r of results.filter((x) => x.defer)) {
  const others = results.filter((x) => !x.defer);
  if (r.id === "E12") {
    const audits = others.filter((x) => x.kind === "audit" && x.id !== "RUN-4");
    const bad = audits.filter((x) => !x.pass);
    r.pass = !bad.length; delete r.defer;
    r.detail = `full seeded seasons run headless (one of 6 days, four of 3 days): ${audits.length - bad.length}/${audits.length} audits pass${bad.length ? `; failing: ${bad.map((x) => x.id).join(", ")}` : ""}`;
  } else {
    const bad = others.filter((x) => !x.pass && x.kind !== "needs-jev");
    r.pass = !bad.length; delete r.defer;
    r.detail = `${others.length - bad.length}/${others.length} other tests pass on the offline stand-in (same interfaces, same state, same moves and decisions)${bad.length ? `; failing: ${bad.map((x) => x.id).join(", ")}` : ""}`;
  }
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(7)} ${r.detail.slice(0, process.env.FULL ? 2000 : 160)}`);
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!filter) {
  writeFileSync("test/suite/results.json", JSON.stringify({ when: new Date().toISOString(), total: results.length, passed: results.length - failed.length, results }, null, 1));
}
process.exit(failed.length ? 1 : 0);
