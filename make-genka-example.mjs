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
 *   komugi-neage.html : komugi        小麦12%値上げの記事本文の表
 *   お役立ち記事7本   : data          売値・手数料・人件費・歩留まり・食品表示・アレルゲン・栄養（表示は label-engine.js）
 *   全記事            : related       ほかのお役立ち記事の一覧 / faq-ld  本文の「よくある質問」から FAQPage を生成
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

/* ============ 記事 komugi-neage.html（小麦12%の値上げ） ============
   上の型抜きクッキーと同じレシピ・同じ条件で、材料の購入価格だけを差し替えて計算し直す
   （アプリの「値上げの影響一覧」と同じやり方: 式は持たず、単価だけ変えた ctx で costBreakdown を呼ぶ）。
   12.0% は農水省の発表（令和8年10月期の輸入小麦の政府売渡価格）。最低賃金+56円は JILPT 2026年10月号。 */

const RISE = 0.12;            // 小麦の値上げ率
const WAGE_UP = 56;           // 最低賃金の引上げ額（全国加重平均）
const raised = (ids, r = RISE) => {
  const m = new Map();
  for (const [k, v] of ingredients) {
    m.set(k, ids === "all" || ids.includes(k) ? { ...v, purchasePrice: v.purchasePrice * (1 + r) } : v);
  }
  return m;
};
const ctxOf = (ings, wage = c.defaultHourlyWage) => ({ ingredients: ings, recipes: new Map(), defaultHourlyWage: wage });
const kFlour = G.costBreakdown(recipe, ctxOf(raised(["flour"])));
const kAll = G.costBreakdown(recipe, ctxOf(raised("all")));
const kWage = G.costBreakdown(recipe, ctxOf(ingredients, c.defaultHourlyWage + WAGE_UP));
const kBoth = G.costBreakdown(recipe, ctxOf(raised("all"), c.defaultHourlyWage + WAGE_UP));
const dFlour = kFlour.totalPerPiece - b.totalPerPiece;
const dAll = kAll.totalPerPiece - b.totalPerPiece;
const dWage = kWage.totalPerPiece - b.totalPerPiece;
const dBoth = kBoth.totalPerPiece - b.totalPerPiece;
const flourShare = lineCost("flour", 200) / (recipe.lines.reduce((s, l) => s + lineCost(l.ref.id, l.amount), 0));
const yen2 = (n) => n.toFixed(2);

// 材料ごとに「その材料だけ12%上がったら」
const perIng = recipe.lines
  .map((l) => {
    const x = G.costBreakdown(recipe, ctxOf(raised([l.ref.id])));
    return { name: ingredients.get(l.ref.id).name, d: x.totalPerPiece - b.totalPerPiece };
  })
  .sort((p, q) => q.d - p.d);

const spOf = (ings, wage, fee) =>
  G.roundPriceUp(G.suggestedPrice({ ...recipe, feeRate: fee }, ctxOf(ings, wage), TARGET_RATE), 10);
const priceRows = [
  ["いま", ingredients, c.defaultHourlyWage],
  ["薄力粉だけ+12%", raised(["flour"]), c.defaultHourlyWage],
  [`材料ぜんぶ+12%・時給+${WAGE_UP}円`, raised("all"), c.defaultHourlyWage + WAGE_UP],
].map(([label, ings, w]) => ({ label, direct: spOf(ings, w, 0), consign: spOf(ings, w, recipe.feeRate) }));

const komugiBlock = `  <h2>答え: 1枚あたり約${yen2(dFlour)}円</h2>
  <p><a href="okashi-genka.html">お菓子の原価計算のやり方</a>と同じ型抜きクッキー（30枚・バター150g・薄力粉200g ほか）で計算します。
     薄力粉は1kg¥${yen0(ingredients.get("flour").purchasePrice)}、時給¥${yen0(c.defaultHourlyWage)}・90分、製造ロス${pct0(recipe.lossRate)}%です。</p>
  <p>薄力粉の仕入れ値が${pct0(RISE)}%上がって1kg¥${yen0(ingredients.get("flour").purchasePrice * (1 + RISE))}になると、
     1枚の原価は<strong>¥${yen2(b.totalPerPiece)} → ¥${yen2(kFlour.totalPerPiece)}</strong>。
     増えるのは<strong>1枚あたり¥${yen2(dFlour)}</strong>、30枚で¥${yen(dFlour * recipe.yieldCount)}です。</p>
  <p>小さいのは、このクッキーの材料費のうち薄力粉が<strong>${pct0(flourShare)}%</strong>しかないからです。
     材料費の大半はバターとアーモンドプードルです。</p>

  <h2>同じ12%でも、材料によって効き方がちがう</h2>
  <p>「その材料だけが${pct0(RISE)}%上がったら、1枚いくら上がるか」を材料ごとに出しました。</p>
  <div class="scroll">
    <table>
      <thead><tr><th>${pct0(RISE)}%上がった材料</th><th>1枚あたり</th><th>30枚で</th></tr></thead>
      <tbody>
${perIng
  .map(
    (p) =>
      `        <tr><th scope="row">${p.name}</th><td>+¥${yen2(p.d)}</td><td>+¥${yen(p.d * recipe.yieldCount)}</td></tr>`
  )
  .join("\n")}
        <tr class="total"><th scope="row">材料ぜんぶ</th><td>+¥${yen2(dAll)}</td><td>+¥${yen(dAll * recipe.yieldCount)}</td></tr>
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>
  <p>小麦だけなら1枚¥${yen2(dFlour)}。同じ${pct0(RISE)}%でもバターなら¥${yen2(perIng.find((p) => p.name.startsWith("バター")).d)}です。
     そして今年は最低賃金も上がります（全国加重平均で${WAGE_UP}円）。作業の時給を${WAGE_UP}円上げて数えると、90分の作業で<strong>1枚あたり¥${yen2(dWage)}</strong>。
     このクッキーでは、<strong>小麦の値上げより時給の方が効きます</strong>。</p>

  <h2>売価は変えるべき？</h2>
  <p>原価率${pct0(TARGET_RATE)}%を守る売価（10円単位で切り上げ）は、こう動きます。</p>
  <div class="scroll">
    <table>
      <thead><tr><th>条件</th><th>直販（手数料0%）</th><th>委託（手数料${pct0(recipe.feeRate)}%）</th></tr></thead>
      <tbody>
${priceRows
  .map(
    (r) =>
      `        <tr><th scope="row">${r.label}</th><td>¥${yen0(r.direct)}</td><td>¥${yen0(r.consign)}</td></tr>`
  )
  .join("\n")}
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>
  <p>小麦だけなら、売価は${priceRows[1].direct === priceRows[0].direct && priceRows[1].consign === priceRows[0].consign ? "据え置きで足ります" : "上げる必要があります"}。
     材料ぜんぶ+${pct0(RISE)}%と時給+${WAGE_UP}円が重なると、1枚¥${yen2(dBoth)}上がり、
     直販は¥${yen0(priceRows[0].direct)}→¥${yen0(priceRows[2].direct)}、委託は¥${yen0(priceRows[0].consign)}→¥${yen0(priceRows[2].consign)}になります。
     委託は手数料が売価に比例するので、同じ値上げでも動きが大きくなります。</p>`;

writeBlock("komugi-neage.html", "komugi", komugiBlock);

console.log(
  `生成: 材料¥${yen(b.materialsPerPiece)}/枚 → 総原価¥${yen(b.totalPerPiece)}/枚（原価率${pct(b.costRate)}% = ${verdict}）・` +
    `逆算売価 直販¥${yen0(priceDirect)} / 委託¥${yen0(priceConsign)}\n` +
    `  積み上げ: ${steps.map((s) => `${s.label} ¥${yen(s.total)}(${pct(s.rate)}%)`).join(" → ")}\n` +
    `  小麦+${pct0(RISE)}%: +¥${yen2(dFlour)}/枚・材料ぜんぶ +¥${yen2(dAll)}・時給+${WAGE_UP}円 +¥${yen2(dWage)}・両方 +¥${yen2(dBoth)}` +
    `・売価 直販 ${priceRows.map((r) => r.direct).join("→")} / 委託 ${priceRows.map((r) => r.consign).join("→")}\n` +
    `  書き換え: okashi-genka.html / index.html(fig-hero, fig-steps, fig-price) / support.html(tbl-cost, tbl-steps) / komugi-neage.html(komugi)`
);

/* ============================================================================
   お役立ち記事（2026-10-16）: 売値・手数料・人件費・歩留まり・食品表示・アレルゲン・栄養
   原価は genka.js、表示（原材料名・アレルゲン・栄養）は label-engine.js（アプリの label.ts /
   nutrition.ts / allergens.ts を build-label-engine.mjs で束ねたもの）を実行して作る。
   栄養の元の値は hatto-sample.json（アプリ同梱の八訂DBから抜いた5食品）。
   ============================================================================ */

const lctx = {};
vm.createContext(lctx);
vm.runInContext(readFileSync(join(here, "label-engine.js"), "utf8"), lctx);
const GL = lctx.GenkaLabel;
const HATTO = JSON.parse(readFileSync(join(here, "hatto-sample.json"), "utf8")).foods;

/* 表示用の材料: 原価の例と同じ5品に、表示名・アレルゲン・八訂コードを足す。
   卵は原価では「1個60g・殻を除いて85%」。表示と栄養は中身の重さで数えるので 60×0.85=51g */
const EGG_NET = 60 * 0.85;
const LABEL_META = {
  butter: { labelName: "バター", allergens: ["nyu"], hattoCode: "14018" },
  flour: { labelName: "小麦粉", allergens: ["komugi"], hattoCode: "01015" },
  sugar: { labelName: "砂糖", allergens: [], hattoCode: "03005" },
  egg: { labelName: "卵", allergens: ["tamago"], hattoCode: "12004", pieceGrams: EGG_NET },
  almond: { labelName: "アーモンドパウダー", allergens: ["almond"], hattoCode: "05001" },
};
const labelIngs = new Map([...ingredients].map(([k, v]) => [k, { ...v, ...LABEL_META[k] }]));
const lc = { ingredients: labelIngs, recipes: new Map() };
const doughGrams = recipe.lines.reduce(
  (s, l) => s + (l.unit === "個" ? l.amount * labelIngs.get(l.ref.id).pieceGrams : l.amount),
  0
);
const BAKED_GRAMS = 470; // 焼いたあと30枚の合計（例。焼き減りは生地と窯で変わる）

const fmtSigned = (n) => (n >= 0 ? "+" : "−") + "¥" + yen(Math.abs(n));
const sp = (r, ctxx, t = TARGET_RATE) => G.roundPriceUp(G.suggestedPrice(r, ctxx, t), 10);

/* ---------- 1. 売値の決め方 baika-kimekata.html ---------- */
{
  const direct = { ...recipe, feeRate: 0, price: undefined };
  const rows = [0.3, 0.4, 0.5].map((t) => {
    const d = sp(direct, c, t);
    let cs;
    try {
      cs = "¥" + yen0(sp({ ...recipe, price: undefined }, c, t));
    } catch {
      cs = "成り立たない";
    }
    return `        <tr><th scope="row">${pct0(t)}%</th><td>¥${yen0(d)}</td><td>${cs}</td></tr>`;
  });
  const bD = G.costBreakdown({ ...direct, price: sp(direct, c) }, c);
  const block = `  <h2>答え: 原価を、目標の原価率で割る</h2>
  <p>売価 ＝（材料費＋人件費＋包装費）÷（目標の原価率 − 手数料率）。
     手数料のない直販なら「原価 ÷ 原価率」、委託なら分母から手数料率を引きます。</p>
  <p><a href="okashi-genka.html">原価計算のやり方</a>と同じ型抜きクッキー（30枚・作業90分・時給¥${yen0(c.defaultHourlyWage)}）で、
     1枚の原価は<strong>¥${yen(b.basePerPiece)}</strong>（材料¥${yen(b.materialsPerPiece)}＋人件費¥${yen(b.laborPerPiece)}＋包装¥${yen(b.packagingPerPiece)}）です。</p>

  <h2>目標の原価率を変えると、売価はどう動く？</h2>
  <div class="scroll">
    <table>
      <thead><tr><th>目標の原価率</th><th>直販（手数料0%）</th><th>委託（手数料${pct0(recipe.feeRate)}%）</th></tr></thead>
      <tbody>
${rows.join("\n")}
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>
  <p>売価は10円単位で切り上げています。委託${pct0(recipe.feeRate)}%で原価率${pct0(0.3)}%を目指すと、
     分母が0になって<strong>どんな値段でも届きません</strong>。委託では原価率の目標を手数料率より高く置くしかありません。</p>
  <p>直販で原価率${pct0(TARGET_RATE)}%なら1枚¥${yen0(sp(direct, c))}。
     原価（人件費¥${yen(b.laborPerPiece)}を含む）を引いて、1枚¥${yen(sp(direct, c) - bD.totalPerPiece)}が残ります。</p>`;
  writeBlock("baika-kimekata.html", "data", block);
}

/* ---------- 2. 手数料の比べ方 tesuuryou-hikaku.html ---------- */
const BAG = 6; // 1袋6枚
const SHIP = 400; // 送料（例。購入者が払う額）
const BAG_PACK = 40; // 袋・シール・乾燥剤（例）
const MARCHE_FEE = 3000; // 出店料（例・1日）
const MARCHE_SOLD = 20; // 1日に売れる袋数（例）
const MINNE = 0.10659; // minne PLUS 非会員・税込（作品価格＋購入オプション＋送料に対して）
const BASE_PCT = 0.036 + 0.03; // BASE スタンダード: 決済手数料3.6%＋サービス利用料3%
const BASE_FIX = 40; // BASE: 1注文あたり40円
const bagRecipe = {
  ...recipe,
  yieldCount: recipe.yieldCount / BAG,
  packagingCostPerPiece: BAG_PACK,
  price: undefined,
};
const channels = [
  { name: "マルシェで直販", note: `出店料¥${yen0(MARCHE_FEE)}÷${MARCHE_SOLD}袋`, fee: 0, fixed: MARCHE_FEE / MARCHE_SOLD },
  { name: "お店に委託", note: "売価の30%（例）", fee: 0.3, fixed: 0 },
  { name: "minne", note: `売価の${(MINNE * 100).toFixed(3)}%＋送料分の手数料`, fee: MINNE, fixed: MINNE * SHIP },
  {
    name: "BASE（スタンダード）",
    note: `売価の${(BASE_PCT * 100).toFixed(1)}%＋¥${BASE_FIX}＋送料分`,
    fee: BASE_PCT,
    fixed: BASE_FIX + BASE_PCT * SHIP,
  },
];
const BAG_PRICE = 1000; // 比べるための同じ売価（例）
const chRows = channels.map((ch) => {
  const r = { ...bagRecipe, feeRate: ch.fee, packagingCostPerPiece: BAG_PACK + ch.fixed };
  const need = sp(r, c);
  const at = G.costBreakdown({ ...r, price: BAG_PRICE }, c);
  return { ...ch, need, left: BAG_PRICE - at.totalPerPiece, chFee: at.feePerPiece + ch.fixed };
});
{
  const base0 = G.costBreakdown({ ...bagRecipe, feeRate: 0, price: undefined }, c).basePerPiece;
  const block = `  <h2>例: クッキー${BAG}枚入りの袋を、4つの売り方で売る</h2>
  <p>中身は<a href="okashi-genka.html">原価計算のやり方</a>と同じクッキー${BAG}枚。袋・シール・乾燥剤は1袋¥${yen0(BAG_PACK)}（例）。
     1袋の原価は<strong>¥${yen(base0)}</strong>で、その${pct0((BAG * b.laborPerPiece) / base0)}%は人件費です。ネット販売は1注文1袋・送料¥${yen0(SHIP)}を購入者が払う形にしています。</p>
  <div class="scroll">
    <table>
      <thead><tr><th>売り方</th><th>1袋¥${yen0(BAG_PRICE)}で払う手数料</th><th>手元に残る</th><th>原価率${pct0(TARGET_RATE)}%を守る売価</th></tr></thead>
      <tbody>
${chRows
  .map(
    (r) =>
      `        <tr><th scope="row">${r.name}<br><span class="muted">${r.note}</span></th><td>¥${yen(r.chFee)}</td><td>¥${yen(r.left)}</td><td><strong>¥${yen0(r.need)}</strong></td></tr>`
  )
  .join("\n")}
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>
  <p>同じ¥${yen0(BAG_PRICE)}でも、手元に残るのは¥${yen(Math.min(...chRows.map((r) => r.left)))}〜¥${yen(Math.max(...chRows.map((r) => r.left)))}。
     売価をそろえるより、<strong>売り方ごとに値段を分ける</strong>方が筋が通ります。
     「手元に残る」は人件費を引いたあとの額です。</p>
  <p>マルシェの出店料は、売れた数で割ると1袋あたりが決まります。${MARCHE_SOLD}袋なら¥${yen0(MARCHE_FEE / MARCHE_SOLD)}、
     ${MARCHE_SOLD / 2}袋しか売れなければ¥${yen0(MARCHE_FEE / (MARCHE_SOLD / 2))}です。</p>`;
  writeBlock("tesuuryou-hikaku.html", "data", block);
}

/* ---------- 3. 人件費 jinkenhi.html ---------- */
{
  // 2026年度の地域別最低賃金（厚生労働省「令和8年度 地域別最低賃金 全国一覧」）
  const wages = [
    ["例（このサイトの計算例）", c.defaultHourlyWage],
    ["全国加重平均", 1177],
    ["新潟県", 1108],
    ["東京都", 1280],
  ];
  const direct = { ...recipe, feeRate: 0, price: undefined };
  const wRows = wages.map(([label, w]) => {
    const x = G.costBreakdown(direct, ctxOf(ingredients, w));
    return `        <tr><th scope="row">${label}</th><td>¥${yen0(w)}</td><td>¥${yen(x.laborPerPiece)}</td><td>¥${yen(x.basePerPiece)}</td><td>¥${yen0(sp(direct, ctxOf(ingredients, w)))}</td></tr>`;
  });
  const mins = [60, 90, 120].map((m) => {
    const r = { ...direct, labor: { minutes: m } };
    const x = G.costBreakdown(r, c);
    return `        <tr><th scope="row">${m}分</th><td>¥${yen(x.laborPerPiece)}</td><td>¥${yen(x.basePerPiece)}</td><td>¥${yen0(sp(r, c))}</td></tr>`;
  });
  // 倍量で焼く: 材料2倍・60枚・作業150分（例）
  const dbl = {
    ...direct,
    lines: recipe.lines.map((l) => ({ ...l, amount: l.amount * 2 })),
    yieldCount: 60,
    labor: { minutes: 150 },
  };
  const x30 = G.costBreakdown(direct, c);
  const x60 = G.costBreakdown(dbl, c);
  const block = `  <h2>時給を変えると、1枚いくら変わる？</h2>
  <p>型抜きクッキー30枚・作業90分・直販（手数料0%）で、時給だけを変えました。</p>
  <div class="scroll">
    <table>
      <thead><tr><th>目安</th><th>時給</th><th>人件費/枚</th><th>原価/枚</th><th>原価率${pct0(TARGET_RATE)}%の売価</th></tr></thead>
      <tbody>
${wRows.join("\n")}
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>

  <h2>作業時間を正直に数えると？</h2>
  <p>時給¥${yen0(c.defaultHourlyWage)}のまま、作業時間だけを変えました。</p>
  <div class="scroll">
    <table>
      <thead><tr><th>作業時間</th><th>人件費/枚</th><th>原価/枚</th><th>原価率${pct0(TARGET_RATE)}%の売価</th></tr></thead>
      <tbody>
${mins.join("\n")}
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>
  <p>30分ちがうと、1枚あたり¥${yen((30 / 60) * c.defaultHourlyWage / recipe.yieldCount)}変わります。</p>

  <h2>まとめて焼くと、1枚の人件費は下がる</h2>
  <p>倍量（60枚）を150分で焼くと（例）、人件費は1枚<strong>¥${yen(x30.laborPerPiece)} → ¥${yen(x60.laborPerPiece)}</strong>。
     原価は¥${yen(x30.basePerPiece)} → ¥${yen(x60.basePerPiece)}です。材料費は枚数に比例するので変わりません。</p>`;
  writeBlock("jinkenhi.html", "data", block);
}

/* ---------- 4. 歩留まり・ロス budomari.html ---------- */
{
  const direct = { ...recipe, feeRate: 0, price: undefined };
  const eggNo = G.costBreakdown(direct, cc(ing(1)));
  const eggYes = G.costBreakdown(direct, c);
  const losses = [0, 0.05, 0.1, 0.2].map((lr) => {
    const x = G.costBreakdown({ ...direct, lossRate: lr }, c);
    return `        <tr><th scope="row">${pct0(lr)}%</th><td>¥${yen(x.materialsPerPiece)}</td><td>¥${yen(x.basePerPiece)}</td><td>¥${yen0(sp({ ...direct, lossRate: lr }, c))}</td></tr>`;
  });
  const block = `  <h2>卵の殻: 買った重さと、使える重さはちがう</h2>
  <p>卵は1個60g・殻を除いて${pct0(0.85)}%（約${yen0(EGG_NET)}g）で数えています。
     この「使える割合」が歩留まりです。</p>
  <p>卵は10個¥${yen0(ingredients.get("egg").purchasePrice)}、1個¥${yen0(ingredients.get("egg").purchasePrice / 10)}。歩留まり${pct0(0.85)}%で数えると、
     使える中身1個分は¥${yen(ingredients.get("egg").purchasePrice / 10 / 0.85)}です。
     材料費は1枚<strong>¥${yen(eggNo.materialsPerPiece)} → ¥${yen(eggYes.materialsPerPiece)}</strong>になります。</p>
  <p>卵を「g」で量って使うときは、とくに効きます。全卵40gを使うには、殻ごと約${yen0(40 / 0.85)}g分を買う必要があります。</p>

  <h2>割れ・型抜きの端: 製造ロスを入れる</h2>
  <p>割れて売れない分や、もう使えない生地の端は「製造ロス」です。
     売れる枚数が減るのと同じなので、材料費を(1 − ロス率)で割って数えます。</p>
  <div class="scroll">
    <table>
      <thead><tr><th>製造ロス</th><th>材料費/枚</th><th>原価/枚</th><th>原価率${pct0(TARGET_RATE)}%の売価（直販）</th></tr></thead>
      <tbody>
${losses.join("\n")}
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>
  <p>ロスを${pct0(0)}%→${pct0(0.1)}%にすると、材料費は1枚¥${yen(G.costBreakdown({ ...direct, lossRate: 0.1 }, c).materialsPerPiece - G.costBreakdown({ ...direct, lossRate: 0 }, c).materialsPerPiece)}上がります。
     人件費はロスでは増やしていません（割れた分を焼いた時間も、作業時間に入っているため）。</p>

  <h2>焼き減りは、原価には入れない</h2>
  <p>生地${yen0(doughGrams)}gが焼いて${yen0(BAKED_GRAMS)}g（例）になっても、30枚は30枚。
     <strong>原価は「何枚できたか」で割る</strong>ので、焼き減りは関係しません。</p>
  <p>焼き減りが効くのは<strong>内容量と栄養成分表示</strong>です。100gあたりの値は、焼いたあとの重さで割ります
     （<a href="eiyo-suiteichi.html">栄養成分表示の推定値</a>）。</p>`;
  writeBlock("budomari.html", "data", block);
}

/* ---------- 5. 食品表示ラベル shokuhin-hyoji.html ---------- */
const stmtPlain = GL.ingredientStatement(recipe, lc);
const stmtOrigin = GL.ingredientStatement({ ...recipe, labelFields: { topOrigin: "国内製造" } }, lc);
{
  const block = `  <h2>例: 型抜きクッキーのラベル</h2>
  <p>原材料名の行は、原価ノートの計算エンジンが配合から並べたものです（重い順）。
     ほかの行は記入例です。</p>
  <div class="scroll">
    <table class="ikkatsu">
      <tbody>
        <tr><th scope="row">名称</th><td>クッキー</td></tr>
        <tr><th scope="row">原材料名</th><td>${esc(stmtOrigin)}</td></tr>
        <tr><th scope="row">内容量</th><td>${BAG}枚</td></tr>
        <tr><th scope="row">賞味期限</th><td>2026.11.15</td></tr>
        <tr><th scope="row">保存方法</th><td>直射日光、高温多湿を避けて保存してください。</td></tr>
        <tr><th scope="row">製造者</th><td>（氏名）<br>（住所）</td></tr>
      </tbody>
    </table>
  </div>
  <p class="muted">配合: 薄力粉200g・バター150g・砂糖90g・卵1個（中身約${yen0(EGG_NET)}g）・アーモンドパウダー50g。
     「国内製造」は重量1位の小麦粉の原料原産地の書き方の例です。実際は仕入れた袋の表示で確かめます。</p>`;
  writeBlock("shokuhin-hyoji.html", "data", block);
}

/* ---------- 6. アレルゲン allergen-hyoji.html ---------- */
{
  const cashewIngs = new Map(labelIngs);
  cashewIngs.delete("almond");
  cashewIngs.set("cashew", {
    id: "cashew",
    name: "カシューナッツ",
    labelName: "カシューナッツ",
    purchasePrice: 0,
    packAmount: 100,
    packUnit: "g",
    yieldRate: 1,
    allergens: ["cashew"],
  });
  const cashewRecipe = {
    ...recipe,
    lines: recipe.lines.map((l) => (l.ref.id === "almond" ? { ...l, ref: { kind: "ingredient", id: "cashew" } } : l)),
  };
  const stmtCashew = GL.ingredientStatement(cashewRecipe, { ingredients: cashewIngs, recipes: new Map() });
  const mand = GL.ALLERGENS.filter((a) => a.mandatory).map((a) => a.name);
  const rec = GL.ALLERGENS.filter((a) => !a.mandatory).map((a) => a.name);
  const block = `  <h2>表示する品目（2026年4月から）</h2>
  <div class="scroll">
    <table class="wrapcells">
      <tbody>
        <tr><th scope="row">義務<br>${mand.length}品目</th><td>${mand.join("・")}</td></tr>
        <tr><th scope="row">推奨<br>${rec.length}品目</th><td>${rec.join("・")}</td></tr>
      </tbody>
    </table>
  </div>
  <p class="muted">表の並びは原価ノートの登録順です。「乳」はラベルでは「乳成分」と書きます。</p>

  <h2>例: アーモンドをカシューナッツに替えたクッキー</h2>
  <p>同じ配合でアーモンドパウダー50gをカシューナッツ50gに替えると、原材料名はこうなります（原価ノートの計算エンジンで作成）。</p>
  <p class="labelline">${esc(stmtCashew)}</p>
  <p>替える前はこうでした。</p>
  <p class="labelline">${esc(stmtPlain)}</p>`;
  writeBlock("allergen-hyoji.html", "data", block);
}

/* ---------- 7. 栄養成分の推定値 eiyo-suiteichi.html ---------- */
{
  const nctx = { ...lc, nutritionByHattoCode: new Map(Object.entries(HATTO)) };
  const nBaked = GL.recipeNutrition({ ...recipe, yieldTotalGrams: BAKED_GRAMS }, nctx);
  const nDough = GL.recipeNutrition({ ...recipe, yieldTotalGrams: doughGrams }, nctx);
  const f = (n, per100) => [
    ["熱量", `${n.energyKcal.toFixed(0)}kcal`],
    ["たんぱく質", `${n.proteinG.toFixed(1)}g`],
    ["脂質", `${n.fatG.toFixed(1)}g`],
    ["炭水化物", `${n.carbG.toFixed(1)}g`],
    ["食塩相当量", `${GL.formatSaltG(n.saltG, per100)}g`],
  ];
  const piece = f(nBaked.perPiece, nBaked.per100g.saltG);
  const p100b = f(nBaked.per100g, nBaked.per100g.saltG);
  const p100d = f(nDough.per100g, nDough.per100g.saltG);
  const basis = GL.pieceBasisLabel({ yieldCount: recipe.yieldCount, yieldTotalGrams: BAKED_GRAMS });
  const block = `  <h2>例: 型抜きクッキー1枚の推定値</h2>
  <p>八訂の5食品（薄力粉・バター・グラニュー糖・全卵・アーモンド）の100gあたりの値に、配合の重さを掛けて足し、30枚で割りました。
     焼いたあと30枚で${yen0(BAKED_GRAMS)}g（例）です。</p>
  <div class="scroll">
    <table class="nut">
      <thead><tr><th>栄養成分表示</th><th>${basis}</th></tr></thead>
      <tbody>
${piece.map(([k, v]) => `        <tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("\n")}
        <tr><td colspan="2" class="estimate">この表示値は、目安です。</td></tr>
      </tbody>
    </table>
  </div>
  <p class="muted">原価ノートのラベルと同じ丸め方（熱量は整数、ほかは小数第1位、食塩相当量は0.1g未満なら有効数字1桁）。</p>

  <h2>100gあたりで書くなら、焼いたあとの重さで割る</h2>
  <div class="scroll">
    <table>
      <thead><tr><th>100gあたり</th><th>焼いたあと${yen0(BAKED_GRAMS)}gで割る</th><th>生地${yen0(doughGrams)}gで割ると</th></tr></thead>
      <tbody>
${p100b.map(([k, v], i) => `        <tr><th scope="row">${k}</th><td>${v}</td><td>${p100d[i][1]}</td></tr>`).join("\n")}
      </tbody>
    </table>
  </div>
  <p class="hint">表は横にスワイプできます →</p>
  <p>焼くと水分が抜けて軽くなります。1枚あたりの値は変わりませんが、
     100gあたりは焼いたあとの重さで割らないと<strong>少なく出ます</strong>。</p>`;
  writeBlock("eiyo-suiteichi.html", "data", block);
}

/* ---------- 関連記事（全記事の下に同じ一覧） と FAQPage の JSON-LD ---------- */
const GUIDES = [
  ["okashi-genka.html", "お菓子の原価計算のやり方"],
  ["baika-kimekata.html", "手作りお菓子の売値はどう決める？"],
  ["tesuuryou-hikaku.html", "委託・マルシェ・minne・BASE、手数料でいくら残る？"],
  ["jinkenhi.html", "お菓子の原価に、自分の人件費はどう入れる？"],
  ["budomari.html", "卵の殻や割れたクッキーは、原価にどう入れる？"],
  ["komugi-neage.html", "小麦が12%上がると、クッキー1枚いくら上がる？"],
  ["shokuhin-hyoji.html", "手作りお菓子の食品表示ラベルには、何を書く？"],
  ["allergen-hyoji.html", "カシューナッツの表示義務はいつから？"],
  ["eiyo-suiteichi.html", "栄養成分表示の「推定値」はどう作る？"],
];
const stripTags = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
for (const [file] of GUIDES) {
  const list = GUIDES.filter(([f]) => f !== file)
    .map(([f, t]) => `      <li><a href="${f}">${esc(t)}</a></li>`)
    .join("\n");
  writeBlock(
    file,
    "related",
    `  <nav class="related" aria-label="お役立ち記事">
    <h2>ほかのお役立ち記事</h2>
    <ul>
${list}
    </ul>
  </nav>`
  );
  // FAQ: 本文の <!-- faq:start --> 〜 <!-- faq:end --> の h3/p をそのまま JSON-LD にする（一字一句一致）
  const src = readFileSync(join(here, file), "utf8");
  const m = src.match(/<!-- faq:start -->([\s\S]*?)<!-- faq:end -->/);
  if (m) {
    const qa = [...m[1].matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(([, q, a]) => ({
      "@type": "Question",
      name: stripTags(q),
      acceptedAnswer: { "@type": "Answer", text: stripTags(a) },
    }));
    const ld = { "@context": "https://schema.org", "@type": "FAQPage", inLanguage: "ja", mainEntity: qa };
    writeBlock(file, "faq-ld", `<script type="application/ld+json">\n${JSON.stringify(ld, null, 1)}\n</script>`);
  }
}

console.log(
  `お役立ち記事: 原材料名「${stmtPlain}」・生地${doughGrams}g・` +
    `手数料比較 ${chRows.map((r) => `${r.name}:残¥${yen(r.left)}/要¥${r.need}`).join(" / ")}`
);
