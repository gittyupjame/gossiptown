// Bundles the browser game into one self-contained page: dist/index.html.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const out = await build({
  entryPoints: ["src/client/main.js"], bundle: true, format: "esm", target: "es2022",
  minify: true, write: false, legalComments: "none",
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("src/client/style.css", "utf8");
const html = readFileSync("src/client/index.html", "utf8").replace("/*CSS*/", () => css).replace("/*JS*/", () => js);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB`);
