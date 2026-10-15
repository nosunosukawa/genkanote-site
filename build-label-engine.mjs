#!/usr/bin/env node
/**
 * build-label-engine.mjs — アプリの表示計算（原材料名・アレルゲン・栄養）を label-engine.js に束ねる。
 *
 * genka.js（原価）と同じ考え方: 記事に載せる数値・文字列は、アプリと同じコードを実行して作る。
 * esbuild がこの Mac に無いので、アプリ同梱の typescript で1ファイルずつ CommonJS に落とし、
 * 小さな require で束ねる。
 *
 * 使い方: node build-label-engine.mjs [アプリの src/logic のパス]
 *   既定: ../../mobile/genkanote/src/logic
 * 出力: label-engine.js（手で編集しない）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const logic = resolve(process.argv[2] ?? join(here, "../../mobile/genkanote/src/logic"));
const require = createRequire(join(logic, "../../package.json"));
const ts = require("typescript");

const mods = ["cost", "density", "allergens", "label", "nutrition"];
const parts = mods.map((m) => {
  const src = readFileSync(join(logic, `${m}.ts`), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return `"./${m}": function (module, exports, require) {\n${out}\n}`;
});

const bundle = `/* 原価ノートの表示計算 — mobile/genkanote/src/logic/{${mods.join(",")}}.ts を束ねたもの（手で編集しない）
   再生成: node build-label-engine.mjs */
var GenkaLabel = (() => {
  const defs = {
${parts.join(",\n")}
  };
  const cache = {};
  function req(name) {
    if (cache[name]) return cache[name].exports;
    const module = { exports: {} };
    cache[name] = module;
    defs[name](module, module.exports, req);
    return module.exports;
  }
  return Object.assign({}, req("./allergens"), req("./label"), req("./nutrition"));
})();
`;
writeFileSync(join(here, "label-engine.js"), bundle);
console.log(`label-engine.js を書いた（${mods.join(", ")}）`);
