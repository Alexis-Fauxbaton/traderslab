/**
 * evaluation.bundle.js
 * Moteur d'évaluation déterministe — build plat (IIFE) depuis les sources TypeScript.
 * Expose : window.Evaluation = { evaluateRun, evaluateVariant, evaluateVariantComparison,
 *                                 verdictLabel, confidenceLabel, comparisonVerdictLabel }
 *
 * V1 — métriques claires et actionnables pour un trader :
 *   Recovery Factor, Risk/Reward, streaks, consistance, split-half (dégradation),
 *   Sharpe, warnings de qualité des données.
 */
(function (global) {
  'use strict';

  // ============================================================
  // HELPERS
  // ============================================================

  function safeAbs(n) {
    return (n === null || n === undefined) ? null : Math.abs(n);
  }

  function hasHighSeverity(warnings) {
    return warnings.some(function (w) { return w.severity === 'high'; });
  }

  function countBySeverity(warnings, severity) {
    return warnings.filter(function (w) { return w.severity === severity; }).length;
  }

  function computeConfidence(warnings) {
    if (hasHighSeverity(warnings)) return 'low';
    if (countBySeverity(warnings, 'medium') >= 2) return 'medium';
    return 'high';
  }

  function isDrawdownAcceptable(maxDrawdown, threshold) {
    threshold = threshold !== undefined ? threshold : 0.25;
    if (maxDrawdown === null || maxDrawdown === undefined) return false;
    return Math.abs(maxDrawdown) < threshold;
  }

  // ============================================================
  // WELCH T-TEST (used for comparison only)
  // ============================================================

  function erfc(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x));
    var poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    var result = poly * Math.exp(-x * x);
    return x >= 0 ? result : 2 - result;
  }

  function welchTTest(pnlsA, pnlsB) {
    var nA = pnlsA.length;
    var nB = pnlsB.length;
    if (nA < 5 || nB < 5) return null;

    var sumA = 0, sumB = 0;
    for (var i = 0; i < nA; i++) sumA += pnlsA[i];
    for (var j = 0; j < nB; j++) sumB += pnlsB[j];
    var meanA = sumA / nA;
    var meanB = sumB / nB;

    var varA = 0, varB = 0;
    for (var i = 0; i < nA; i++) varA += Math.pow(pnlsA[i] - meanA, 2);
    for (var j = 0; j < nB; j++) varB += Math.pow(pnlsB[j] - meanB, 2);
    varA /= (nA - 1);
    varB /= (nB - 1);

    var seA = varA / nA;
    var seB = varB / nB;
    var se = Math.sqrt(seA + seB);
    if (se === 0) return null;

    var tStat = (meanA - meanB) / se;
    var z = Math.abs(tStat);
    var pValue = 0.5 * erfc(z / Math.SQRT2);

    return {
      t_statistic: Math.round(tStat * 10000) / 10000,
      p_value: Math.round(pValue * 1000000) / 1000000,
      significant_5pct: pValue < 0.05,
      significant_1pct: pValue < 0.01,
      n: nA + nB
    };
  }

  // ============================================================
  // SCORE DE COMPARAISON
  // ============================================================

  function compareMetric(a, b, higherIsBetter, metric, weight) {
    if (a === null || a === undefined || b === null || b === undefined) {
      return { metric: metric, winner: 'n/a', weight: weight, gainA: 0, gainB: 0 };
    }
    if (a === b) {
      return { metric: metric, winner: 'tie', weight: weight, gainA: 0, gainB: 0 };
    }
    var aBetter = higherIsBetter ? a > b : a < b;
    return aBetter
      ? { metric: metric, winner: 'a', weight: weight, gainA: weight, gainB: 0 }
      : { metric: metric, winner: 'b', weight: weight, gainA: 0, gainB: weight };
  }

  function computeComparisonScore(a, b) {
    var details = [
      compareMetric(a.pnl, b.pnl, true, 'pnl', 3),
      compareMetric(safeAbs(a.maxDrawdown), safeAbs(b.maxDrawdown), false, 'maxDrawdown', 2),
      compareMetric(a.expectancy, b.expectancy, true, 'expectancy', 2),
      compareMetric(a.winRate, b.winRate, true, 'winRate', 1),
      compareMetric(a.profitFactor, b.profitFactor, true, 'profitFactor', 1),
      compareMetric(a.sharpeRatio, b.sharpeRatio, true, 'sharpeRatio', 2),
      compareMetric(a.consistencyScore, b.consistencyScore, true, 'consistencyScore', 2),
      compareMetric(a.recoveryFactor, b.recoveryFactor, true, 'recoveryFactor', 1.5),
      compareMetric(a.riskRewardRatio, b.riskRewardRatio, true, 'riskRewardRatio', 1.5),
    ];
    var scoreA = details.reduce(function (acc, d) { return acc + d.gainA; }, 0);
    var scoreB = details.reduce(function (acc, d) { return acc + d.gainB; }, 0);
    var total = details.reduce(function (acc, d) { return acc + (d.winner !== 'n/a' ? d.weight : 0); }, 0);
    return { scoreA: scoreA, scoreB: scoreB, total: total, details: details };
  }

  function scoreDominanceRatio(scoreA, scoreB, total) {
    if (total === 0) return 0;
    return Math.abs(scoreA - scoreB) / total;
  }

  // ============================================================
  // WARNINGS
  // ============================================================

  function warnSmallSample(tradeCount, target, minimum) {
    minimum = minimum !== undefined ? minimum : 30;
    if (tradeCount > 0 && tradeCount < minimum) {
      return {
        code: 'SMALL_SAMPLE', severity: 'high', title: 'Échantillon trop faible',
        message: "Seulement " + tradeCount + " trade" + (tradeCount > 1 ? 's' : '') +
          " — les conclusions sont fragiles (minimum recommandé : " + minimum + ").",
        target: target,
      };
    }
    return null;
  }

  function warnShortPeriod(coveredDays, target, minimum) {
    minimum = minimum !== undefined ? minimum : 7;
    if (coveredDays !== null && coveredDays !== undefined && coveredDays >= 0 && coveredDays < minimum) {
      return {
        code: 'SHORT_PERIOD', severity: 'medium', title: 'Période trop courte',
        message: "Période couverte : " + coveredDays + " jour" + (coveredDays > 1 ? "s" : "") +
          ". Au moins " + minimum + " jours sont recommandés.",
        target: target,
      };
    }
    return null;
  }

  function warnMixedRunTypes(runTypes, target) {
    var unique = runTypes.filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (unique.length > 1) {
      return {
        code: 'MIXED_RUN_TYPES', severity: 'high', title: 'Mélange de types de runs',
        message: "Les données mélangent : " + unique.join(', ') +
          ". Ne pas agréger backtest, forward et live sans distinction.",
        target: target,
      };
    }
    return null;
  }

  function warnSingleTradeDominance(bestTrade, totalPositivePnl, target) {
    if (bestTrade !== null && bestTrade !== undefined && bestTrade > 0 &&
        totalPositivePnl !== null && totalPositivePnl !== undefined && totalPositivePnl > 0) {
      var ratio = bestTrade / totalPositivePnl;
      if (ratio > 0.5) {
        return {
          code: 'SINGLE_TRADE_DOMINANCE', severity: 'high', title: 'Performance concentrée sur un trade',
          message: "Le meilleur trade représente " + Math.round(ratio * 100) +
            "% du total des gains. La performance dépend fortement d'un seul trade.",
          target: target,
        };
      }
    }
    return null;
  }

  function warnUnreliableProfitFactor(tradeCount, totalNegativePnl, target) {
    if (totalNegativePnl !== null && totalNegativePnl !== undefined && totalNegativePnl === 0) {
      return {
        code: 'PF_NO_LOSSES', severity: 'medium', title: 'Profit Factor non significatif',
        message: "Aucune perte enregistrée — le Profit Factor ne peut pas être interprété.",
        target: target,
      };
    }
    if (tradeCount > 0 && tradeCount < 20) {
      return {
        code: 'PF_SMALL_SAMPLE', severity: 'medium', title: 'Profit Factor peu fiable',
        message: "Moins de 20 trades (" + tradeCount + ") — le Profit Factor manque de stabilité.",
        target: target,
      };
    }
    return null;
  }

  function warnUnreliableExpectancy(tradeCount, target) {
    if (tradeCount > 0 && tradeCount < 20) {
      return {
        code: 'EXPECTANCY_SMALL_SAMPLE', severity: 'medium', title: 'Expectancy peu fiable',
        message: "Moins de 20 trades (" + tradeCount + ") — l'espérance mathématique est peu représentative.",
        target: target,
      };
    }
    return null;
  }

  function warnMissingCoreMetrics(pnl, winRate, profitFactor, target) {
    var missingCount = [pnl, winRate, profitFactor].filter(function (v) {
      return v === null || v === undefined;
    }).length;
    if (missingCount >= 2) {
      return {
        code: 'MISSING_CORE_METRICS', severity: 'high', title: 'Données insuffisantes',
        message: "Plusieurs métriques clés sont manquantes — l'évaluation est très limitée.",
        target: target,
      };
    }
    return null;
  }

  function warnIncomparablePeriods(coveredDaysA, coveredDaysB) {
    if (!coveredDaysA || !coveredDaysB || coveredDaysA <= 0 || coveredDaysB <= 0) return null;
    var maxDays = Math.max(coveredDaysA, coveredDaysB);
    var diff = Math.abs(coveredDaysA - coveredDaysB);
    var ratio = diff / maxDays;
    if (ratio > 0.2) {
      return {
        code: 'INCOMPARABLE_PERIODS',
        severity: ratio > 0.5 ? 'high' : 'medium',
        title: 'Périodes non comparables',
        message: "Les deux variantes couvrent des durées très différentes (" +
          coveredDaysA + "j vs " + coveredDaysB + "j).",
        target: 'comparison',
      };
    }
    return null;
  }

  function warnTradecountImbalance(tradeCountA, tradeCountB) {
    if (tradeCountA <= 0 || tradeCountB <= 0) return null;
    var min = Math.min(tradeCountA, tradeCountB);
    var max = Math.max(tradeCountA, tradeCountB);
    if (max === 0) return null;
    var ratio = min / max;
    if (ratio < 0.5) {
      return {
        code: 'TRADECOUNT_IMBALANCE', severity: 'medium', title: 'Déséquilibre du nombre de trades',
        message: "Les deux variantes ont un volume de trades très différent (" +
          tradeCountA + " vs " + tradeCountB + ").",
        target: 'comparison',
      };
    }
    return null;
  }

  function warnLowSharpe(sharpeRatio, target) {
    if (sharpeRatio === null || sharpeRatio === undefined) return null;
    if (sharpeRatio < 0) {
      return {
        code: 'NEGATIVE_SHARPE', severity: 'medium', title: 'Sharpe ratio négatif',
        message: 'Le Sharpe ratio annualisé est négatif (' + sharpeRatio.toFixed(2) + '). La stratégie détruit de la valeur ajustée au risque.',
        target: target,
      };
    }
    if (sharpeRatio < 0.5) {
      return {
        code: 'LOW_SHARPE', severity: 'low', title: 'Sharpe ratio faible',
        message: 'Le Sharpe ratio annualisé est bas (' + sharpeRatio.toFixed(2) + '). Un ratio > 1 est généralement souhaitable.',
        target: target,
      };
    }
    return null;
  }

  function collectRunWarnings(metrics, target) {
    var warnings = [];
    var push = function (w) { if (w) warnings.push(w); };
    push(warnSmallSample(metrics.tradeCount, target));
    push(warnShortPeriod(metrics.coveredDays, target));
    push(warnSingleTradeDominance(metrics.bestTrade, metrics.totalPositivePnl, target));
    push(warnUnreliableProfitFactor(metrics.tradeCount, metrics.totalNegativePnl, target));
    push(warnUnreliableExpectancy(metrics.tradeCount, target));
    push(warnMissingCoreMetrics(metrics.pnl, metrics.winRate, metrics.profitFactor, target));
    push(warnLowSharpe(metrics.sharpeRatio, target));
    return warnings;
  }

  // ============================================================
  // FORMATTERS — phrases lisibles pour un trader
  // ============================================================

  function verdictLabel(verdict) {
    return { promising: 'Prometteur', fragile: 'Fragile', inconclusive: 'Non concluant', invalid: 'Invalide' }[verdict] || verdict;
  }

  function comparisonVerdictLabel(verdict) {
    return { promote_a: 'Promouvoir A', promote_b: 'Promouvoir B', keep_testing: 'Continuer les tests', inconclusive: 'Non concluant' }[verdict] || verdict;
  }

  function confidenceLabel(confidence) {
    return { low: 'Faible', medium: 'Modérée', high: 'Élevée' }[confidence] || confidence;
  }

  function pnlSentence(pnl, context) {
    if (pnl === null || pnl === undefined) return null;
    return pnl >= 0
      ? 'PnL positif sur la période observée (' + context + ')'
      : 'PnL négatif sur la période observée (' + context + ')';
  }

  function winRateSentence(winRate) {
    if (winRate === null || winRate === undefined) return null;
    var pct = Math.round(winRate * 100);
    if (winRate >= 0.6) return 'Win rate solide (' + pct + '%)';
    if (winRate >= 0.5) return 'Win rate acceptable (' + pct + '%)';
    return 'Win rate faible (' + pct + '%)';
  }

  function profitFactorSentence(pf) {
    if (pf === null || pf === undefined) return null;
    if (pf > 1.5) return 'Profit Factor solide (' + pf.toFixed(2) + ')';
    if (pf > 1.0) return 'Profit Factor positif mais limité (' + pf.toFixed(2) + ')';
    return "Profit Factor insuffisant (" + pf.toFixed(2) + ") — la stratégie perd plus qu'elle ne gagne";
  }

  function drawdownSentence(maxDrawdown, context) {
    if (maxDrawdown === null || maxDrawdown === undefined) return null;
    var abs = Math.abs(maxDrawdown);
    var pct = (abs * 100).toFixed(1);
    if (abs <= 0.1) return 'Drawdown très bien contenu (' + pct + '%) — ' + context;
    if (abs <= 0.2) return 'Drawdown acceptable (' + pct + '%) — ' + context;
    return 'Drawdown élevé (' + pct + '%) — ' + context;
  }

  function expectancySentence(expectancy) {
    if (expectancy === null || expectancy === undefined) return null;
    return expectancy > 0
      ? 'Espérance mathématique positive (' + expectancy.toFixed(2) + ')'
      : 'Espérance mathématique négative (' + expectancy.toFixed(2) + ')';
  }

  function recoveryFactorSentence(rf) {
    if (rf === null || rf === undefined) return null;
    if (rf > 3) return 'Recovery factor solide (' + rf.toFixed(2) + ') — bon ratio rendement/risque';
    if (rf > 1) return 'Recovery factor acceptable (' + rf.toFixed(2) + ')';
    return 'Recovery factor faible (' + rf.toFixed(2) + ') — PnL insuffisant par rapport au drawdown';
  }

  function riskRewardSentence(rr) {
    if (rr === null || rr === undefined) return null;
    if (rr >= 2) return 'Risk/Reward excellent (' + rr.toFixed(2) + ') — gains moyens bien supérieurs aux pertes';
    if (rr >= 1) return 'Risk/Reward correct (' + rr.toFixed(2) + ')';
    return 'Risk/Reward défavorable (' + rr.toFixed(2) + ') — avg loss > avg win';
  }

  function streakSentence(maxConsecutiveLosses) {
    if (maxConsecutiveLosses === null || maxConsecutiveLosses === undefined) return null;
    if (maxConsecutiveLosses <= 3) return 'Série max de pertes contenue (' + maxConsecutiveLosses + ')';
    if (maxConsecutiveLosses <= 6) return 'Série de ' + maxConsecutiveLosses + ' pertes consécutives — risque psychologique modéré';
    return 'Série de ' + maxConsecutiveLosses + ' pertes consécutives — risque psychologique élevé';
  }

  function consistencySentence(score) {
    if (score === null || score === undefined) return null;
    if (score >= 70) return 'Consistance élevée (' + score + '/100) — performance régulière';
    if (score >= 50) return 'Consistance modérée (' + score + '/100)';
    return 'Consistance faible (' + score + '/100) — résultats irréguliers';
  }

  function degradationSentence(sh) {
    if (!sh) return null;
    if (sh.status === 'degrading') return 'Dégradation détectée : la 2ème moitié des trades est significativement moins performante';
    if (sh.status === 'improving') return 'Tendance positive : la 2ème moitié montre une amélioration';
    return 'Performance stable entre la 1ère et la 2ème moitié de la période';
  }

  var METRIC_LABELS = {
    pnl: 'PnL', maxDrawdown: 'Drawdown', expectancy: 'Expectancy',
    winRate: 'Win Rate', profitFactor: 'Profit Factor', sharpeRatio: 'Sharpe Ratio',
    consistencyScore: 'Consistance', recoveryFactor: 'Recovery Factor',
    riskRewardRatio: 'Risk/Reward'
  };

  function strengthSentenceForWinner(metric, winner, winnerName, loserName) {
    if (winner === 'n/a' || winner === 'tie') return null;
    if (metric === 'maxDrawdown') return 'Drawdown mieux contenu sur ' + winnerName + ' que sur ' + loserName;
    return (METRIC_LABELS[metric] || metric) + ' meilleur sur ' + winnerName + ' (vs ' + loserName + ')';
  }

  function weaknessSentenceForLoser(metric, winner, loserName, winnerName) {
    if (winner === 'n/a' || winner === 'tie') return null;
    if (metric === 'maxDrawdown') return 'Drawdown moins bien contenu sur ' + loserName + ' que sur ' + winnerName;
    return (METRIC_LABELS[metric] || metric) + ' inférieur sur ' + loserName + ' (vs ' + winnerName + ')';
  }

  // ---- Résumés ----

  function buildRunSummary(verdict, run, warnings) {
    var tradeStr = run.tradeCount + ' trade' + (run.tradeCount > 1 ? 's' : '');
    var periodStr = run.coveredDays != null && run.coveredDays > 0
      ? ' sur ' + run.coveredDays + ' jour' + (run.coveredDays > 1 ? 's' : '') : '';
    var typeStr = ' (' + run.runType + ')';
    var blockingWarnings = warnings.filter(function (w) { return w.severity === 'high'; })
      .map(function (w) { return w.title.toLowerCase(); });
    switch (verdict) {
      case 'invalid': return 'Run invalide' + typeStr + ' — données insuffisantes pour évaluer.';
      case 'promising': return 'Run prometteur — ' + tradeStr + periodStr + typeStr + ' avec de bons indicateurs de performance.';
      case 'fragile': return blockingWarnings.length > 0
        ? 'Run fragile — ' + tradeStr + periodStr + '. Résultats positifs mais fragilisés : ' + blockingWarnings.join(', ') + '.'
        : 'Run fragile — ' + tradeStr + periodStr + '. Signaux mitigés.';
      case 'inconclusive': return 'Run non concluant — ' + tradeStr + periodStr + '. Les indicateurs ne permettent pas de tirer une conclusion claire.';
    }
    return '';
  }

  function buildVariantSummary(verdict, variant) {
    var runsStr = variant.runsCount != null
      ? variant.runsCount + ' run' + (variant.runsCount > 1 ? 's' : '') + ' agrégé' + (variant.runsCount > 1 ? 's' : '')
      : 'données agrégées';
    var tradeStr = variant.tradeCount + ' trade' + (variant.tradeCount > 1 ? 's' : '');
    switch (verdict) {
      case 'invalid': return 'Variante invalide — ' + tradeStr + ' disponibles. Données insuffisantes pour évaluer.';
      case 'promising': return 'Variante prometteuse — ' + tradeStr + ' sur ' + runsStr + ' avec des indicateurs solides.';
      case 'fragile': return 'Variante fragile — ' + tradeStr + ' sur ' + runsStr + '. Des points positifs existent mais des risques limitent la conclusion.';
      case 'inconclusive': return 'Variante non concluante — ' + tradeStr + ' sur ' + runsStr + '. Pas de signal clair à ce stade.';
    }
    return '';
  }

  function buildComparisonSummary(verdict, winner, variantA, variantB, score) {
    var nameA = variantA.name, nameB = variantB.name;
    switch (verdict) {
      case 'promote_a': return nameA + ' domine sur les métriques clés (score ' + score.scoreA + '/' + score.total + ' vs ' + score.scoreB + '/' + score.total + '). Promotion recommandée.';
      case 'promote_b': return nameB + ' domine sur les métriques clés (score ' + score.scoreB + '/' + score.total + ' vs ' + score.scoreA + '/' + score.total + '). Promotion recommandée.';
      case 'keep_testing': return "Une variante prend l'avantage mais des warnings critiques empêchent de conclure. Continuer les tests.";
      case 'inconclusive': return nameA + ' et ' + nameB + ' sont trop proches pour départager (' + score.scoreA + ' vs ' + score.scoreB + ' sur ' + score.total + ' pts). Tests supplémentaires nécessaires.';
    }
    return '';
  }

  // ---- Prochaines étapes ----

  function buildRunNextSteps(verdict, warnings) {
    var steps = [];
    var hasSmall = warnings.some(function (w) { return w.code === 'SMALL_SAMPLE'; });
    var hasSingleTrade = warnings.some(function (w) { return w.code === 'SINGLE_TRADE_DOMINANCE'; });
    switch (verdict) {
      case 'invalid':
        steps.push('Vérifier les données importées et le format du CSV');
        steps.push("Relancer l'import avec le bon mapping de colonnes");
        break;
      case 'promising':
        steps.push('Intégrer ce run aux métriques agrégées de la variante');
        if (hasSmall) steps.push('Importer plus de trades pour consolider les conclusions');
        break;
      case 'fragile':
        if (hasSmall) steps.push('Importer davantage de trades pour valider la tendance');
        if (hasSingleTrade) steps.push('Analyser si la performance est reproductible sans le meilleur trade');
        steps.push('Ne pas tirer de conclusions définitives avant plus de données');
        break;
      case 'inconclusive':
        steps.push('Considérer un test sur une période plus longue');
        steps.push('Revoir les paramètres de la stratégie sous-jacente');
        break;
    }
    return steps;
  }

  function buildVariantNextSteps(verdict, warnings) {
    var steps = [];
    var hasMixed = warnings.some(function (w) { return w.code === 'MIXED_RUN_TYPES'; });
    var hasSmall = warnings.some(function (w) { return w.code === 'SMALL_SAMPLE'; });
    var hasHighWarn = warnings.some(function (w) { return w.severity === 'high'; });
    switch (verdict) {
      case 'invalid':
        steps.push('Vérifier les données importées');
        steps.push("Importer au moins un run valide avant d'évaluer la variante");
        break;
      case 'promising':
        steps.push('Envisager de promouvoir cette variante comme candidate active');
        if (hasSmall) steps.push('Continuer à accumuler des trades pour renforcer la fiabilité');
        if (hasHighWarn) steps.push('Résoudre les warnings critiques avant toute promotion définitive');
        break;
      case 'fragile':
        if (hasSmall) steps.push('Importer plus de trades ou de runs supplémentaires');
        steps.push('Créer une itération pour corriger les faiblesses identifiées');
        break;
      case 'inconclusive':
        steps.push('Tester sur une période plus longue ou dans plus de conditions de marché');
        steps.push('Revoir les paramètres sous-jacents de la stratégie');
        break;
    }
    if (hasMixed) steps.push("Séparer les données par type de run avant d'agréger");
    return steps;
  }

  function buildComparisonNextSteps(verdict, winner, warnings) {
    var steps = [];
    var hasIncomparable = warnings.some(function (w) { return w.code === 'INCOMPARABLE_PERIODS'; });
    var hasSmall = warnings.some(function (w) {
      return w.code === 'SMALL_SAMPLE' && (w.target === 'a' || w.target === 'b');
    });
    switch (verdict) {
      case 'promote_a':
      case 'promote_b':
        steps.push('Promouvoir la variante ' + (winner === 'a' ? 'A' : 'B') + ' comme candidate active');
        steps.push('Archiver ou marquer la variante ' + (winner === 'a' ? 'B' : 'A') + ' pour référence historique');
        break;
      case 'keep_testing':
        steps.push('Poursuivre les tests avant de prendre une décision');
        if (hasSmall) steps.push('Accumuler plus de trades sur chaque variante');
        break;
      case 'inconclusive':
        steps.push('Rassembler plus de données sur les deux variantes');
        steps.push('Tester sur une période commune strictement identique');
        break;
    }
    if (hasIncomparable) steps.push('Comparer sur une période strictement identique pour des résultats fiables');
    return steps;
  }

  // ============================================================
  // ÉVALUATEURS
  // ============================================================

  function evaluateRun(run) {
    var warnings = collectRunWarnings({
      tradeCount: run.tradeCount, pnl: run.pnl, winRate: run.winRate,
      profitFactor: run.profitFactor, coveredDays: run.coveredDays,
      totalNegativePnl: run.totalNegativePnl, bestTrade: run.bestTrade,
      totalPositivePnl: run.totalPositivePnl, sharpeRatio: run.sharpeRatio,
    }, 'run');

    if (run.tradeCount === 0) {
      return { verdict: 'invalid', confidence: 'low', summary: "Ce run ne contient aucun trade — évaluation impossible.", strengths: [], weaknesses: ['Aucun trade enregistré'], reasons: ['Le run est vide'], warnings: warnings, nextSteps: ['Vérifier les données importées et le format du CSV'], recommendedAction: { type: 'review_data', target: null }, degradation: null };
    }
    if (run.pnl === null && run.winRate === null && run.profitFactor === null) {
      return { verdict: 'invalid', confidence: 'low', summary: "Métriques clés introuvables — évaluation impossible.", strengths: [], weaknesses: ['PnL, win rate et profit factor sont tous absents'], reasons: ['Aucune métrique calculable'], warnings: warnings, nextSteps: ['Vérifier le format des données importées et le mapping de colonnes'], recommendedAction: { type: 'review_data', target: null }, degradation: null };
    }

    var strengths = [], weaknesses = [];

    var s1 = pnlSentence(run.pnl, run.runType);
    if (s1) ((run.pnl >= 0) ? strengths : weaknesses).push(s1);

    var s2 = winRateSentence(run.winRate);
    if (s2) ((run.winRate >= 0.5) ? strengths : weaknesses).push(s2);

    var s3 = profitFactorSentence(run.profitFactor);
    if (s3) ((run.profitFactor > 1) ? strengths : weaknesses).push(s3);

    var s4 = drawdownSentence(run.maxDrawdown, run.runType);
    if (s4) (isDrawdownAcceptable(run.maxDrawdown) ? strengths : weaknesses).push(s4);

    var s5 = expectancySentence(run.expectancy);
    if (s5) ((run.expectancy > 0) ? strengths : weaknesses).push(s5);

    // Pro metrics
    var rf = recoveryFactorSentence(run.recoveryFactor);
    if (rf) ((run.recoveryFactor || 0) > 1 ? strengths : weaknesses).push(rf);

    var rr = riskRewardSentence(run.riskRewardRatio);
    if (rr) ((run.riskRewardRatio || 0) >= 1 ? strengths : weaknesses).push(rr);

    var streak = streakSentence(run.maxConsecutiveLosses);
    if (streak) ((run.maxConsecutiveLosses || 0) <= 5 ? strengths : weaknesses).push(streak);

    var cons = consistencySentence(run.consistencyScore);
    if (cons) ((run.consistencyScore || 0) >= 50 ? strengths : weaknesses).push(cons);

    var deg = degradationSentence(run.splitHalf);
    if (deg) (run.splitHalf && run.splitHalf.status !== 'degrading' ? strengths : weaknesses).push(deg);

    // Verdict
    var posPnl = run.pnl !== null && run.pnl > 0;
    var goodPF = run.profitFactor !== null && run.profitFactor > 1.3;
    var containedDD = isDrawdownAcceptable(run.maxDrawdown);
    var positiveScore = [posPnl, goodPF, containedDD].filter(Boolean).length;
    var highWarning = hasHighSeverity(warnings);

    var verdict, actionType, reasons = [];

    if (run.tradeCount < 10) {
      verdict = 'invalid'; actionType = 'review_data';
      reasons.push('Moins de 10 trades (' + run.tradeCount + ') — jeu de données trop petit pour établir un verdict');
    } else if (!posPnl && !goodPF) {
      verdict = 'inconclusive'; actionType = 'discard_run';
      reasons.push('Ni le PnL ni le Profit Factor ne montrent de signal positif');
    } else if (positiveScore >= 2 && !highWarning) {
      verdict = 'promising'; actionType = 'use_in_variant';
      reasons.push('Bons indicateurs de performance sans warning bloquant');
    } else if (highWarning) {
      verdict = 'fragile'; actionType = 'keep_testing';
      reasons.push('Signaux positifs affaiblis par un ou plusieurs warnings critiques');
    } else {
      verdict = 'fragile'; actionType = 'keep_testing';
      reasons.push('Signaux mitigés — poursuite des tests recommandée');
    }

    return {
      verdict: verdict, confidence: computeConfidence(warnings),
      summary: buildRunSummary(verdict, run, warnings),
      strengths: strengths, weaknesses: weaknesses, reasons: reasons,
      warnings: warnings, nextSteps: buildRunNextSteps(verdict, warnings),
      recommendedAction: { type: actionType, target: run.id },
      degradation: run.splitHalf || null,
    };
  }

  function evaluateVariant(variant) {
    var warnings = collectRunWarnings({
      tradeCount: variant.tradeCount, pnl: variant.pnl, winRate: variant.winRate,
      profitFactor: variant.profitFactor, coveredDays: variant.coveredDays,
      totalNegativePnl: variant.totalNegativePnl, bestTrade: variant.bestTrade,
      totalPositivePnl: variant.totalPositivePnl, sharpeRatio: variant.sharpeRatio,
    }, 'variant');

    var mixedWarn = warnMixedRunTypes(variant.runTypes || [], 'variant');
    if (mixedWarn) warnings.push(mixedWarn);

    if (variant.tradeCount === 0 || (variant.runsCount !== null && variant.runsCount === 0)) {
      return { verdict: 'invalid', confidence: 'low', summary: "Variante sans données — aucun trade disponible.", strengths: [], weaknesses: ['Aucun trade enregistré sur cette variante'], reasons: ["La variante n'a pas encore de runs importés"], warnings: warnings, nextSteps: ['Importer un premier run CSV pour cette variante'], recommendedAction: { type: 'review_data', target: null }, degradation: null };
    }
    if (variant.pnl === null && variant.winRate === null && variant.profitFactor === null) {
      return { verdict: 'invalid', confidence: 'low', summary: "Métriques agrégées manquantes — évaluation impossible.", strengths: [], weaknesses: ['Métriques clés introuvables sur les runs agrégés'], reasons: ['Les métriques ne peuvent pas être calculées'], warnings: warnings, nextSteps: ['Vérifier les données importées sur chaque run de cette variante'], recommendedAction: { type: 'review_data', target: null }, degradation: null };
    }

    var strengths = [], weaknesses = [];

    var s1 = pnlSentence(variant.pnl, 'agrégé');
    if (s1) ((variant.pnl >= 0) ? strengths : weaknesses).push(s1);

    var s2 = winRateSentence(variant.winRate);
    if (s2) ((variant.winRate >= 0.5) ? strengths : weaknesses).push(s2);

    var s3 = profitFactorSentence(variant.profitFactor);
    if (s3) ((variant.profitFactor > 1) ? strengths : weaknesses).push(s3);

    var s4 = drawdownSentence(variant.maxDrawdown, 'agrégé');
    if (s4) (isDrawdownAcceptable(variant.maxDrawdown) ? strengths : weaknesses).push(s4);

    var s5 = expectancySentence(variant.expectancy);
    if (s5) ((variant.expectancy > 0) ? strengths : weaknesses).push(s5);

    if (variant.runsCount !== null && variant.runsCount >= 3) {
      strengths.push('Résultats consolidés sur ' + variant.runsCount + ' runs distincts');
    }

    // Pro metrics
    var rf = recoveryFactorSentence(variant.recoveryFactor);
    if (rf) ((variant.recoveryFactor || 0) > 1 ? strengths : weaknesses).push(rf);

    var rr = riskRewardSentence(variant.riskRewardRatio);
    if (rr) ((variant.riskRewardRatio || 0) >= 1 ? strengths : weaknesses).push(rr);

    var streak = streakSentence(variant.maxConsecutiveLosses);
    if (streak) ((variant.maxConsecutiveLosses || 0) <= 5 ? strengths : weaknesses).push(streak);

    var cons = consistencySentence(variant.consistencyScore);
    if (cons) ((variant.consistencyScore || 0) >= 50 ? strengths : weaknesses).push(cons);

    var deg = degradationSentence(variant.splitHalf);
    if (deg) (variant.splitHalf && variant.splitHalf.status !== 'degrading' ? strengths : weaknesses).push(deg);

    // Verdict
    var posPnl = variant.pnl !== null && variant.pnl > 0;
    var goodPF = variant.profitFactor !== null && variant.profitFactor > 1.3;
    var containedDD = isDrawdownAcceptable(variant.maxDrawdown);
    var hasMixed = warnings.some(function (w) { return w.code === 'MIXED_RUN_TYPES'; });
    var highWarning = hasHighSeverity(warnings);
    var positiveScore = [posPnl, goodPF, containedDD].filter(Boolean).length;

    var verdict, actionType, reasons = [];

    if (variant.tradeCount < 10) {
      verdict = 'invalid'; actionType = 'review_data';
      reasons.push('Moins de 10 trades (' + variant.tradeCount + ') — trop peu pour établir un verdict');
    } else if (!posPnl && !goodPF) {
      verdict = 'inconclusive'; actionType = 'archive_variant';
      reasons.push('Aucun indicateur positif significatif sur les métriques agrégées');
    } else if (hasMixed) {
      verdict = 'fragile'; actionType = 'split_by_run_type';
      reasons.push('Les données mélangent des types de runs différents — conclusions peu fiables');
    } else if (positiveScore >= 2 && !highWarning) {
      verdict = 'promising'; actionType = 'promote_to_active_candidate';
      reasons.push("Indicateurs solides et cohérents sur l'ensemble des runs agrégés");
    } else if (highWarning) {
      verdict = 'fragile'; actionType = 'keep_testing';
      reasons.push('Performance positive mais fragilisée par un ou plusieurs warnings critiques');
    } else {
      verdict = 'fragile'; actionType = 'create_iteration';
      reasons.push('Résultats mitigés — une itération pourrait améliorer les performances');
    }

    return {
      verdict: verdict, confidence: computeConfidence(warnings),
      summary: buildVariantSummary(verdict, variant),
      strengths: strengths, weaknesses: weaknesses, reasons: reasons,
      warnings: warnings, nextSteps: buildVariantNextSteps(verdict, warnings),
      recommendedAction: { type: actionType, target: variant.id },
      degradation: variant.splitHalf || null,
    };
  }

  // ============================================================
  // COMPARAISON
  // ============================================================

  var INCONCLUSIVE_THRESHOLD = 0.2;
  var PROMOTE_THRESHOLD = 0.4;

  function evaluateVariantComparison(input) {
    var a = input.variantA, b = input.variantB;

    var warningsA = collectRunWarnings({
      tradeCount: a.tradeCount, pnl: a.pnl, winRate: a.winRate, profitFactor: a.profitFactor,
      coveredDays: a.coveredDays, totalNegativePnl: a.totalNegativePnl,
      bestTrade: a.bestTrade, totalPositivePnl: a.totalPositivePnl, sharpeRatio: a.sharpeRatio,
    }, 'a');

    var warningsB = collectRunWarnings({
      tradeCount: b.tradeCount, pnl: b.pnl, winRate: b.winRate, profitFactor: b.profitFactor,
      coveredDays: b.coveredDays, totalNegativePnl: b.totalNegativePnl,
      bestTrade: b.bestTrade, totalPositivePnl: b.totalPositivePnl, sharpeRatio: b.sharpeRatio,
    }, 'b');

    var comparisonWarnings = [];
    var incompWarn = warnIncomparablePeriods(a.coveredDays, b.coveredDays);
    if (incompWarn) comparisonWarnings.push(incompWarn);
    var imbalWarn = warnTradecountImbalance(a.tradeCount, b.tradeCount);
    if (imbalWarn) comparisonWarnings.push(imbalWarn);

    var allWarnings = warningsA.concat(warningsB).concat(comparisonWarnings);
    var score = computeComparisonScore(a, b);

    var strengthsA = [], weaknessesA = [], strengthsB = [], weaknessesB = [];
    for (var i = 0; i < score.details.length; i++) {
      var detail = score.details[i];
      if (detail.winner === 'n/a' || detail.winner === 'tie') continue;
      var winnerName = detail.winner === 'a' ? a.name : b.name;
      var loserName = detail.winner === 'a' ? b.name : a.name;
      var ss = strengthSentenceForWinner(detail.metric, detail.winner, winnerName, loserName);
      var ws = weaknessSentenceForLoser(detail.metric, detail.winner, loserName, winnerName);
      if (ss) { if (detail.winner === 'a') strengthsA.push(ss); else strengthsB.push(ss); }
      if (ws) { if (detail.winner === 'a') weaknessesB.push(ws); else weaknessesA.push(ws); }
    }

    var hasAnyHighWarning = hasHighSeverity(allWarnings);
    var dominanceRatio = scoreDominanceRatio(score.scoreA, score.scoreB, score.total);

    var verdict, winner = null, reasons = [];

    if (score.total === 0) {
      verdict = 'inconclusive';
      reasons.push("Aucune métrique comparable n'est disponible pour les deux variantes");
    } else if (dominanceRatio < INCONCLUSIVE_THRESHOLD) {
      verdict = 'inconclusive';
      reasons.push('Les scores sont trop proches pour départager (' + score.scoreA + ' vs ' + score.scoreB + ' sur ' + score.total + ' pts disponibles)');
    } else {
      winner = score.scoreA > score.scoreB ? 'a' : 'b';
      var leadingScore = winner === 'a' ? score.scoreA : score.scoreB;
      var trailingScore = winner === 'a' ? score.scoreB : score.scoreA;
      var leadingName = winner === 'a' ? a.name : b.name;

      if (hasAnyHighWarning) {
        verdict = 'keep_testing';
        reasons.push(leadingName + " prend l'avantage (" + leadingScore + ' vs ' + trailingScore + ' pts) mais des warnings critiques empêchent de conclure');
        if (hasHighSeverity(comparisonWarnings)) {
          reasons.push('Les périodes ou volumes de trades ne sont pas comparables');
        }
      } else if (dominanceRatio >= PROMOTE_THRESHOLD) {
        verdict = winner === 'a' ? 'promote_a' : 'promote_b';
        reasons.push(leadingName + ' domine sur ' + Math.round(dominanceRatio * 100) + '% du score disponible (' + leadingScore + ' vs ' + trailingScore + ')');
      } else {
        verdict = 'keep_testing';
        reasons.push(leadingName + " mène légèrement (" + leadingScore + " vs " + trailingScore + ") mais l'avantage n'est pas suffisant pour promouvoir");
      }
    }

    var actionType = 'no_action';
    if (verdict === 'promote_a' || verdict === 'promote_b') actionType = 'promote';
    else if (verdict === 'keep_testing') actionType = 'keep_testing';

    // Welch t-test interne — utilisé pour renforcer le verdict, pas affiché en V1
    var significanceTest = null;
    if (a.tradePnls && b.tradePnls && a.tradePnls.length >= 5 && b.tradePnls.length >= 5) {
      significanceTest = welchTTest(a.tradePnls, b.tradePnls);
    } else if (a.monthlyBreakdown && b.monthlyBreakdown && a.monthlyBreakdown.length >= 3 && b.monthlyBreakdown.length >= 3) {
      var pnlsA = a.monthlyBreakdown.map(function (m) { return m.pnl; });
      var pnlsB = b.monthlyBreakdown.map(function (m) { return m.pnl; });
      significanceTest = welchTTest(pnlsA, pnlsB);
    }

    return {
      verdict: verdict, confidence: computeConfidence(allWarnings), winner: winner,
      summary: buildComparisonSummary(verdict, winner, a, b, score),
      strengthsA: strengthsA, weaknessesA: weaknessesA,
      strengthsB: strengthsB, weaknessesB: weaknessesB,
      reasons: reasons, warnings: allWarnings,
      nextSteps: buildComparisonNextSteps(verdict, winner, allWarnings),
      score: score,
      recommendedAction: { type: actionType, target: winner },
      significanceTest: significanceTest,
    };
  }

  // ============================================================
  // EXPOSITION
  // ============================================================

  global.Evaluation = {
    evaluateRun: evaluateRun,
    evaluateVariant: evaluateVariant,
    evaluateVariantComparison: evaluateVariantComparison,
    verdictLabel: verdictLabel,
    confidenceLabel: confidenceLabel,
    comparisonVerdictLabel: comparisonVerdictLabel,
  };

}(typeof window !== 'undefined' ? window : this));
