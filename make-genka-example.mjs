#!/usr/bin/env node
/**
 * make-genka-example.mjs — サイトに載る数値と図を、アプリと同じ計算エンジンから生成する。
 *
 * 数値は**アプリと同じ計算エンジン（genka.js＝cost.tsのバンドル）を実行して**作る。
 * 手打ちするとサイトとアプリが食い違い、その食い違い自体が信用を失う
 * （pawweather-site / pooldose-site / rindo-finder-site と同じ型）。
 *
 * 使い方: node make-genka-example.mjs
 *   マーカー <!-- 名前:start ... --> 〜 <!-- 名前:end --> の中だけを書き換える。
 *   マーカーの外は手書きの本文なので触らない。
 *
 *   okashi-genka.html : data          記事本文の表
 *   index.html        : fig-hero      ヒーローの図（伝票＋ラベル）
 *                       fig-steps     積み上げの図
 *                       fig-price     逆算売価の図
 *   support.html      : tbl-cost      内訳の表（図の数値の表版）
 *                       tbl-steps     積み上げの表
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

const ing = (yieldEgg) =>
  new Map([
    ["butter", { id: "butter", name: "バター（食塩不使用）", purchasePrice: 480, packAmount: 150, packUnit: "g", yieldRate: 1 }],
    ["flour",  { id: "flour",  name: "薄力粉",               purchasePrice: 320, packAmount: 1000, packUnit: "g", yieldRate: 1 }],
    ["sugar",  { id: "sugar",  name: "グラニュー糖",         purchasePrice: 280, packAmount: 1000, packUnit: "g", yieldRate: 1 }],
    ["egg",    { id: "egg",    name: "卵",                   purchasePrice: 320, packAmount: 10,   packUnit: "個", yieldRate: yieldEgg, pieceGrams: 60 }],
    ["almond", { id: "almond", name: "アーモンドプードル",   purchasePrice: 600, packAmount: 200,  packUnit: "g", yieldRate: 1 }],
  ]);
const ingredients = ing(0.85);

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
const cc = (ings) => ({ ingredients: ings, recipes: new Map(), defaultHourlyWage: 1100 });
const c = cc(ingredients);
const TARGET_RATE = 0.5;   // 死守ライン（目標の原価率）

const b = G.costBreakdown(recipe, c);
const priceConsign = G.roundPriceUp(G.suggestedPrice(recipe, c, TARGET_RATE), 10);
const priceDirect = G.roundPriceUp(G.suggestedPrice({ ...recipe, feeRate: 0 }, c, TARGET_RATE), 10);
const verdict = G.costVerdict(b.costRate, TARGET_RATE); // "ok" | "warn" | "over"
const leftover = recipe.price - b.totalPerPiece;

/* 積み上げ: 同じレシピに条件を1つずつ足して再計算した累計 */
const stepDefs = [
  ["材料費だけ", { ...recipe, lossRate: 0, labor: { minutes: 0 }, packagingCostPerPiece: 0, feeRate: 0 }, ing(1)],
  ["＋歩留まり・ロス", { ...recipe, labor: { minutes: 0 }, packagingCostPerPiece: 0, feeRate: 0 }, ingredients],
  ["＋人件費", { ...recipe, packagingCostPerPiece: 0, feeRate: 0 }, ingredients],
  ["＋包装費・手数料", { ...recipe }, ingredients],
];
const steps = stepDefs.map(([label, r, ings]) => {
  const x = G.costBreakdown(r, cc(ings));
  return { label, total: x.totalPerPiece, rate: x.totalPerPiece / recipe.price };
});

// 費目は小数第1位まで揃える（等幅・右揃えで桁が動かないこと）
const yen = (n) =>
  (Math.round(n * 10) / 10).toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
const yen0 = (n) => Math.round(n).toLocaleString("ja-JP");
const pct = (n) => (Math.round(n * 1000) / 10).toFixed(1);
const pct0 = (n) => Math.round(n * 100);

/* ============ マーカーの書き換え ============ */

function writeBlock(file, name, inner) {
  const p = join(here, file);
  const src = readFileSync(p, "utf8");
  const re = new RegExp(`(<!-- ${name}:start[^>]*-->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(src)) throw new Error(`${file}: マーカー ${name} が無い`);
  const next = src.replace(re, `$1\n${inner}\n  $2`);
  if (next !== src) writeFileSync(p, next);
  return next !== src;
}

/* ============ 記事 okashi-genka.html ============ */

const lineCost = (id, amount) => {
  const g = ingredients.get(id);
  return (g.purchasePrice / g.packAmount) * (amount / g.yieldRate);
};

const ingRows = recipe.lines
  .map((l) => {
    const g = ingredients.get(l.ref.id);
    const cost = lineCost(l.ref.id, l.amount);
    const note = g.yieldRate < 1 ? `歩留${pct0(g.yieldRate)}%（殻を除く）` : "";
    return `        <tr><th scope="row">${g.name}</th>
          <td>¥${yen0(g.purchasePrice)} / ${g.packAmount}${g.packUnit}</td>
          <td>${l.amount}${l.unit}</td><td>¥${yen(cost)}</td><td class="muted">${note}</td></tr>`;
  })
  .join("\n");

const articleBlock = `  <h2>例: 型抜きクッキー30枚を、委託販売で売る</h2>
  <p>前提はこうです。作業は計量から袋詰めまで<strong>90分</strong>、時給は
     <strong>¥${yen0(c.defaultHourlyWage)}</strong>で数えます。割れ・端切れの製造ロスを
     <strong>${pct0(recipe.lossRate)}%</strong>、包装（OPP袋＋シール）を
     <strong>1枚¥${yen0(recipe.packagingCostPerPiece)}</strong>、委託先の販売手数料を
     <strong>${pct0(recipe.feeRate)}%</strong>とします。</p>

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
          <td>¥${yen(b.batchMaterials)}</td><td class="muted">ロス${pct0(recipe.lossRate)}%込み</td></tr>
      </tfoot>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>

  <p>30枚で割ると、材料費は<strong>1枚あたり¥${yen(b.materialsPerPiece)}</strong>。
     1枚¥${yen0(recipe.price)}で売るなら、材料費だけの原価率は
     <strong>${pct(b.materialsPerPiece / recipe.price)}%</strong>です。
     ——ここで計算をやめると「よく売れて、儲かっているはずなのにお金が残らない」が始まります。</p>

  <h2>全部入りの原価</h2>
  <div class="scroll">
    <table>
      <thead><tr><th>費目</th><th>1枚あたり</th><th>どこから来るか</th></tr></thead>
      <tbody>
        <tr><th scope="row">材料費</th><td>¥${yen(b.materialsPerPiece)}</td><td class="muted">歩留・製造ロス込み</td></tr>
        <tr><th scope="row">人件費</th><td>¥${yen(b.laborPerPiece)}</td><td class="muted">90分 × 時給¥${yen0(c.defaultHourlyWage)} ÷ 30枚</td></tr>
        <tr><th scope="row">包装費</th><td>¥${yen(b.packagingPerPiece)}</td><td class="muted">OPP袋＋シール</td></tr>
        <tr><th scope="row">販売手数料</th><td>¥${yen(b.feePerPiece)}</td><td class="muted">売価¥${yen0(recipe.price)}の${pct0(recipe.feeRate)}%</td></tr>
        <tr class="total"><th scope="row">合計</th><td><strong>¥${yen(b.totalPerPiece)}</strong></td>
          <td class="muted">売価¥${yen0(recipe.price)}に対して原価率<strong>${pct(b.costRate)}%</strong></td></tr>
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>

  <p>1枚¥${yen0(recipe.price)}のクッキーの原価は、材料費だけ見れば
     ¥${yen(b.materialsPerPiece)}（${pct(b.materialsPerPiece / recipe.price)}%）。
     全部入れると<strong>¥${yen(b.totalPerPiece)}（原価率${pct(b.costRate)}%）</strong>。
     手元に残るのは1枚あたり¥${yen(leftover)}です。</p>

  <h2>目標の原価率から売価を逆算する</h2>
  <p>原価率${pct0(TARGET_RATE)}%を守りたいとします。手数料は<strong>売価に比例して増える</strong>ので、
     「原価の2倍」では計算が合いません。売価 = （材料＋人件費＋包装）÷（目標原価率 − 手数料率）
     で逆算します。同じレシピでも:</p>

  <div class="scroll">
    <table>
      <thead><tr><th>売り方</th><th>手数料</th><th>原価率${pct0(TARGET_RATE)}%を守る売価</th></tr></thead>
      <tbody>
        <tr><th scope="row">直販（マルシェ・イベント）</th><td>0%</td><td><strong>¥${yen0(priceDirect)}</strong></td></tr>
        <tr><th scope="row">委託販売</th><td>${pct0(recipe.feeRate)}%</td><td><strong>¥${yen0(priceConsign)}</strong></td></tr>
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>

  <p>同じクッキーでも、直販なら¥${yen0(priceDirect)}、手数料${pct0(recipe.feeRate)}%の委託なら
     <strong>¥${yen0(priceConsign)}</strong>。委託の手数料は「売価の${pct0(recipe.feeRate)}%」なので、
     売価を上げるほど手数料も増え、逆算の分母（${pct0(TARGET_RATE)}% − ${pct0(recipe.feeRate)}% = ${pct0(TARGET_RATE - recipe.feeRate)}%）が小さくなるためです。
     委託で売るものと直販で売るものの値段が同じでよいはずがない——これが
     材料費だけの計算では絶対に見えない結論です。</p>`;

{
  const p = join(here, "okashi-genka.html");
  const page = readFileSync(p, "utf8");
  const block = `<!-- data:start（node make-genka-example.mjs が生成。手で直さない） -->\n${articleBlock}\n  <!-- data:end -->`;
  const next = page.replace(/<!-- data:start[\s\S]*?<!-- data:end -->/, block);
  if (next === page && !page.includes("data:start")) throw new Error("okashi-genka.html にマーカーが無い");
  writeFileSync(p, next);
}

/* ============ index.html の図（インラインSVG） ============ */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* --- 図1: シグネチャ「一枚のレシピから、二枚の紙が出る」 --- */
function svgHero() {
  const L = 8, R = 328, W = 304, TOP = 98, H = 318;   // 2枚の紙
  const rows = [
    ["材料費", b.materialsPerPiece],
    ["人件費", b.laborPerPiece],
    ["包装費", b.packagingPerPiece],
    ["販売手数料", b.feePerPiece],
  ];
  const rowY = (i) => 168 + i * 30;
  const money = rows
    .map(
      ([k, v], i) =>
        `      <text class="sv-key" x="${L + 16}" y="${rowY(i)}">${k}</text>` +
        `<text class="sv-num" x="${L + W - 16}" y="${rowY(i)}" text-anchor="end">${yen(v)}</text>\n` +
        `      <line class="sv-hair" x1="${L + 16}" y1="${rowY(i) + 10}" x2="${L + W - 16}" y2="${rowY(i) + 10}"/>`
    )
    .join("\n");

  const labelRows = ["名称", "原材料名", "内容量", "賞味期限", "保存方法", "製造者"]
    .map(
      (k, i) =>
        `      <text class="sv-key sm" x="${R + 16}" y="${158 + i * 22}">${k}</text>` +
        `<line class="sv-hair" x1="${R + 92}" y1="${158 + i * 22 + 4}" x2="${R + W - 16}" y2="${158 + i * 22 + 4}"/>`
    )
    .join("\n");

  // 説明は aria-label（属性）で持つ。SVG の <title>/<desc> はテキストノードなので
  // LP の文字数上限（ART-DIRECTION）に計上されてしまう。読み上げの情報量は落とさない。
  const label =
    `レシピを1回入れると、原価伝票と食品表示ラベルが同時に出る図。` +
    `上に「型抜きクッキー 30枚 委託${pct0(recipe.feeRate)}%」の入力が1行。そこから左右に分かれ、` +
    `左は1枚あたり材料費${yen(b.materialsPerPiece)}円・人件費${yen(b.laborPerPiece)}円・包装費${yen(b.packagingPerPiece)}円・` +
    `販売手数料${yen(b.feePerPiece)}円・総原価${yen(b.totalPerPiece)}円・原価率${pct(b.costRate)}パーセントで超過の原価伝票。` +
    `右は名称・原材料名・内容量・賞味期限・保存方法・製造者の一括表示と、栄養成分表示のラベル。`;

  return `  <svg class="fig fig-hero" viewBox="0 0 640 440" role="img" aria-label="${label}">
    <rect class="sv-paper" x="104" y="6" width="432" height="46" rx="4"/>
    <text class="sv-in" x="320" y="35" text-anchor="middle">型抜きクッキー ／ 30枚 ／ 委託 ${pct0(recipe.feeRate)}%</text>

    <path class="sv-link" d="M320 52 V70 H160 V88"/>
    <path class="sv-link" d="M320 52 V70 H480 V88"/>
    <path class="sv-tip" d="M154 88 L166 88 L160 97 Z"/>
    <path class="sv-tip" d="M474 88 L486 88 L480 97 Z"/>

    <g>
      <rect class="sv-paper" x="${L}" y="${TOP}" width="${W}" height="${H}" rx="4"/>
      <text class="sv-cap" x="${L + 16}" y="${TOP + 28}">原 価 伝 票</text>
      <text class="sv-unit" x="${L + W - 16}" y="${TOP + 28}" text-anchor="end">1枚あたり（円）</text>
      <line class="sv-rule" x1="${L + 16}" y1="${TOP + 40}" x2="${L + W - 16}" y2="${TOP + 40}"/>
${money}
      <line class="sv-rule" x1="${L + 16}" y1="${TOP + 190}" x2="${L + W - 16}" y2="${TOP + 190}"/>
      <text class="sv-key b" x="${L + 16}" y="${TOP + 220}">総原価</text>
      <text class="sv-tot" x="${L + W - 16}" y="${TOP + 224}" text-anchor="end">${yen(b.totalPerPiece)}</text>
      <line class="sv-rule" x1="${L + 16}" y1="${TOP + 236}" x2="${L + W - 16}" y2="${TOP + 236}"/>
      <text class="sv-key" x="${L + 16}" y="${TOP + 268}">原価率</text>
      <text class="sv-big ${verdict}" x="${L + 16}" y="${TOP + 300}">${pct(b.costRate)}%</text>
      <text class="sv-flag ${verdict}" x="${L + W - 16}" y="${TOP + 300}" text-anchor="end">▲ 超過</text>
    </g>

    <g>
      <rect class="sv-paper" x="${R}" y="${TOP}" width="${W}" height="${H}" rx="4"/>
      <text class="sv-cap" x="${R + 16}" y="${TOP + 28}">食品表示ラベル</text>
      <line class="sv-rule" x1="${R + 16}" y1="${TOP + 40}" x2="${R + W - 16}" y2="${TOP + 40}"/>
${labelRows}
      <text class="sv-key sm" x="${R + 16}" y="${TOP + 200}">（一部に小麦・卵・乳を含む）</text>
      <line class="sv-rule" x1="${R + 16}" y1="${TOP + 216}" x2="${R + W - 16}" y2="${TOP + 216}"/>
      <text class="sv-cap" x="${R + 16}" y="${TOP + 244}">栄養成分表示</text>
      <line class="sv-hair" x1="${R + 16}" y1="${TOP + 258}" x2="${R + W - 16}" y2="${TOP + 258}"/>
      <line class="sv-hair" x1="${R + 16}" y1="${TOP + 276}" x2="${R + W - 16}" y2="${TOP + 276}"/>
      <line class="sv-hair" x1="${R + 16}" y1="${TOP + 294}" x2="${R + W - 16}" y2="${TOP + 294}"/>
      <text class="sv-unit" x="${R + 16}" y="${TOP + 306}">この表示値は、目安です。</text>
    </g>
  </svg>`;
}

/* --- 図2: 積み上げ（売価という器に、費目を1つずつ足していく） --- */
function svgSteps() {
  // 器（売価）は X0〜X1。読み値はその外側に置く——帯の上に文字を重ねない。
  const X0 = 158, X1 = 520, TRACK = X1 - X0;
  const px = (yenv) => (yenv / recipe.price) * TRACK;
  const guard = X0 + px(recipe.price * TARGET_RATE);
  const BH = 26, GAP = 2;
  const rowY = (i) => 52 + i * 52;

  const bars = steps
    .map((s, i) => {
      const y = rowY(i);
      // 累計を、その行までに足した費目ごとの帯に割る
      let x = X0;
      const segs = [];
      for (let k = 0; k <= i; k++) {
        const from = k === 0 ? 0 : steps[k - 1].total;
        const w = px(steps[k].total - from);
        if (w > 0.5) segs.push(`<rect class="sv-seg s${k + 1}" x="${x.toFixed(1)}" y="${y}" width="${Math.max(w - GAP, 0.8).toFixed(1)}" height="${BH}"/>`);
        x += w;
      }
      const end = X0 + px(s.total);
      const over = s.rate > TARGET_RATE;
      // 死守ラインの点線が読み値の上を通らないように、掛かる行だけ線の右へ逃がす
      let vx = end + 10;
      if (vx < guard && guard < vx + 130) vx = guard + 8;
      return `      <text class="sv-rowlab" x="${X0 - 12}" y="${y + 18}" text-anchor="end">${s.label}</text>
      ${segs.join("")}
      <text class="sv-rowval${over ? " over" : ""}" x="${vx.toFixed(1)}" y="${y + 18}">${yen(s.total)}円 ${pct(s.rate)}%${over ? " ▲" : ""}</text>`;
    })
    .join("\n");

  const lastY = rowY(steps.length - 1);
  const endX = X0 + px(b.totalPerPiece);

  const label =
    `売価${yen0(recipe.price)}円に対して、費目を1つずつ足したときの原価の積み上がり。` +
    steps.map((s) => `${s.label}で${yen(s.total)}円、原価率${pct(s.rate)}パーセント`).join("。") +
    `。死守ラインの原価率${pct0(TARGET_RATE)}パーセントを最後の段で超える。手元に残るのは${yen(leftover)}円。` +
    `同じ数値の表は使い方のページにあります。`;

  return `  <svg class="fig fig-steps" viewBox="0 0 640 296" role="img" aria-label="${label}">
    <text class="sv-axis" x="${X0}" y="30">0</text>
    <text class="sv-axis" x="${X1}" y="30" text-anchor="end">売価 ${yen0(recipe.price)}円</text>
    <line class="sv-track" x1="${X0}" y1="38" x2="${X1}" y2="38"/>

    <line class="sv-guard" x1="${guard}" y1="42" x2="${guard}" y2="${lastY + BH + 6}"/>
    <text class="sv-guardlab" x="${guard}" y="30" text-anchor="middle">原価率 ${pct0(TARGET_RATE)}%</text>

${bars}

    <line class="sv-hair" x1="${endX.toFixed(1)}" y1="${lastY + BH + 8}" x2="${endX.toFixed(1)}" y2="${lastY + BH + 26}"/>
    <line class="sv-hair" x1="${X1}" y1="${lastY + BH + 8}" x2="${X1}" y2="${lastY + BH + 26}"/>
    <line class="sv-hair" x1="${endX.toFixed(1)}" y1="${lastY + BH + 26}" x2="${X1}" y2="${lastY + BH + 26}"/>
    <text class="sv-axis" x="${((endX + X1) / 2).toFixed(1)}" y="${lastY + BH + 44}" text-anchor="middle">残り ${yen(leftover)}円</text>
  </svg>`;
}

/* --- 図3: 逆算した売価（直販と委託） --- */
function svgPrice() {
  const X0 = 160, X1 = 540, TRACK = X1 - X0;
  const max = Math.max(priceDirect, priceConsign);
  const w = (v) => (v / max) * TRACK;
  const rows = [
    ["直販（マルシェ）", priceDirect],
    ["委託販売", priceConsign],
  ];
  const bars = rows
    .map(([k, v], i) => {
      const y = 40 + i * 46;
      return `    <text class="sv-rowlab" x="${X0 - 12}" y="${y + 17}" text-anchor="end">${k}</text>
    <rect class="sv-seg s${i === 0 ? 1 : 4}" x="${X0}" y="${y}" width="${w(v).toFixed(1)}" height="24"/>
    <text class="sv-rowval" x="${(X0 + w(v) + 10).toFixed(1)}" y="${y + 17}">${yen0(v)}円</text>`;
    })
    .join("\n");

  const label =
    `原価率${pct0(TARGET_RATE)}パーセントを守るための売価の比較。` +
    `同じ型抜きクッキーでも、手数料0パーセントの直販は${yen0(priceDirect)}円、` +
    `手数料${pct0(recipe.feeRate)}パーセントの委託販売は${yen0(priceConsign)}円。`;

  return `  <svg class="fig fig-price" viewBox="0 0 640 140" role="img" aria-label="${label}">
    <text class="sv-axis" x="4" y="22">原価率 ${pct0(TARGET_RATE)}%で売るなら</text>
${bars}
  </svg>`;
}

writeBlock("index.html", "fig-hero", svgHero());
writeBlock("index.html", "fig-steps", svgSteps());
writeBlock("index.html", "fig-price", svgPrice());

/* ============ support.html の表（図の数値版） ============ */

const tblCost = `  <div class="scroll" role="region" tabindex="0" aria-label="数値の表（横にスクロールできます）">
    <table>
      <caption>型抜きクッキー30枚・1枚180円で委託販売した場合（1枚あたり）</caption>
      <thead><tr><th scope="col">費目</th><th scope="col">1枚あたり</th><th scope="col">どこから来るか</th></tr></thead>
      <tbody>
        <tr><th scope="row">材料費</th><td class="n">¥${yen(b.materialsPerPiece)}</td><td>歩留まり・製造ロス${pct0(recipe.lossRate)}%込み</td></tr>
        <tr><th scope="row">人件費</th><td class="n">¥${yen(b.laborPerPiece)}</td><td>90分 × 時給¥${yen0(c.defaultHourlyWage)} ÷ 30枚</td></tr>
        <tr><th scope="row">包装費</th><td class="n">¥${yen(b.packagingPerPiece)}</td><td>OPP袋＋シール</td></tr>
        <tr><th scope="row">販売手数料</th><td class="n">¥${yen(b.feePerPiece)}</td><td>売価¥${yen0(recipe.price)}の${pct0(recipe.feeRate)}%</td></tr>
        <tr class="total"><th scope="row">総原価</th><td class="n">¥${yen(b.totalPerPiece)}</td><td>原価率 ${pct(b.costRate)}%（死守ライン${pct0(TARGET_RATE)}%を超過）</td></tr>
        <tr><th scope="row">手元に残る</th><td class="n">¥${yen(leftover)}</td><td>売価¥${yen0(recipe.price)} − 総原価</td></tr>
      </tbody>
    </table>
  </div>
  <p class="tiny">アプリの原価画面は合計を1円単位で丸めるので、総原価は<strong>¥${yen0(
    b.totalPerPiece
  )}</strong>と表示されます（内訳は小数第1位まで）。
    逆算した売価は10円単位で切り上げます（直販の生の解は¥${G.suggestedPrice({ ...recipe, feeRate: 0 }, c, TARGET_RATE).toFixed(
      2
    )}、委託は¥${G.suggestedPrice(recipe, c, TARGET_RATE).toFixed(2)}）。</p>`;

const tblSteps = `  <div class="scroll" role="region" tabindex="0" aria-label="数値の表（横にスクロールできます）">
    <table>
      <caption>費目を1つずつ足したときの原価（売価¥${yen0(recipe.price)}に対して）</caption>
      <thead><tr><th scope="col">足したもの</th><th scope="col">総原価/枚</th><th scope="col">原価率</th></tr></thead>
      <tbody>
${steps
  .map(
    (s) =>
      `        <tr><th scope="row">${s.label}</th><td class="n">¥${yen(s.total)}</td><td class="n">${pct(s.rate)}%</td></tr>`
  )
  .join("\n")}
      </tbody>
    </table>
  </div>`;

writeBlock("support.html", "tbl-cost", tblCost);
writeBlock("support.html", "tbl-steps", tblSteps);

console.log(
  `生成: 材料¥${yen(b.materialsPerPiece)}/枚 → 総原価¥${yen(b.totalPerPiece)}/枚（原価率${pct(b.costRate)}% = ${verdict}）・` +
    `逆算売価 直販¥${yen0(priceDirect)} / 委託¥${yen0(priceConsign)}\n` +
    `  積み上げ: ${steps.map((s) => `${s.label} ¥${yen(s.total)}(${pct(s.rate)}%)`).join(" → ")}\n` +
    `  書き換え: okashi-genka.html / index.html(fig-hero, fig-steps, fig-price) / support.html(tbl-cost, tbl-steps)`
);
