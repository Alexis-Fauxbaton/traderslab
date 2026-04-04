// ============================================================
// evaluation.formatters.ts — Génération de texte par règles
// ============================================================

import type {
  Verdict,
  ComparisonVerdict,
  Confidence,
  RunMetrics,
  VariantMetrics,
  Warning,
  WinnerSide,
  ScoreResult,
  MetricWinner,
  TTestResult,
  MonteCarloResult,
  SplitHalfResult,
} from "./evaluation.types";

// ---- Labels ----

export function verdictLabel(verdict: Verdict): string {
  const map: Record<Verdict, string> = {
    promising: "Prometteur",
    fragile: "Fragile",
    inconclusive: "Non concluant",
    invalid: "Invalide",
  };
  return map[verdict] ?? verdict;
}

export function comparisonVerdictLabel(verdict: ComparisonVerdict): string {
  const map: Record<ComparisonVerdict, string> = {
    promote_a: "Promouvoir A",
    promote_b: "Promouvoir B",
    keep_testing: "Continuer les tests",
    inconclusive: "Non concluant",
  };
  return map[verdict] ?? verdict;
}

export function confidenceLabel(confidence: Confidence): string {
  const map: Record<Confidence, string> = {
    low: "Faible",
    medium: "Modérée",
    high: "Élevée",
  };
  return map[confidence] ?? confidence;
}

// ---- Phrases de métriques (forces / faiblesses) ----

export function pnlSentence(pnl: number | null, context: string): string | null {
  if (pnl === null) return null;
  return pnl >= 0
    ? `PnL positif sur la période observée (${context})`
    : `PnL négatif sur la période observée (${context})`;
}

export function winRateSentence(winRate: number | null): string | null {
  if (winRate === null) return null;
  const pct = Math.round(winRate * 100);
  if (winRate >= 0.6) return `Win rate solide (${pct}%)`;
  if (winRate >= 0.5) return `Win rate acceptable (${pct}%)`;
  return `Win rate faible (${pct}%)`;
}

export function profitFactorSentence(pf: number | null): string | null {
  if (pf === null) return null;
  if (pf > 1.5) return `Profit Factor solide (${pf.toFixed(2)})`;
  if (pf > 1.0) return `Profit Factor positif mais limité (${pf.toFixed(2)})`;
  return `Profit Factor insuffisant (${pf.toFixed(2)}) — la stratégie perd plus qu'elle ne gagne`;
}

export function drawdownSentence(
  maxDrawdown: number | null,
  context: string
): string | null {
  if (maxDrawdown === null) return null;
  const abs = Math.abs(maxDrawdown);
  const pct = (abs * 100).toFixed(1);
  if (abs <= 0.1) return `Drawdown très bien contenu (${pct}%) — ${context}`;
  if (abs <= 0.2) return `Drawdown acceptable (${pct}%) — ${context}`;
  return `Drawdown élevé (${pct}%) — ${context}`;
}

export function expectancySentence(expectancy: number | null): string | null {
  if (expectancy === null) return null;
  return expectancy > 0
    ? `Espérance mathématique positive (${expectancy.toFixed(2)})`
    : `Espérance mathématique négative (${expectancy.toFixed(2)})`;
}

// ---- Phrases Pro (nouvelles métriques) ----

export function sortinoSentence(sortino: number | null): string | null {
  if (sortino === null) return null;
  if (sortino > 2) return `Sortino ratio excellent (${sortino.toFixed(2)}) — faible volatilité à la baisse`;
  if (sortino > 1) return `Sortino ratio positif (${sortino.toFixed(2)})`;
  return `Sortino ratio faible (${sortino.toFixed(2)}) — volatilité à la baisse importante`;
}

export function recoveryFactorSentence(rf: number | null): string | null {
  if (rf === null) return null;
  if (rf > 3) return `Recovery factor solide (${rf.toFixed(2)}) — bon ratio rendement/risque`;
  if (rf > 1) return `Recovery factor acceptable (${rf.toFixed(2)})`;
  return `Recovery factor faible (${rf.toFixed(2)}) — PnL insuffisant par rapport au drawdown`;
}

export function riskRewardSentence(rr: number | null): string | null {
  if (rr === null) return null;
  if (rr >= 2) return `Risk/Reward excellent (${rr.toFixed(2)}) — gains moyens bien supérieurs aux pertes`;
  if (rr >= 1) return `Risk/Reward correct (${rr.toFixed(2)})`;
  return `Risk/Reward défavorable (${rr.toFixed(2)}) — avg loss > avg win`;
}

export function streakSentence(maxConsecutiveLosses: number | null): string | null {
  if (maxConsecutiveLosses === null) return null;
  if (maxConsecutiveLosses <= 3) return `Série max de pertes contenue (${maxConsecutiveLosses})`;
  if (maxConsecutiveLosses <= 6) return `Série de ${maxConsecutiveLosses} pertes consécutives — risque psychologique modéré`;
  return `Série de ${maxConsecutiveLosses} pertes consécutives — risque psychologique élevé`;
}

export function consistencySentence(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 70) return `Consistance élevée (${score}/100) — performance régulière`;
  if (score >= 50) return `Consistance modérée (${score}/100)`;
  return `Consistance faible (${score}/100) — résultats irréguliers`;
}

export function significanceSentence(ttest: TTestResult | null): string | null {
  if (!ttest) return null;
  if (ttest.significant_1pct) return `Edge statistiquement significatif (p=${ttest.p_value.toFixed(4)}, n=${ttest.n}) — approximation normale`;
  if (ttest.significant_5pct) return `Edge probablement réel (p=${ttest.p_value.toFixed(4)}, n=${ttest.n}) — approximation normale`;
  return `Edge non significatif (p=${ttest.p_value.toFixed(4)}) — potentiellement dû au hasard`;
}

export function monteCarloSentence(mc: MonteCarloResult | null): string | null {
  if (!mc) return null;
  return `Monte Carlo (bootstrap) : ${mc.pct_profitable}% de simulations rentables (IC 95% PnL : ${mc.pnl_ci_lower.toFixed(0)} à ${mc.pnl_ci_upper.toFixed(0)}) — basé sur PnL bruts`;
}

export function degradationSentence(sh: SplitHalfResult | null): string | null {
  if (!sh) return null;
  if (sh.status === "degrading") return `Dégradation détectée : la 2ème moitié des trades est significativement moins performante`;
  if (sh.status === "improving") return `Tendance positive : la 2ème moitié montre une amélioration`;
  return `Performance stable entre la 1ère et la 2ème moitié de la période`;
}

// ---- Phrases de comparaison ----

const METRIC_LABELS: Record<string, string> = {
  pnl: "PnL",
  maxDrawdown: "Drawdown",
  expectancy: "Expectancy",
  winRate: "Win Rate",
  profitFactor: "Profit Factor",
  sharpeRatio: "Sharpe Ratio",
  sortinoRatio: "Sortino Ratio",
  consistencyScore: "Consistance",
  recoveryFactor: "Recovery Factor",
  riskRewardRatio: "Risk/Reward",
};

/**
 * Génère une phrase de force pour le gagnant d'une métrique.
 * Retourne null si winner = "tie" ou "n/a".
 */
export function strengthSentenceForWinner(
  metric: string,
  winner: MetricWinner,
  winnerName: string,
  loserName: string
): string | null {
  if (winner === "n/a" || winner === "tie") return null;
  const label = METRIC_LABELS[metric] ?? metric;
  if (metric === "maxDrawdown") {
    return `Drawdown mieux contenu sur ${winnerName} que sur ${loserName}`;
  }
  return `${label} meilleur sur ${winnerName} (vs ${loserName})`;
}

/**
 * Génère une phrase de faiblesse pour le perdant d'une métrique.
 */
export function weaknessSentenceForLoser(
  metric: string,
  winner: MetricWinner,
  loserName: string,
  winnerName: string
): string | null {
  if (winner === "n/a" || winner === "tie") return null;
  const label = METRIC_LABELS[metric] ?? metric;
  if (metric === "maxDrawdown") {
    return `Drawdown moins bien contenu sur ${loserName} que sur ${winnerName}`;
  }
  return `${label} inférieur sur ${loserName} (vs ${winnerName})`;
}

// ---- Résumés ----

export function buildRunSummary(
  verdict: Verdict,
  run: RunMetrics,
  warnings: Warning[]
): string {
  const tradeStr = `${run.tradeCount} trade${run.tradeCount > 1 ? "s" : ""}`;
  const periodStr =
    run.coveredDays != null && run.coveredDays > 0
      ? ` sur ${run.coveredDays} jour${run.coveredDays > 1 ? "s" : ""}`
      : "";
  const typeStr = ` (${run.runType})`;
  const blockingWarnings = warnings
    .filter((w) => w.severity === "high")
    .map((w) => w.title.toLowerCase());

  switch (verdict) {
    case "invalid":
      return `Run invalide${typeStr} — données insuffisantes pour évaluer.`;
    case "promising":
      return `Run prometteur — ${tradeStr}${periodStr}${typeStr} avec de bons indicateurs de performance.`;
    case "fragile":
      return blockingWarnings.length > 0
        ? `Run fragile — ${tradeStr}${periodStr}. Résultats positifs mais fragilisés : ${blockingWarnings.join(", ")}.`
        : `Run fragile — ${tradeStr}${periodStr}. Signaux mitigés.`;
    case "inconclusive":
      return `Run non concluant — ${tradeStr}${periodStr}. Les indicateurs ne permettent pas de tirer une conclusion claire.`;
  }
}

export function buildVariantSummary(
  verdict: Verdict,
  variant: VariantMetrics,
  _warnings: Warning[]
): string {
  const runsStr =
    variant.runsCount != null
      ? `${variant.runsCount} run${variant.runsCount > 1 ? "s" : ""} agrégé${variant.runsCount > 1 ? "s" : ""}`
      : "données agrégées";
  const tradeStr = `${variant.tradeCount} trade${variant.tradeCount > 1 ? "s" : ""}`;

  switch (verdict) {
    case "invalid":
      return `Variante invalide — ${tradeStr} disponibles. Données insuffisantes pour évaluer.`;
    case "promising":
      return `Variante prometteuse — ${tradeStr} sur ${runsStr} avec des indicateurs solides.`;
    case "fragile":
      return `Variante fragile — ${tradeStr} sur ${runsStr}. Des points positifs existent mais des risques limitent la conclusion.`;
    case "inconclusive":
      return `Variante non concluante — ${tradeStr} sur ${runsStr}. Pas de signal clair à ce stade.`;
  }
}

export function buildComparisonSummary(
  verdict: ComparisonVerdict,
  winner: WinnerSide,
  variantA: VariantMetrics,
  variantB: VariantMetrics,
  score: ScoreResult
): string {
  const nameA = variantA.name;
  const nameB = variantB.name;

  switch (verdict) {
    case "promote_a":
      return `${nameA} domine sur les métriques clés (score ${score.scoreA}/${score.total} vs ${score.scoreB}/${score.total}). Promotion recommandée.`;
    case "promote_b":
      return `${nameB} domine sur les métriques clés (score ${score.scoreB}/${score.total} vs ${score.scoreA}/${score.total}). Promotion recommandée.`;
    case "keep_testing":
      return `Une variante prend l'avantage mais des warnings critiques empêchent de conclure. Continuer les tests.`;
    case "inconclusive":
      return `${nameA} et ${nameB} sont trop proches pour départager (${score.scoreA} vs ${score.scoreB} sur ${score.total} pts). Tests supplémentaires nécessaires.`;
  }
}

// ---- Prochaines étapes ----

export function buildRunNextSteps(verdict: Verdict, warnings: Warning[]): string[] {
  const steps: string[] = [];
  const hasSmall = warnings.some((w) => w.code === "SMALL_SAMPLE");
  const hasSingleTrade = warnings.some((w) => w.code === "SINGLE_TRADE_DOMINANCE");

  switch (verdict) {
    case "invalid":
      steps.push("Vérifier les données importées et le format du CSV");
      steps.push("Relancer l'import avec le bon mapping de colonnes");
      break;
    case "promising":
      steps.push("Intégrer ce run aux métriques agrégées de la variante");
      if (hasSmall) steps.push("Importer plus de trades pour consolider les conclusions");
      break;
    case "fragile":
      if (hasSmall) steps.push("Importer davantage de trades pour valider la tendance");
      if (hasSingleTrade)
        steps.push("Analyser si la performance est reproductible sans le meilleur trade");
      steps.push("Ne pas tirer de conclusions définitives avant plus de données");
      break;
    case "inconclusive":
      steps.push("Considérer un test sur une période plus longue");
      steps.push("Revoir les paramètres de la stratégie sous-jacente");
      break;
  }
  return steps;
}

export function buildVariantNextSteps(verdict: Verdict, warnings: Warning[]): string[] {
  const steps: string[] = [];
  const hasMixed = warnings.some((w) => w.code === "MIXED_RUN_TYPES");
  const hasSmall = warnings.some((w) => w.code === "SMALL_SAMPLE");
  const hasHighWarn = warnings.some((w) => w.severity === "high");

  switch (verdict) {
    case "invalid":
      steps.push("Vérifier les données importées");
      steps.push("Importer au moins un run valide avant d'évaluer la variante");
      break;
    case "promising":
      steps.push("Envisager de promouvoir cette variante comme candidate active");
      if (hasSmall) steps.push("Continuer à accumuler des trades pour renforcer la fiabilité");
      if (hasHighWarn)
        steps.push("Résoudre les warnings critiques avant toute promotion définitive");
      break;
    case "fragile":
      if (hasSmall) steps.push("Importer plus de trades ou de runs supplémentaires");
      steps.push("Créer une itération pour corriger les faiblesses identifiées");
      break;
    case "inconclusive":
      steps.push("Tester sur une période plus longue ou dans plus de conditions de marché");
      steps.push("Revoir les paramètres sous-jacents de la stratégie");
      break;
  }

  if (hasMixed) steps.push("Séparer les données par type de run avant d'agréger");
  return steps;
}

export function buildComparisonNextSteps(
  verdict: ComparisonVerdict,
  winner: WinnerSide,
  warnings: Warning[]
): string[] {
  const steps: string[] = [];
  const hasIncomparable = warnings.some((w) => w.code === "INCOMPARABLE_PERIODS");
  const hasSmall = warnings.some(
    (w) => w.code === "SMALL_SAMPLE" && (w.target === "a" || w.target === "b")
  );

  switch (verdict) {
    case "promote_a":
    case "promote_b": {
      const loser = winner === "a" ? "B" : "A";
      steps.push(`Promouvoir la variante ${winner === "a" ? "A" : "B"} comme candidate active`);
      steps.push(`Archiver ou marquer la variante ${loser} pour référence historique`);
      break;
    }
    case "keep_testing":
      steps.push("Poursuivre les tests avant de prendre une décision");
      if (hasSmall) steps.push("Accumuler plus de trades sur chaque variante");
      break;
    case "inconclusive":
      steps.push("Rassembler plus de données sur les deux variantes");
      steps.push("Tester sur une période commune strictement identique");
      break;
  }

  if (hasIncomparable)
    steps.push("Comparer sur une période strictement identique pour des résultats fiables");
  return steps;
}
