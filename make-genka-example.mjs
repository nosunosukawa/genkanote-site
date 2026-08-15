#!/usr/bin/env node
/**
 * make-genka-example.mjs — 記事 okashi-genka.html の数値部分を生成する。
 *
 * 数値は**アプリと同じ計算エンジン（genka.js＝cost.tsのバンドル）を実行して**作る。
 * 手打ちするとサイトとアプリが食い違い、その食い違い自体が信用を失う
 * （pawweather-site / pooldose-site / rindo-finder-site と同じ型）。
 *
 * 使い方: node make-genka-example.mjs
 *   okashi-genka.html の <!-- data:start --> 〜 <!-- data:end --> を書き換える。
 *   マーカーの外は手書きの本文なので触らない。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(here, "genka.js"), "utf8"), ctx);
const G = ctx.Genka;

/* ============ 実例: 型抜きクッキー30枚・委託販売 ============ */

const ingredients = new Map([
  ["butter", { id: "butter", name: "バター（食塩不使用）", purchasePrice: 480, packAmount: 150, packUnit: "g", yieldRate: 1 }],
  ["flour",  { id: "flour",  name: "薄力粉",               purchasePrice: 320, packAmount: 1000, packUnit: "g", yieldRate: 1 }],
  ["sugar",  { id: "sugar",  name: "グラニュー糖",         purchasePrice: 280, packAmount: 1000, packUnit: "g", yieldRate: 1 }],
  ["egg",    { id: "egg",    name: "卵",                   purchasePrice: 320, packAmount: 10,   packUnit: "個", yieldRate: 0.85, pieceGrams: 60 }],
  ["almond", { id: "almond", name: "アーモンドプードル",   purchasePrice: 600, packAmount: 200,  packUnit: "g", yieldRate: 1 }],
]);

const recipe = {
  id: "cookie",
  name: "型抜きクッキー",
  lines: [
    { ref: { kind: "ingredient", id: "butter" }, amount: 150, unit: "g" },
    { ref: { kind: "ingredient", id: "flour" },  amount: 200, unit: "g" },
    { ref: { kind: "ingredient", id: "sugar" },  amount: 90,  unit: "g" },
    { ref: { kind: "ingredient", id: "egg" },    amount: 1,   unit: "個" },
    { ref: { kind: "ingredient", id: "almond" }, amount: 50,  unit: "g" },
  ],
  lossRate: 0.05,          // 割れ・端切れで5%
  labor: { minutes: 90 },  // 計量〜焼成〜袋詰めまで
  yieldCount: 30,
  packagingCostPerPiece: 12, // OPP袋＋シール
  feeRate: 0.3,              // 委託販売の手数料30%
  price: 180,                // 「なんとなく」の売価
};
const c = { ingredients, recipes: new Map(), defaultHourlyWage: 1100 };

const b = G.costBreakdown(recipe, c);
const priceConsign = G.roundPriceUp(G.suggestedPrice(recipe, c, 0.5), 10);
const priceDirect = G.roundPriceUp(G.suggestedPrice({ ...recipe, feeRate: 0 }, c, 0.5), 10);

const yen = (n) => "¥" + (Math.round(n * 10) / 10).toLocaleString("ja-JP");
const yen0 = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
const pct = (n) => Math.round(n * 100) + "%";

// 材料ごとの1バッチ原価（エンジンと同じ式: 購入価格/内容量 × 使用量/歩留率）
const lineCost = (id, amount, unit) => {
  const ing = ingredients.get(id);
  const grams = unit === "個" ? amount : amount; // 個はそのまま（packUnitも個）
  return (ing.purchasePrice / ing.packAmount) * (grams / ing.yieldRate);
};

const ingRows = recipe.lines
  .map((l) => {
    const ing = ingredients.get(l.ref.id);
    const cost = lineCost(l.ref.id, l.amount, l.unit);
    const note =
      ing.yieldRate < 1 ? `歩留${pct(ing.yieldRate)}（殻を除く）` : "";
    return `        <tr><th scope="row">${ing.name}</th>
          <td>${yen0(ing.purchasePrice)} / ${ing.packAmount}${ing.packUnit}</td>
          <td>${l.amount}${l.unit}</td><td>${yen(cost)}</td><td class="muted">${note}</td></tr>`;
  })
  .join("\n");

const block = `<!-- data:start（node make-genka-example.mjs が生成。手で直さない） -->
  <h2>例: 型抜きクッキー30枚を、委託販売で売る</h2>
  <p>前提はこうです。作業は計量から袋詰めまで<strong>90分</strong>、時給は
     <strong>${yen0(c.defaultHourlyWage)}</strong>で数えます。割れ・端切れの製造ロスを
     <strong>${pct(recipe.lossRate)}</strong>、包装（OPP袋＋シール）を
     <strong>1枚${yen0(recipe.packagingCostPerPiece)}</strong>、委託先の販売手数料を
     <strong>${pct(recipe.feeRate)}</strong>とします。</p>

  <div class="scroll">
    <table>
      <thead>
        <tr><th>材料</th><th>購入価格</th><th>使う量</th><th>この分の費用</th><th></th></tr>
      </thead>
      <tbody>
${ingRows}
      </tbody>
      <tfoot>
        <tr><th scope="row">材料費（バッチ計）</th><td></td><td></td>
          <td>${yen(b.batchMaterials)}</td><td class="muted">ロス${pct(recipe.lossRate)}込み</td></tr>
      </tfoot>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>

  <p>30枚で割ると、材料費は<strong>1枚あたり${yen(b.materialsPerPiece)}</strong>。
     1枚${yen0(recipe.price)}で売るなら、材料費だけの原価率は
     <strong>${pct(b.materialsPerPiece / recipe.price)}</strong>です。
     ——ここで計算をやめると「よく売れて、儲かっているはずなのにお金が残らない」が始まります。</p>

  <h2>全部入りの原価</h2>
  <div class="scroll">
    <table>
      <thead><tr><th>費目</th><th>1枚あたり</th><th>どこから来るか</th></tr></thead>
      <tbody>
        <tr><th scope="row">材料費</th><td>${yen(b.materialsPerPiece)}</td><td class="muted">歩留・製造ロス込み</td></tr>
        <tr><th scope="row">人件費</th><td>${yen(b.laborPerPiece)}</td><td class="muted">90分 × 時給${yen0(c.defaultHourlyWage)} ÷ 30枚</td></tr>
        <tr><th scope="row">包装費</th><td>${yen(b.packagingPerPiece)}</td><td class="muted">OPP袋＋シール</td></tr>
        <tr><th scope="row">販売手数料</th><td>${yen(b.feePerPiece)}</td><td class="muted">売価${yen0(recipe.price)}の${pct(recipe.feeRate)}</td></tr>
        <tr class="total"><th scope="row">合計</th><td><strong>${yen(b.totalPerPiece)}</strong></td>
          <td class="muted">売価${yen0(recipe.price)}に対して原価率<strong>${pct(b.costRate)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>

  <p>1枚${yen0(recipe.price)}のクッキーの原価は、材料費だけ見れば
     ${yen(b.materialsPerPiece)}（${pct(b.materialsPerPiece / recipe.price)}）。
     全部入れると<strong>${yen(b.totalPerPiece)}（原価率${pct(b.costRate)}）</strong>。
     手元に残るのは1枚あたり${yen(recipe.price - b.totalPerPiece)}です。</p>

  <h2>目標の原価率から売価を逆算する</h2>
  <p>原価率50%を守りたいとします。手数料は<strong>売価に比例して増える</strong>ので、
     「原価の2倍」では計算が合いません。売価 = （材料＋人件費＋包装）÷（目標原価率 − 手数料率）
     で逆算します。同じレシピでも:</p>

  <div class="scroll">
    <table>
      <thead><tr><th>売り方</th><th>手数料</th><th>原価率50%を守る売価</th></tr></thead>
      <tbody>
        <tr><th scope="row">直販（マルシェ・イベント）</th><td>0%</td><td><strong>${yen0(priceDirect)}</strong></td></tr>
        <tr><th scope="row">委託販売</th><td>${pct(recipe.feeRate)}</td><td><strong>${yen0(priceConsign)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>

  <p>同じクッキーでも、直販なら${yen0(priceDirect)}、手数料${pct(recipe.feeRate)}の委託なら
     <strong>${yen0(priceConsign)}</strong>。委託の手数料は「売価の30%」なので、
     売価を上げるほど手数料も増え、逆算の分母（50% − 30% = 20%）が小さくなるためです。
     委託で売るものと直販で売るものの値段が同じでよいはずがない——これが
     材料費だけの計算では絶対に見えない結論です。</p>
  <!-- data:end -->`;

const PAGE = join(here, "okashi-genka.html");
const page = readFileSync(PAGE, "utf8");
const next = page.replace(/<!-- data:start[\s\S]*?<!-- data:end -->/, block);
if (next === page && !page.includes("data:start"))
  throw new Error("okashi-genka.html にマーカーが無い");
writeFileSync(PAGE, next);
console.log(
  `更新した: 材料${yen(b.materialsPerPiece)}/枚 → 全部入り${yen(b.totalPerPiece)}/枚（原価率${pct(b.costRate)}）・` +
    `逆算売価 直販${yen0(priceDirect)} / 委託${yen0(priceConsign)}`
);
