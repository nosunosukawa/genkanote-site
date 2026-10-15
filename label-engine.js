/* 原価ノートの表示計算 — mobile/genkanote/src/logic/{cost,density,allergens,label,nutrition}.ts を束ねたもの（手で編集しない）
   再生成: node build-label-engine.mjs */
var GenkaLabel = (() => {
  const defs = {
"./cost": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.costVerdict = exports.roundPriceUp = exports.suggestTargetPct = exports.DEFAULT_TARGET_COST_RATE = exports.suggestedPrice = exports.costBreakdown = exports.unpricedIngredients = exports.recipeLineCosts = exports.batchMaterialsCost = exports.laborCost = exports.ingredientLineCost = exports.CostError = void 0;
const density_1 = require("./density");
class CostError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.CostError = CostError;
/** 材料1行の費用（円）。購入単価→使用量、歩留で割り増し */
function ingredientLineCost(ing, amount, unit) {
    if (!(ing.yieldRate > 0 && ing.yieldRate <= 1)) {
        throw new CostError("bad-rate", `${ing.name}: 歩留率が(0,1]の外`);
    }
    const grams = toPackUnitAmount(ing, amount, unit);
    return (ing.purchasePrice / ing.packAmount) * (grams / ing.yieldRate);
}
exports.ingredientLineCost = ingredientLineCost;
/** 配合行の量を、材料の購入単位系の量へ換算する */
function toPackUnitAmount(ing, amount, unit) {
    if (unit === ing.packUnit)
        return amount;
    // 個→g/ml: pieceGrams で換算（例: 卵1個=50g）
    if (unit === "個" && (ing.packUnit === "g" || ing.packUnit === "ml")) {
        if (!ing.pieceGrams) {
            throw new CostError("no-piece-grams", `${ing.name}: 個数配合に必要な1個あたりgが未設定`);
        }
        // 配合は g・購入は ml のとき、1個あたり g を比重で ml に直す（比重が無ければ従来どおり g≒ml）
        const grams = amount * ing.pieceGrams;
        return ing.packUnit === "ml" && (0, density_1.validDensity)(ing.densityGPerMl) ? grams / ing.densityGPerMl : grams;
    }
    // g→個: 逆換算
    if ((unit === "g" || unit === "ml") && ing.packUnit === "個") {
        if (!ing.pieceGrams) {
            throw new CostError("no-piece-grams", `${ing.name}: g配合に必要な1個あたりgが未設定`);
        }
        return amount / ing.pieceGrams;
    }
    // g⇔ml は材料の比重（1mlが何g）で換算する。比重が無ければ換算しない（黙って 1 とみなさない）
    if (unit === "g" && ing.packUnit === "ml" && (0, density_1.validDensity)(ing.densityGPerMl))
        return amount / ing.densityGPerMl;
    if (unit === "ml" && ing.packUnit === "g" && (0, density_1.validDensity)(ing.densityGPerMl))
        return amount * ing.densityGPerMl;
    if ((unit === "g" && ing.packUnit === "ml") || (unit === "ml" && ing.packUnit === "g")) {
        throw new CostError("unit-mismatch", (0, density_1.densityNeededMessage)(ing.name, unit, ing.packUnit));
    }
    throw new CostError("unit-mismatch", `${ing.name}: ${unit}→${ing.packUnit} は換算できない`);
}
/** 人件費（円/バッチ） */
function laborCost(recipe, defaultHourlyWage) {
    const wage = recipe.labor.hourlyWageOverride ?? defaultHourlyWage;
    return (recipe.labor.minutes / 60) * wage;
}
exports.laborCost = laborCost;
/** バッチの材料費（ロス込み・仕込みの再帰込み・人件費含まず） */
function batchMaterialsCost(recipe, ctx, seen = new Set()) {
    if (seen.has(recipe.id)) {
        throw new CostError("cycle", `${recipe.name}: 中間レシピが循環参照`);
    }
    if (!(recipe.lossRate >= 0 && recipe.lossRate < 1)) {
        throw new CostError("bad-rate", `${recipe.name}: 製造ロス率が[0,1)の外`);
    }
    seen.add(recipe.id);
    let sum = 0;
    for (const line of recipe.lines) {
        if (line.ref.kind === "ingredient") {
            const ing = ctx.ingredients.get(line.ref.id);
            if (!ing)
                throw new CostError("missing-ingredient", `材料が見つからない: ${line.ref.id}`);
            sum += ingredientLineCost(ing, line.amount, line.unit);
        }
        else {
            const sub = ctx.recipes.get(line.ref.id);
            if (!sub)
                throw new CostError("missing-recipe", `中間レシピが見つからない: ${line.ref.id}`);
            sum += subRecipeCostPerGram(sub, ctx, seen) * gramsOfLine(sub, line.amount, line.unit);
        }
    }
    seen.delete(recipe.id);
    return sum / (1 - recipe.lossRate);
}
exports.batchMaterialsCost = batchMaterialsCost;
/** 仕込みのg単価 = (バッチ材料費 + 人件費) ÷ 出来高総量g */
function subRecipeCostPerGram(sub, ctx, seen) {
    if (!sub.yieldTotalGrams || sub.yieldTotalGrams <= 0) {
        throw new CostError("no-yield-grams", `${sub.name}: 中間レシピ参照に必要な出来高総量gが未設定`);
    }
    const cost = batchMaterialsCost(sub, ctx, seen) + laborCost(sub, ctx.defaultHourlyWage);
    return cost / sub.yieldTotalGrams;
}
/** 中間レシピ行の量をgへ（個数指定なら出来高から1個あたりgを引く） */
function gramsOfLine(sub, amount, unit) {
    if (unit === "g" || unit === "ml")
        return amount;
    if (!sub.yieldTotalGrams || sub.yieldCount <= 0) {
        throw new CostError("no-yield-grams", `${sub.name}: 個数参照に必要な出来高が未設定`);
    }
    return amount * (sub.yieldTotalGrams / sub.yieldCount);
}
/**
 * 配合行ごとの費用（円/バッチ・ロス割り増し前）。配合画面の行の右に出す。
 * 1行が計算できなくても他の行は出す（どの行が悪いかを見せるため、例外を行に閉じ込める）
 */
function recipeLineCosts(recipe, ctx) {
    return recipe.lines.map((line) => {
        try {
            if (line.ref.kind === "ingredient") {
                const ing = ctx.ingredients.get(line.ref.id);
                if (!ing)
                    throw new CostError("missing-ingredient", "材料が見つかりません");
                return { cost: ingredientLineCost(ing, line.amount, line.unit) };
            }
            const sub = ctx.recipes.get(line.ref.id);
            if (!sub)
                throw new CostError("missing-recipe", "仕込みレシピが見つかりません");
            return {
                cost: subRecipeCostPerGram(sub, ctx, new Set([recipe.id])) * gramsOfLine(sub, line.amount, line.unit),
            };
        }
        catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    });
}
exports.recipeLineCosts = recipeLineCosts;
/**
 * 単価が入っていない（0円以下の）材料。仕込みレシピの中までたどる。
 * 単価0のまま原価を出すと「安く見える嘘の原価」になるので、画面はこれが空でない間は
 * 原価を「仮」と明示する。定番材料（data/staples.ts）は単価0で登録されるので、ここで拾われる
 */
function unpricedIngredients(recipe, ctx) {
    const found = new Map();
    const seen = new Set();
    const walk = (r) => {
        if (seen.has(r.id))
            return;
        seen.add(r.id);
        for (const line of r.lines) {
            if (line.ref.kind === "ingredient") {
                const ing = ctx.ingredients.get(line.ref.id);
                if (ing && !(ing.purchasePrice > 0))
                    found.set(ing.id, ing);
            }
            else {
                const sub = ctx.recipes.get(line.ref.id);
                if (sub)
                    walk(sub);
            }
        }
    };
    walk(recipe);
    return [...found.values()];
}
exports.unpricedIngredients = unpricedIngredients;
/** レシピの原価一式。UIの原価ビューはこれだけ見ればよい */
function costBreakdown(recipe, ctx) {
    if (recipe.yieldCount <= 0) {
        throw new CostError("bad-rate", `${recipe.name}: 出来高個数が0以下`);
    }
    if (!(recipe.feeRate >= 0 && recipe.feeRate < 1)) {
        throw new CostError("bad-rate", `${recipe.name}: 手数料率が[0,1)の外`);
    }
    const batchMaterials = batchMaterialsCost(recipe, ctx);
    const batchLabor = laborCost(recipe, ctx.defaultHourlyWage);
    const materialsPerPiece = batchMaterials / recipe.yieldCount;
    const laborPerPiece = batchLabor / recipe.yieldCount;
    const basePerPiece = materialsPerPiece + laborPerPiece + recipe.packagingCostPerPiece;
    const feePerPiece = recipe.price != null ? recipe.feeRate * recipe.price : 0;
    const totalPerPiece = basePerPiece + feePerPiece;
    return {
        batchMaterials,
        batchLabor,
        materialsPerPiece,
        laborPerPiece,
        packagingPerPiece: recipe.packagingCostPerPiece,
        feePerPiece,
        basePerPiece,
        totalPerPiece,
        costRate: recipe.price != null && recipe.price > 0 ? totalPerPiece / recipe.price : undefined,
    };
}
exports.costBreakdown = costBreakdown;
/**
 * 売価逆算: 目標原価率 t・手数料率 f のとき 総原価 = 基礎 + f×価格 = t×価格
 * → 価格 = 基礎 ÷ (t − f)。t ≤ f だと手数料だけで目標を食い潰すので解なし。
 */
function suggestedPrice(recipe, ctx, targetCostRate) {
    if (!(targetCostRate > 0 && targetCostRate <= 1)) {
        throw new CostError("bad-rate", "目標原価率が(0,1]の外");
    }
    if (targetCostRate <= recipe.feeRate) {
        throw new CostError("bad-rate", "目標原価率が手数料率以下（解なし）");
    }
    const b = costBreakdown(recipe, ctx);
    return b.basePerPiece / (targetCostRate - recipe.feeRate);
}
exports.suggestedPrice = suggestedPrice;
/** 死守ラインが未設定のときの売価逆算の目標原価率（原価ビューの初期値・課金画面の試算で共用） */
exports.DEFAULT_TARGET_COST_RATE = 0.3;
/**
 * 売価逆算に使う目標原価率（%・小数1桁）。レシピ編集が死守ラインを小数1桁で見せるのと同じ丸め。
 * 原価ビューの初期値と課金画面の試算は必ずここを通す——別々に丸めると同じレシピで推奨売価が食い違う
 */
function suggestTargetPct(recipe) {
    return recipe.targetCostRate != null
        ? Math.round(recipe.targetCostRate * 1000) / 10
        : exports.DEFAULT_TARGET_COST_RATE * 100;
}
exports.suggestTargetPct = suggestTargetPct;
/** 売価の丸め（既定: 10円単位で切り上げ）。表示用 */
function roundPriceUp(price, step = 10) {
    return Math.ceil(price / step - 1e-9) * step;
}
exports.roundPriceUp = roundPriceUp;
function costVerdict(costRate, targetCostRate, warnMargin = 0.05) {
    if (costRate > targetCostRate)
        return "over";
    if (costRate > targetCostRate - warnMargin)
        return "warn";
    return "ok";
}
exports.costVerdict = costVerdict;

},
"./density": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.densityMissingNames = exports.densityNeededMessage = exports.mlToGrams = exports.validDensity = exports.densityHintFor = exports.DENSITY_HINTS = void 0;
const SRC_CUP = "計量表（カップ200mlあたりの重さ・国立健康・栄養研究所ほか）";
exports.DENSITY_HINTS = [
    { test: (n) => /生クリーム|ホイップクリーム|^クリーム/.test(n) && !/チーズ/.test(n), gPerMl: 1.0, source: `${SRC_CUP} 200g` },
    { test: (n) => /牛乳|^ミルク$/.test(n), gPerMl: 1.03, source: "牛乳の一般値（資料により200〜210g/カップ）" },
    { test: (n) => /はちみつ|ハチミツ|蜂蜜/.test(n), gPerMl: 1.4, source: `${SRC_CUP} 280g` },
    { test: (n) => /(油|オイル)(（.*）)?$/.test(n), gPerMl: 0.9, source: `${SRC_CUP} 植物油180g` },
    { test: (n) => /^(水|お水|ミネラルウォーター)$/.test(n), gPerMl: 1.0, source: `${SRC_CUP} 200g` },
];
/** 材料名から比重の目安を引く。無ければ undefined（推測で 1 を返さない） */
function densityHintFor(name) {
    const n = name.normalize("NFKC").trim();
    return exports.DENSITY_HINTS.find((h) => h.test(n));
}
exports.densityHintFor = densityHintFor;
function validDensity(d) {
    return d != null && Number.isFinite(d) && d > 0 && d <= 20;
}
exports.validDensity = validDensity;
/**
 * 量を g に直す。g はそのまま、ml は比重を掛ける（比重が無ければ undefined）。個は呼び出し側
 */
function mlToGrams(ing, ml) {
    return validDensity(ing.densityGPerMl) ? ml * ing.densityGPerMl : undefined;
}
exports.mlToGrams = mlToGrams;
/** 比重が無くて換算できないときの案内（原価・ラベルで共通の文言） */
function densityNeededMessage(name, from, to) {
    const hint = densityHintFor(name);
    const guess = hint ? `（目安 ${hint.gPerMl}）` : "";
    return `${name}: ${from}→${to} の換算に比重（1mlが何g）が要ります。材料の画面の「比重」に入れてください${guess}`;
}
exports.densityNeededMessage = densityNeededMessage;
/**
 * ml で配合しているのに比重が無い材料の名前（仕込みの中も見る）。
 * 重量順・栄養は比重が無いと水と同じ 1 とみなすので、画面で「入れると正確になります」と案内する
 */
function densityMissingNames(recipe, ctx, seen = new Set()) {
    if (seen.has(recipe.id))
        return [];
    seen.add(recipe.id);
    const out = new Set();
    for (const line of recipe.lines) {
        if (line.ref.kind === "ingredient") {
            const ing = ctx.ingredients.get(line.ref.id);
            if (ing && line.unit === "ml" && !validDensity(ing.densityGPerMl))
                out.add(ing.name);
        }
        else {
            const sub = ctx.recipes.get(line.ref.id);
            if (sub)
                for (const n of densityMissingNames(sub, ctx, seen))
                    out.add(n);
        }
    }
    seen.delete(recipe.id);
    return [...out];
}
exports.densityMissingNames = densityMissingNames;

},
"./allergens": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortAllergenIds = exports.allergenName = exports.ALLERGENS = void 0;
exports.ALLERGENS = [
    // 特定原材料（義務）9品目
    { id: "ebi", name: "えび", mandatory: true },
    { id: "kani", name: "かに", mandatory: true },
    { id: "kurumi", name: "くるみ", mandatory: true },
    { id: "komugi", name: "小麦", mandatory: true },
    { id: "soba", name: "そば", mandatory: true },
    { id: "tamago", name: "卵", mandatory: true },
    // 「乳」は表示では必ず「乳成分」（「乳を含む」は認められない）。消費者庁
    // アレルゲンを含む食品に関する表示 E-10・アレルギー表示ハンドブック（令和8年4月）p.8。2026-09-11 是正
    { id: "nyu", name: "乳成分", mandatory: true },
    { id: "rakkasei", name: "落花生", mandatory: true },
    { id: "cashew", name: "カシューナッツ", mandatory: true },
    // 推奨20品目
    { id: "almond", name: "アーモンド", mandatory: false },
    { id: "awabi", name: "あわび", mandatory: false },
    { id: "ika", name: "いか", mandatory: false },
    { id: "ikura", name: "いくら", mandatory: false },
    { id: "orange", name: "オレンジ", mandatory: false },
    { id: "kiwi", name: "キウイフルーツ", mandatory: false },
    { id: "gyuniku", name: "牛肉", mandatory: false },
    { id: "goma", name: "ごま", mandatory: false },
    { id: "sake", name: "さけ", mandatory: false },
    { id: "saba", name: "さば", mandatory: false },
    { id: "daizu", name: "大豆", mandatory: false },
    { id: "toriniku", name: "鶏肉", mandatory: false },
    { id: "banana", name: "バナナ", mandatory: false },
    { id: "butaniku", name: "豚肉", mandatory: false },
    { id: "pistachio", name: "ピスタチオ", mandatory: false },
    { id: "macadamia", name: "マカダミアナッツ", mandatory: false },
    { id: "momo", name: "もも", mandatory: false },
    { id: "yamaimo", name: "やまいも", mandatory: false },
    { id: "ringo", name: "りんご", mandatory: false },
    { id: "gelatin", name: "ゼラチン", mandatory: false },
];
const byId = new Map(exports.ALLERGENS.map((a) => [a.id, a]));
function allergenName(id) {
    return byId.get(id)?.name ?? id;
}
exports.allergenName = allergenName;
/** 表示順: リスト定義順（義務8→推奨20） */
function sortAllergenIds(ids) {
    const order = new Map(exports.ALLERGENS.map((a, i) => [a.id, i]));
    return [...new Set(ids)].sort((x, y) => (order.get(x) ?? 999) - (order.get(y) ?? 999));
}
exports.sortAllergenIds = sortAllergenIds;

},
"./label": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pieceBasisLabel = exports.formatSaltG = exports.expiryLabel = exports.recipeAllergens = exports.topIngredient = exports.suggestLabelField = exports.ingredientStatement = void 0;
const cost_1 = require("./cost");
const density_1 = require("./density");
const allergens_1 = require("./allergens");
function ingredientGrams(ing, amount, unit) {
    // 重量順は g で比べる。ml は比重で g に直す（比重が無ければ 1 とみなす。画面で注意を出す: densityMissingNames）
    if (unit === "ml")
        return (0, density_1.validDensity)(ing.densityGPerMl) ? amount * ing.densityGPerMl : amount;
    if (unit === "g")
        return amount;
    if (!ing.pieceGrams) {
        throw new cost_1.CostError("no-piece-grams", `${ing.name}: 個数配合の表示計算に1個あたりgが必要`);
    }
    return amount * ing.pieceGrams;
}
function collectItems(recipe, ctx, seen) {
    if (seen.has(recipe.id)) {
        throw new cost_1.CostError("cycle", `${recipe.name}: 中間レシピが循環参照`);
    }
    seen.add(recipe.id);
    const items = [];
    for (const line of recipe.lines) {
        if (line.ref.kind === "ingredient") {
            const ing = ctx.ingredients.get(line.ref.id);
            if (!ing)
                throw new cost_1.CostError("missing-ingredient", `材料が見つからない: ${line.ref.id}`);
            items.push({
                name: ing.labelName ?? ing.name,
                grams: ingredientGrams(ing, line.amount, line.unit),
                allergenIds: ing.allergens,
                additive: ing.isAdditive === true,
            });
        }
        else {
            const sub = ctx.recipes.get(line.ref.id);
            if (!sub)
                throw new cost_1.CostError("missing-recipe", `中間レシピが見つからない: ${line.ref.id}`);
            if (!sub.yieldTotalGrams || sub.yieldTotalGrams <= 0) {
                throw new cost_1.CostError("no-yield-grams", `${sub.name}: 表示計算に出来高総量gが必要`);
            }
            const grams = line.unit === "個" ? line.amount * (sub.yieldTotalGrams / sub.yieldCount) : line.amount;
            const children = collectItems(sub, ctx, seen);
            // 仕込み全量に対する使用比で内訳の重量を按分（順序は比を掛けても不変）
            const ratio = grams / sub.yieldTotalGrams;
            items.push({
                name: sub.labelFields?.productName ?? sub.name,
                grams,
                children: children.map((c) => ({ ...c, grams: c.grams * ratio })),
                allergenIds: children.flatMap((c) => c.allergenIds),
            });
        }
    }
    seen.delete(recipe.id);
    return sortByWeight(items);
}
function sortByWeight(items) {
    // 同名材料（別行で複数回配合）は合算してから降順
    const merged = new Map();
    for (const it of items) {
        const prev = merged.get(it.name);
        if (prev && !prev.children && !it.children) {
            prev.grams += it.grams;
        }
        else {
            merged.set(prev ? `${it.name}#${merged.size}` : it.name, { ...it });
        }
    }
    return [...merged.values()].sort((a, b) => b.grams - a.grams);
}
/**
 * 原材料名の文字列（重量降順・複合原材料は括弧展開・アレルゲン集約付き）。
 *
 * 原料原産地（labelFields.topOrigin）: 国内で作る加工食品は、重量1位の原材料の原産地を書く
 * （2022-04 全面施行の原料原産地表示制度）。書き方は原材料名の直後の括弧「小麦粉（国内製造）」。
 * 重量1位が仕込み（複合原材料）のときは自動では付けない——内訳の括弧との並べ方を
 * 確かめていないので、画面で注意を出して本人に書いてもらう（topIngredient().compound）
 */
function ingredientStatement(recipe, ctx) {
    const items = collectItems(recipe, ctx, new Set());
    const { materials, additives } = splitAdditives(items);
    const origin = recipe.labelFields?.topOrigin?.trim();
    const names = materials
        .map((it, i) => (i === 0 && origin && !it.children?.length ? `${it.name}（${origin}）` : render(it)))
        .join("、");
    // 添加物は原材料と「／」で区分する（別記様式1。消費者庁の記載例「…食塩／膨脹剤、香料、（一部に…）」）
    const additivePart = additives.length > 0 ? `／${additives.map((a) => a.name).join("、")}` : "";
    const allergens = (0, allergens_1.sortAllergenIds)(items.flatMap((i) => i.allergenIds)).map(allergens_1.allergenName);
    // 一括表示は原材料名の最後に「、」で続けて置く（消費者庁 別添 E-7・E-8、食パンの記載例
    // 「…食塩、（一部に小麦・乳成分を含む）」）。「、」が無いと最後の原材料だけの個別表示に読める
    const suffix = allergens.length > 0 ? `、（一部に${allergens.join("・")}を含む）` : "";
    return names + additivePart + suffix;
}
exports.ingredientStatement = ingredientStatement;
/**
 * 原材料と添加物に分ける。仕込み（複合原材料）の中の添加物も取り出して、製品全体の添加物として
 * まとめる（複合原材料の内訳には添加物を書かず、製品の添加物欄に書く）。添加物は同名を合算して重量降順
 */
function splitAdditives(items) {
    const additives = [];
    const walk = (list) => {
        const kept = [];
        for (const it of list) {
            if (it.additive) {
                additives.push(it);
            }
            else if (it.children && it.children.length > 0) {
                kept.push({ ...it, children: walk(it.children) });
            }
            else {
                kept.push(it);
            }
        }
        return kept;
    };
    const materials = walk(items);
    return { materials, additives: sortByWeight(additives) };
}
function render(item) {
    if (!item.children || item.children.length === 0)
        return item.name;
    return `${item.name}（${item.children.map(render).join("、")}）`;
}
function suggestLabelField(recipes, field, excludeId) {
    const counts = new Map();
    for (const r of recipes) {
        if (r.isSample || r.id === excludeId)
            continue;
        const v = r.labelFields?.[field]?.trim();
        if (v)
            counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best;
    let bestN = 0;
    for (const [v, n] of counts) {
        if (n > bestN) {
            best = v;
            bestN = n;
        }
    }
    return best;
}
exports.suggestLabelField = suggestLabelField;
/** 重量1位の原材料（原料原産地を書く相手）。配合が空・計算できないときは undefined */
function topIngredient(recipe, ctx) {
    try {
        const { materials } = splitAdditives(collectItems(recipe, ctx, new Set()));
        if (materials.length === 0)
            return undefined;
        return { name: materials[0].name, compound: (materials[0].children?.length ?? 0) > 0 };
    }
    catch {
        return undefined;
    }
}
exports.topIngredient = topIngredient;
/**
 * 含まれるアレルゲン（特定原材料等）の名前。原材料名の「（一部に…を含む）」と同じ並び。
 * 無料版で原材料名を伏せても、これは必ず見せる（安全の判断に要る情報を課金で閉じない・2026-10-01）
 */
function recipeAllergens(recipe, ctx) {
    const items = collectItems(recipe, ctx, new Set());
    return (0, allergens_1.sortAllergenIds)(items.flatMap((i) => i.allergenIds)).map(allergens_1.allergenName);
}
exports.recipeAllergens = recipeAllergens;
/** 期限欄の見出し */
function expiryLabel(fields) {
    return fields?.expiryKind === "use" ? "消費期限" : "賞味期限";
}
exports.expiryLabel = expiryLabel;
/**
 * 食塩相当量の表示値（単位 g は付けない）。
 * - 0.1 g 以上: 小数第1位（最小表示の位。その1つ下を四捨五入）
 * - 0.1 g 未満: 有効数字1桁（例 0.004）。以前は常に小数2桁で「0.00」になっていた（Q&A 加工-111②）
 * - 「0」と書けるのは、食品100g当たりのナトリウムが 5 mg 未満（食塩相当量 0.0127 g 未満）のときだけ。
 *   100g当たりの値が分からない（全体の重さ未入力）ときは 0 にしない
 */
function formatSaltG(g, saltPer100g) {
    const ZERO_PER_100G = 0.005 * 2.54;
    if (!(g > 0) || (saltPer100g != null && saltPer100g < ZERO_PER_100G))
        return "0";
    if (g >= 0.095)
        return (Math.round(g * 10) / 10).toFixed(1);
    // 有効数字1桁に丸めてから桁数を決める（0.0096 → 0.01 のように桁が上がる場合があるため）
    const rounded = Number(g.toPrecision(1));
    return rounded.toFixed(-Math.floor(Math.log10(rounded)));
}
exports.formatSaltG = formatSaltG;
/**
 * 栄養成分表示の「1個当たり」の食品単位。出来高の総量と個数が分かれば「1個（○g）当たり」
 * （docs/label-format.md の様式どおり。重さの併記）。分からなければ重さなしの「1個当たり」
 */
function pieceBasisLabel(recipe) {
    const total = recipe.yieldTotalGrams;
    if (!(total && total > 0) || !(recipe.yieldCount > 0))
        return "1個当たり";
    const g = total / recipe.yieldCount;
    const shown = g >= 10 ? String(Math.round(g)) : String(Math.round(g * 10) / 10);
    return `1個（${shown}g）当たり`;
}
exports.pieceBasisLabel = pieceBasisLabel;

},
"./nutrition": function (module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recipeNutrition = exports.scale = exports.ZERO_NUTRITION = void 0;
const cost_1 = require("./cost");
const density_1 = require("./density");
exports.ZERO_NUTRITION = {
    energyKcal: 0,
    proteinG: 0,
    fatG: 0,
    carbG: 0,
    saltG: 0,
};
function add(a, b, factor) {
    return {
        energyKcal: a.energyKcal + b.energyKcal * factor,
        proteinG: a.proteinG + b.proteinG * factor,
        fatG: a.fatG + b.fatG * factor,
        carbG: a.carbG + b.carbG * factor,
        saltG: a.saltG + b.saltG * factor,
    };
}
function scale(n, factor) {
    return add(exports.ZERO_NUTRITION, n, factor);
}
exports.scale = scale;
/** 配合行のgを求める。ml は材料の比重で g に直す（比重が無ければ水と同じ 1 とみなす・画面で注意を出す） */
function lineGrams(ing, amount, unit) {
    if (unit === "ml")
        return (0, density_1.validDensity)(ing.densityGPerMl) ? amount * ing.densityGPerMl : amount;
    if (unit === "g")
        return amount;
    if (!ing.pieceGrams) {
        throw new cost_1.CostError("no-piece-grams", `${ing.name}: 個数配合の栄養計算に1個あたりgが必要`);
    }
    return amount * ing.pieceGrams;
}
/** レシピの栄養（仕込みは再帰展開）。循環は原価側の保存時拒否に依存しつつ二重防御 */
function recipeNutrition(recipe, ctx, seen = new Set()) {
    if (seen.has(recipe.id)) {
        throw new cost_1.CostError("cycle", `${recipe.name}: 中間レシピが循環参照`);
    }
    seen.add(recipe.id);
    let total = exports.ZERO_NUTRITION;
    const missing = [];
    for (const line of recipe.lines) {
        if (line.ref.kind === "ingredient") {
            const ing = ctx.ingredients.get(line.ref.id);
            if (!ing)
                throw new cost_1.CostError("missing-ingredient", `材料が見つからない: ${line.ref.id}`);
            const n = ing.hattoCode ? ctx.nutritionByHattoCode.get(ing.hattoCode) : undefined;
            if (!n) {
                missing.push(ing.name);
                continue;
            }
            total = add(total, n, lineGrams(ing, line.amount, line.unit) / 100);
        }
        else {
            const sub = ctx.recipes.get(line.ref.id);
            if (!sub)
                throw new cost_1.CostError("missing-recipe", `中間レシピが見つからない: ${line.ref.id}`);
            if (!sub.yieldTotalGrams || sub.yieldTotalGrams <= 0) {
                throw new cost_1.CostError("no-yield-grams", `${sub.name}: 栄養計算に出来高総量gが必要`);
            }
            const subN = recipeNutrition(sub, ctx, seen);
            missing.push(...subN.missing);
            const grams = line.unit === "個" ? line.amount * (sub.yieldTotalGrams / sub.yieldCount) : line.amount;
            // 仕込み全量に対する使用gの比で按分
            total = add(total, subN.total, grams / sub.yieldTotalGrams);
        }
    }
    seen.delete(recipe.id);
    return {
        total,
        perPiece: scale(total, 1 / recipe.yieldCount),
        per100g: recipe.yieldTotalGrams ? scale(total, 100 / recipe.yieldTotalGrams) : undefined,
        missing,
    };
}
exports.recipeNutrition = recipeNutrition;

}
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
