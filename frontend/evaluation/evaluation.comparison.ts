// ============================================================
// evaluation.comparison.ts — Évaluation d'une comparaison A/B
// ============================================================

import type {
  ComparisonInput,
  ComparisonResult,
  ComparisonVerdict,
  Warning,
  WinnerSide,
} from "./evaluation.types";
import {
  collectRunWarnings,
  warnIncomparablePeriods,
  warnTradecountImbalance,
} from "./evaluation.warnings";
import {
  computeConfidence,
  computeComparisonScore,
  hasHighSeverity,
  scoreDominanceRatio,
  welchTTest,
} from "./evaluation.helpers";
import {
  strengthSentenceForWinner,
  weaknessSentenceForLoser,
  buildComparisonSummary,
  buildComparisonNextSteps,
} from "./evaluation.formatters";

/** Seuil en-dessous duquel on déclare le résultat inconclusive (trop proche) */
const INCONCLUSIVE_THRESHOLD = 0.2;

/** Seuil à partir duquel on peut envisager une promotion (dominance suffisante) */
const PROMOTE_THRESHOLD = 0.4;

/**
 * Évalue la comparaison entre deux variantes.
 *
 * Question produit : "La variante B est-elle suffisamment meilleure que A
 *                    pour être promue, ou faut-il continuer à tester ?"
 *
 * Verdicts :
 *   "promote_a"    — A domine clairement, sans warning bloquant
 *   "promote_b"    — B domine clairement, sans warning bloquant
 *   "keep_testing" — un côté prend l'avantage mais des warnings empêchent de conclure
 *   "inconclusive" — scores trop proches ou métriques insuffisantes
 */
export function evaluateVariantComparison(input: ComparisonInput): ComparisonResult {
  const { variantA: a, variantB: b } = input;

  // ---- 1. Warnings par variante ----

  const warningsA = collectRunWarnings(
    {
      tradeCount: a.tradeCount,
      pnl: a.pnl,
      winRate: a.winRate,
      profitFactor: a.profitFactor,
      coveredDays: a.coveredDays,
      totalNegativePnl: a.totalNegativePnl,
      bestTrade: a.bestTrade,
      totalPositivePnl: a.totalPositivePnl,
    },
    "a"
  );

  const warningsB = collectRunWarnings(
    {
      tradeCount: b.tradeCount,
      pnl: b.pnl,
      winRate: b.winRate,
      profitFactor: b.profitFactor,
      coveredDays: b.coveredDays,
      totalNegativePnl: b.totalNegativePnl,
      bestTrade: b.bestTrade,
      totalPositivePnl: b.totalPositivePnl,
    },
    "b"
  );

  // Warnings de comparaison (niveau meta)
  const comparisonWarnings: Warning[] = [];
  const incompWarn = warnIncomparablePeriods(a.coveredDays, b.coveredDays);
  if (incompWarn) comparisonWarnings.push(incompWarn);
  const imbalWarn = warnTradecountImbalance(a.tradeCount, b.tradeCount);
  if (imbalWarn) comparisonWarnings.push(imbalWarn);

  const allWarnings = [...warningsA, ...warningsB, ...comparisonWarnings];

  // ---- 2. Score de comparaison ----

  const score = computeComparisonScore(a, b);

  // ---- 3. Forces et faiblesses par variante (issues du score) ----

  const strengthsA: string[] = [];
  const weaknessesA: string[] = [];
  const strengthsB: string[] = [];
  const weaknessesB: string[] = [];

  for (const detail of score.details) {
    if (detail.winner === "n/a" || detail.winner === "tie") continue;

    const winnerName = detail.winner === "a" ? a.name : b.name;
    const loserName = detail.winner === "a" ? b.name : a.name;

    const strengthSentence = strengthSentenceForWinner(
      detail.metric,
      detail.winner,
      winnerName,
      loserName
    );
    const weaknessSentence = weaknessSentenceForLoser(
      detail.metric,
      detail.winner,
      loserName,
      winnerName
    );

    if (strengthSentence) {
      if (detail.winner === "a") strengthsA.push(strengthSentence);
      else strengthsB.push(strengthSentence);
    }
    if (weaknessSentence) {
      if (detail.winner === "a") weaknessesB.push(weaknessSentence);
      else weaknessesA.push(weaknessSentence);
    }
  }

  // ---- 4. Verdict ----

  const hasAnyHighWarning = hasHighSeverity(allWarnings);
  const dominanceRatio = scoreDominanceRatio(score.scoreA, score.scoreB, score.total);

  let verdict: ComparisonVerdict;
  let winner: WinnerSide = null;
  const reasons: string[] = [];

  if (score.total === 0) {
    // Aucune métrique comparable disponible
    verdict = "inconclusive";
    reasons.push("Aucune métrique comparable n'est disponible pour les deux variantes");
  } else if (dominanceRatio < INCONCLUSIVE_THRESHOLD) {
    // Trop proche
    verdict = "inconclusive";
    reasons.push(
      `Les scores sont trop proches pour départager (${score.scoreA} vs ${score.scoreB} sur ${score.total} pts disponibles)`
    );
  } else {
    // Un côté mène
    winner = score.scoreA > score.scoreB ? "a" : "b";
    const leadingScore = winner === "a" ? score.scoreA : score.scoreB;
    const trailingScore = winner === "a" ? score.scoreB : score.scoreA;
    const leadingName = winner === "a" ? a.name : b.name;

    if (hasAnyHighWarning) {
      // Avantage identifié mais bloqué par un warning critique
      verdict = "keep_testing";
      reasons.push(
        `${leadingName} prend l'avantage (${leadingScore} vs ${trailingScore} pts) mais des warnings critiques empêchent de conclure`
      );
      if (hasHighSeverity(comparisonWarnings)) {
        reasons.push("Les périodes ou volumes de trades ne sont pas comparables");
      }
    } else if (dominanceRatio >= PROMOTE_THRESHOLD) {
      // Dominance claire, pas de warning bloquant
      verdict = winner === "a" ? "promote_a" : "promote_b";
      reasons.push(
        `${leadingName} domine sur ${Math.round(dominanceRatio * 100)}% du score disponible (${leadingScore} vs ${trailingScore})`
      );
    } else {
      // Avantage insuffisant pour promouvoir
      verdict = "keep_testing";
      reasons.push(
        `${leadingName} mène légèrement (${leadingScore} vs ${trailingScore}) mais l'avantage n'est pas suffisant pour promouvoir`
      );
    }
  }

  // ---- 5. Action recommandée ----

  let actionType: ComparisonResult["recommendedAction"]["type"] = "no_action";
  if (verdict === "promote_a" || verdict === "promote_b") actionType = "promote";
  else if (verdict === "keep_testing") actionType = "keep_testing";

  // ---- 6. Test de significativité (Welch t-test sur distributions de PnL) ----
  // Prefer trade-level PnLs when available; fall back to monthly breakdown as proxy
  let significanceTest = null;
  if (a.tradePnls && b.tradePnls && a.tradePnls.length >= 5 && b.tradePnls.length >= 5) {
    significanceTest = welchTTest(a.tradePnls, b.tradePnls);
  } else if (a.monthlyBreakdown && b.monthlyBreakdown && a.monthlyBreakdown.length >= 3 && b.monthlyBreakdown.length >= 3) {
    const pnlsA = a.monthlyBreakdown.map((m) => m.pnl);
    const pnlsB = b.monthlyBreakdown.map((m) => m.pnl);
    significanceTest = welchTTest(pnlsA, pnlsB);
  }

  return {
    verdict,
    confidence: computeConfidence(allWarnings),
    winner,
    summary: buildComparisonSummary(verdict, winner, a, b, score),
    strengthsA,
    weaknessesA,
    strengthsB,
    weaknessesB,
    reasons,
    warnings: allWarnings,
    nextSteps: buildComparisonNextSteps(verdict, winner, allWarnings),
    score,
    recommendedAction: { type: actionType, target: winner },
    significanceTest,
  };
}
