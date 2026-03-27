// ============================================================
// evaluation.test.ts — Tests unitaires du moteur d'évaluation
//
// Compatible Jest / Vitest.
// Lancer avec : npx vitest evaluation.test.ts
//               ou : npx jest evaluation.test.ts
// ============================================================

import { evaluateRun } from "./evaluation.run";
import { evaluateVariant } from "./evaluation.variant";
import { evaluateVariantComparison } from "./evaluation.comparison";
import {
  warnNoTrades,
  warnSmallSample,
  warnShortPeriod,
  warnSingleTradeDominance,
  warnIncomparablePeriods,
  warnMixedRunTypes,
} from "./evaluation.warnings";
import { computeComparisonScore, scoreDominanceRatio } from "./evaluation.helpers";
import type { RunMetrics, VariantMetrics } from "./evaluation.types";

// ============================================================
// Fixtures
// ============================================================

const goodRun: RunMetrics = {
  id: "run-good",
  name: "Backtest Q1 2025",
  runType: "backtest",
  tradeCount: 80,
  pnl: 2400,
  winRate: 0.65,
  profitFactor: 2.1,
  expectancy: 30,
  maxDrawdown: -0.07,
  avgWin: 85,
  avgLoss: -45,
  bestTrade: 320,
  worstTrade: -130,
  totalPositivePnl: 6800,
  totalNegativePnl: -4400,
  periodStart: "2025-01-01",
  periodEnd: "2025-03-31",
  coveredDays: 90,
};

const smallRun: RunMetrics = {
  ...goodRun,
  id: "run-small",
  tradeCount: 12,
  pnl: 400,
};

const emptyRun: RunMetrics = {
  ...goodRun,
  id: "run-empty",
  tradeCount: 0,
  pnl: null,
  winRate: null,
  profitFactor: null,
};

const badRun: RunMetrics = {
  ...goodRun,
  id: "run-bad",
  tradeCount: 60,
  pnl: -1500,
  winRate: 0.3,
  profitFactor: 0.6,
  expectancy: -25,
  maxDrawdown: -0.35,
};

const singleDominantRun: RunMetrics = {
  ...goodRun,
  id: "run-dominant",
  tradeCount: 50,
  bestTrade: 1800,
  totalPositivePnl: 2000, // bestTrade = 90% du total des gains
};

const shortPeriodRun: RunMetrics = {
  ...goodRun,
  id: "run-short",
  coveredDays: 3,
};

const goodVariant: VariantMetrics = {
  id: "var-good",
  name: "EMA cross v2",
  tradeCount: 120,
  pnl: 4200,
  winRate: 0.62,
  profitFactor: 1.9,
  expectancy: 35,
  maxDrawdown: -0.09,
  avgWin: 90,
  avgLoss: -50,
  bestTrade: 350,
  worstTrade: -140,
  totalPositivePnl: 10800,
  totalNegativePnl: -6600,
  periodStart: "2025-01-01",
  periodEnd: "2025-06-30",
  coveredDays: 180,
  runTypes: ["backtest"],
  runsCount: 3,
};

const emptyVariant: VariantMetrics = {
  ...goodVariant,
  id: "var-empty",
  name: "Empty",
  tradeCount: 0,
  runsCount: 0,
};

const mixedVariant: VariantMetrics = {
  ...goodVariant,
  id: "var-mixed",
  name: "Mixed types",
  runTypes: ["backtest", "live"],
};

const smallVariant: VariantMetrics = {
  ...goodVariant,
  id: "var-small",
  name: "Small sample",
  tradeCount: 18,
};

const badVariant: VariantMetrics = {
  ...goodVariant,
  id: "var-bad",
  name: "Losing variant",
  pnl: -3000,
  winRate: 0.28,
  profitFactor: 0.55,
  expectancy: -25,
  maxDrawdown: -0.42,
};

// ============================================================
// Tests — evaluateRun
// ============================================================

describe("evaluateRun", () => {
  it("retourne 'invalid' pour un run vide (0 trade)", () => {
    const result = evaluateRun(emptyRun);
    expect(result.verdict).toBe("invalid");
    expect(result.confidence).toBe("low");
    expect(result.warnings.some((w) => w.code === "NO_TRADES")).toBe(true);
  });

  it("retourne 'promising' pour un run avec de bons indicateurs", () => {
    const result = evaluateRun(goodRun);
    expect(result.verdict).toBe("promising");
    expect(result.confidence).toBe("high");
    expect(result.strengths.length).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.recommendedAction.type).toBe("use_in_variant");
  });

  it("retourne 'fragile' pour un petit échantillon positif", () => {
    const result = evaluateRun(smallRun);
    expect(result.verdict).toBe("fragile");
    expect(result.confidence).toBe("low");
    expect(result.warnings.some((w) => w.code === "SMALL_SAMPLE")).toBe(true);
    expect(result.recommendedAction.type).toBe("keep_testing");
  });

  it("retourne 'inconclusive' pour un run avec PnL et PF négatifs", () => {
    const result = evaluateRun(badRun);
    expect(result.verdict).toBe("inconclusive");
    expect(result.weaknesses.length).toBeGreaterThan(0);
    expect(result.recommendedAction.type).toBe("discard_run");
  });

  it("détecte le warning SINGLE_TRADE_DOMINANCE", () => {
    const result = evaluateRun(singleDominantRun);
    expect(result.warnings.some((w) => w.code === "SINGLE_TRADE_DOMINANCE")).toBe(true);
  });

  it("détecte le warning SHORT_PERIOD", () => {
    const result = evaluateRun(shortPeriodRun);
    expect(result.warnings.some((w) => w.code === "SHORT_PERIOD")).toBe(true);
  });

  it("le résumé (summary) est une chaîne non vide", () => {
    const result = evaluateRun(goodRun);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("nextSteps est non vide pour un verdict fragile", () => {
    const result = evaluateRun(smallRun);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Tests — evaluateVariant
// ============================================================

describe("evaluateVariant", () => {
  it("retourne 'invalid' pour une variante sans runs", () => {
    const result = evaluateVariant(emptyVariant);
    expect(result.verdict).toBe("invalid");
    expect(result.warnings.some((w) => w.code === "NO_TRADES")).toBe(true);
  });

  it("retourne 'promising' pour une bonne variante consolidée", () => {
    const result = evaluateVariant(goodVariant);
    expect(result.verdict).toBe("promising");
    expect(result.recommendedAction.type).toBe("promote_to_active_candidate");
    expect(result.confidence).toBe("high");
  });

  it("retourne 'fragile' et action 'split_by_run_type' pour un mélange de types", () => {
    const result = evaluateVariant(mixedVariant);
    expect(result.verdict).toBe("fragile");
    expect(result.recommendedAction.type).toBe("split_by_run_type");
    expect(result.warnings.some((w) => w.code === "MIXED_RUN_TYPES")).toBe(true);
  });

  it("retourne 'inconclusive' pour une variante perdante", () => {
    const result = evaluateVariant(badVariant);
    expect(result.verdict).toBe("inconclusive");
    expect(result.recommendedAction.type).toBe("archive_variant");
  });

  it("détecte le warning SMALL_SAMPLE sur une petite variante", () => {
    const result = evaluateVariant(smallVariant);
    expect(result.warnings.some((w) => w.code === "SMALL_SAMPLE")).toBe(true);
  });

  it("mentionne les runs consolidés dans les forces si runsCount >= 3", () => {
    const result = evaluateVariant(goodVariant);
    expect(result.strengths.some((s) => s.includes("runs distincts"))).toBe(true);
  });
});

// ============================================================
// Tests — evaluateVariantComparison
// ============================================================

describe("evaluateVariantComparison", () => {
  it("retourne 'promote_b' quand B domine clairement sur toutes les métriques", () => {
    const weakA: VariantMetrics = {
      ...goodVariant,
      id: "var-a",
      name: "Variante A",
      pnl: 500,
      winRate: 0.45,
      profitFactor: 1.1,
      expectancy: 5,
      maxDrawdown: -0.3,
      tradeCount: 80,
    };
    const strongB: VariantMetrics = {
      ...goodVariant,
      id: "var-b",
      name: "Variante B",
      pnl: 4200,
      winRate: 0.65,
      profitFactor: 2.2,
      expectancy: 35,
      maxDrawdown: -0.08,
      tradeCount: 80,
    };
    const result = evaluateVariantComparison({ variantA: weakA, variantB: strongB });
    expect(result.verdict).toBe("promote_b");
    expect(result.winner).toBe("b");
    expect(result.strengthsB.length).toBeGreaterThan(0);
    expect(result.weaknessesA.length).toBeGreaterThan(0);
    expect(result.recommendedAction.type).toBe("promote");
    expect(result.recommendedAction.target).toBe("b");
  });

  it("retourne 'inconclusive' quand les deux variantes sont très proches", () => {
    const a: VariantMetrics = { ...goodVariant, id: "a", name: "A", pnl: 1000 };
    const b: VariantMetrics = { ...goodVariant, id: "b", name: "B", pnl: 1050 };
    const result = evaluateVariantComparison({ variantA: a, variantB: b });
    expect(result.verdict).toBe("inconclusive");
    expect(result.winner).toBeNull();
  });

  it("retourne 'keep_testing' quand B mène mais avec warnings critiques", () => {
    const smallA: VariantMetrics = {
      ...goodVariant,
      id: "a",
      name: "A",
      tradeCount: 10, // déclenche SMALL_SAMPLE
      pnl: 200,
    };
    const betterB: VariantMetrics = {
      ...goodVariant,
      id: "b",
      name: "B",
      pnl: 4200,
      winRate: 0.65,
      profitFactor: 2.2,
      expectancy: 35,
      maxDrawdown: -0.08,
    };
    const result = evaluateVariantComparison({ variantA: smallA, variantB: betterB });
    expect(result.verdict).toBe("keep_testing");
    expect(result.warnings.some((w) => w.code === "SMALL_SAMPLE")).toBe(true);
  });

  it("retourne 'inconclusive' quand toutes les métriques sont nulles", () => {
    const nullA: VariantMetrics = {
      ...goodVariant,
      id: "a",
      name: "A",
      pnl: null,
      winRate: null,
      profitFactor: null,
      expectancy: null,
      maxDrawdown: null,
      tradeCount: 50,
    };
    const nullB: VariantMetrics = { ...nullA, id: "b", name: "B" };
    const result = evaluateVariantComparison({ variantA: nullA, variantB: nullB });
    expect(result.verdict).toBe("inconclusive");
    expect(result.score.total).toBe(0);
  });

  it("détecte le warning INCOMPARABLE_PERIODS", () => {
    const longA: VariantMetrics = { ...goodVariant, id: "a", name: "A", coveredDays: 180 };
    const shortB: VariantMetrics = { ...goodVariant, id: "b", name: "B", coveredDays: 20 };
    const result = evaluateVariantComparison({ variantA: longA, variantB: shortB });
    expect(result.warnings.some((w) => w.code === "INCOMPARABLE_PERIODS")).toBe(true);
  });

  it("score A gagne PnL (3pts) + Drawdown (2pts), B gagne le reste", () => {
    const a: VariantMetrics = {
      ...goodVariant,
      id: "a",
      name: "A",
      pnl: 5000,
      maxDrawdown: -0.05,
      expectancy: -5,
      winRate: 0.4,
      profitFactor: 0.9,
    };
    const b: VariantMetrics = {
      ...goodVariant,
      id: "b",
      name: "B",
      pnl: 1000,
      maxDrawdown: -0.3,
      expectancy: 20,
      winRate: 0.6,
      profitFactor: 1.8,
    };
    const result = evaluateVariantComparison({ variantA: a, variantB: b });
    expect(result.score.scoreA).toBe(5); // PnL(3) + DD(2)
    expect(result.score.scoreB).toBe(4); // Exp(2) + WR(1) + PF(1)
  });
});

// ============================================================
// Tests — Warnings unitaires
// ============================================================

describe("warnNoTrades", () => {
  it("retourne null pour tradeCount > 0", () => {
    expect(warnNoTrades(1, "run")).toBeNull();
    expect(warnNoTrades(50, "run")).toBeNull();
  });

  it("retourne un warning high pour tradeCount = 0", () => {
    const w = warnNoTrades(0, "run");
    expect(w).not.toBeNull();
    expect(w?.severity).toBe("high");
    expect(w?.code).toBe("NO_TRADES");
  });
});

describe("warnSmallSample", () => {
  it("retourne null pour tradeCount >= 30", () => {
    expect(warnSmallSample(30, "run")).toBeNull();
    expect(warnSmallSample(100, "run")).toBeNull();
  });

  it("retourne un warning high pour tradeCount entre 1 et 29", () => {
    const w = warnSmallSample(15, "run");
    expect(w?.severity).toBe("high");
    expect(w?.code).toBe("SMALL_SAMPLE");
  });

  it("retourne null pour tradeCount = 0 (géré par warnNoTrades)", () => {
    expect(warnSmallSample(0, "run")).toBeNull();
  });
});

describe("warnShortPeriod", () => {
  it("retourne null pour coveredDays >= 7", () => {
    expect(warnShortPeriod(7, "run")).toBeNull();
    expect(warnShortPeriod(90, "run")).toBeNull();
  });

  it("retourne un warning medium pour coveredDays < 7", () => {
    const w = warnShortPeriod(3, "run");
    expect(w?.severity).toBe("medium");
    expect(w?.code).toBe("SHORT_PERIOD");
  });

  it("retourne null pour coveredDays = null", () => {
    expect(warnShortPeriod(null, "run")).toBeNull();
  });
});

describe("warnSingleTradeDominance", () => {
  it("retourne null quand le ratio est <= 0.5", () => {
    expect(warnSingleTradeDominance(200, 400, "run")).toBeNull(); // ratio = 0.5
    expect(warnSingleTradeDominance(100, 400, "run")).toBeNull(); // ratio = 0.25
  });

  it("retourne un warning high quand le ratio > 0.5", () => {
    const w = warnSingleTradeDominance(600, 1000, "run"); // ratio = 0.6
    expect(w?.severity).toBe("high");
    expect(w?.code).toBe("SINGLE_TRADE_DOMINANCE");
    expect((w?.meta?.ratio as number)).toBeCloseTo(0.6);
  });

  it("retourne null si bestTrade ou totalPositivePnl est null", () => {
    expect(warnSingleTradeDominance(null, 1000, "run")).toBeNull();
    expect(warnSingleTradeDominance(600, null, "run")).toBeNull();
  });

  it("retourne null si totalPositivePnl = 0 (protection division par zéro)", () => {
    expect(warnSingleTradeDominance(500, 0, "run")).toBeNull();
  });
});

describe("warnIncomparablePeriods", () => {
  it("retourne null si les périodes sont comparables (ratio <= 0.2)", () => {
    expect(warnIncomparablePeriods(100, 90)).toBeNull(); // ratio = 0.1
    expect(warnIncomparablePeriods(100, 85)).toBeNull(); // ratio = 0.15
  });

  it("retourne un warning medium si ratio entre 0.2 et 0.5", () => {
    const w = warnIncomparablePeriods(100, 60); // ratio = 0.4
    expect(w?.severity).toBe("medium");
    expect(w?.code).toBe("INCOMPARABLE_PERIODS");
  });

  it("retourne un warning high si ratio > 0.5", () => {
    const w = warnIncomparablePeriods(180, 20); // ratio ≈ 0.89
    expect(w?.severity).toBe("high");
  });

  it("retourne null si l'une des valeurs est null ou <= 0", () => {
    expect(warnIncomparablePeriods(null, 100)).toBeNull();
    expect(warnIncomparablePeriods(100, null)).toBeNull();
    expect(warnIncomparablePeriods(0, 100)).toBeNull();
  });
});

describe("warnMixedRunTypes", () => {
  it("retourne null pour un seul type de run", () => {
    expect(warnMixedRunTypes(["backtest"], "variant")).toBeNull();
    expect(warnMixedRunTypes(["live", "live"], "variant")).toBeNull();
  });

  it("retourne un warning high pour un mélange de types", () => {
    const w = warnMixedRunTypes(["backtest", "live"], "variant");
    expect(w?.severity).toBe("high");
    expect(w?.code).toBe("MIXED_RUN_TYPES");
  });
});

// ============================================================
// Tests — computeComparisonScore
// ============================================================

describe("computeComparisonScore", () => {
  it("retourne scoreA=9 scoreB=0 quand A gagne toutes les métriques", () => {
    const a: VariantMetrics = {
      ...goodVariant,
      pnl: 5000,
      maxDrawdown: -0.05,
      expectancy: 40,
      winRate: 0.7,
      profitFactor: 2.5,
    };
    const b: VariantMetrics = {
      ...goodVariant,
      pnl: 1000,
      maxDrawdown: -0.3,
      expectancy: 5,
      winRate: 0.4,
      profitFactor: 1.1,
    };
    const score = computeComparisonScore(a, b);
    expect(score.scoreA).toBe(9);
    expect(score.scoreB).toBe(0);
    expect(score.total).toBe(9);
  });

  it("retourne total=0 si toutes les métriques sont nulles des deux côtés", () => {
    const nullV = (id: string): VariantMetrics => ({
      ...goodVariant,
      id,
      pnl: null,
      maxDrawdown: null,
      expectancy: null,
      winRate: null,
      profitFactor: null,
    });
    const score = computeComparisonScore(nullV("a"), nullV("b"));
    expect(score.total).toBe(0);
    expect(score.scoreA).toBe(0);
    expect(score.scoreB).toBe(0);
  });

  it("le DrawDown — la valeur absolue la plus faible gagne", () => {
    const a: VariantMetrics = { ...goodVariant, maxDrawdown: -0.1 }; // abs = 0.1
    const b: VariantMetrics = { ...goodVariant, maxDrawdown: -0.3 }; // abs = 0.3
    const score = computeComparisonScore(a, b);
    const ddDetail = score.details.find((d) => d.metric === "maxDrawdown");
    expect(ddDetail?.winner).toBe("a");
  });

  it("scoreDominanceRatio = 0 quand total = 0", () => {
    expect(scoreDominanceRatio(0, 0, 0)).toBe(0);
  });

  it("scoreDominanceRatio = 1 pour une dominance totale (9 vs 0 sur 9)", () => {
    expect(scoreDominanceRatio(9, 0, 9)).toBeCloseTo(1);
  });
});
