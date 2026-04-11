"""Moteur d'analyse V1 — verdict, synthèse, action, warnings, régularité, compare.

Philosophie produit :
  TradersLab V1 ne cherche pas à prouver mathématiquement qu'une stratégie est vraie.
  Il aide le trader à mieux juger ses tests, éviter les mauvaises conclusions,
  et décider plus vite quelle variante pousser.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ══════════════════════════════════════════════════════════════
# Types
# ══════════════════════════════════════════════════════════════

class Verdict(str, Enum):
    solide = "solide"
    prometteuse = "prometteuse"
    a_confirmer = "a_confirmer"
    fragile = "fragile"


class ConfidenceLevel(str, Enum):
    faible = "faible"
    moyen = "moyen"
    bon = "bon"
    eleve = "eleve"


class Regularity(str, Enum):
    reguliere = "reguliere"
    assez_reguliere = "assez_reguliere"
    irreguliere = "irreguliere"
    tres_irreguliere = "tres_irreguliere"


class ActionType(str, Enum):
    continuer_test = "continuer_test"
    comparer_variante_mere = "comparer_variante_mere"
    reduire_risque = "reduire_risque"
    forward_test = "forward_test"
    promouvoir_active = "promouvoir_active"
    mettre_en_pause = "mettre_en_pause"
    archiver = "archiver"


class WarningFamily(str, Enum):
    fiabilite = "fiabilite"
    risque = "risque"
    qualite = "qualite"


class CompareBadge(str, Enum):
    plus_rentable = "plus_rentable"
    plus_stable = "plus_stable"
    meilleur_compromis = "meilleur_compromis"


class CompareDecision(str, Enum):
    garder_a = "garder_a"
    garder_b = "garder_b"
    continuer_test = "continuer_test"
    pas_assez_de_recul = "pas_assez_de_recul"


# ══════════════════════════════════════════════════════════════
# Data structures
# ══════════════════════════════════════════════════════════════

@dataclass
class Warning:
    code: str
    family: WarningFamily
    title: str
    message: str


@dataclass
class RecommendedAction:
    primary: ActionType
    primary_label: str
    secondary: str | None = None


@dataclass
class RegularityResult:
    level: Regularity
    label: str
    phrase: str


@dataclass
class VariantAnalysis:
    """Résultat complet de l'analyse d'une variante."""
    verdict: Verdict
    verdict_label: str
    synthesis: str
    action: RecommendedAction
    confidence: ConfidenceLevel
    confidence_label: str
    regularity: RegularityResult | None
    warnings: list[Warning]
    context: dict[str, Any]
    kpis_primary: dict[str, Any]
    kpis_secondary: dict[str, Any]
    # Score interne (non exposé directement)
    _internal_score: int = field(default=0, repr=False)


@dataclass
class CompareBadgeResult:
    badge: CompareBadge
    label: str
    winner: str  # "a" or "b"
    winner_name: str


@dataclass
class CompareAnalysis:
    """Résultat de la comparaison de deux variantes."""
    verdict: str
    decision: CompareDecision
    decision_label: str
    badges: list[CompareBadgeResult]
    kpi_table: list[dict[str, Any]]
    warnings: list[Warning]


# ══════════════════════════════════════════════════════════════
# Constantes & seuils
# ══════════════════════════════════════════════════════════════

_MIN_TRADES_FRAGILE = 15
_MIN_TRADES_CONFIRM = 50
_MIN_TRADES_SOLID = 100


# ══════════════════════════════════════════════════════════════
# Warnings
# ══════════════════════════════════════════════════════════════

def _collect_warnings(m: dict[str, Any], context: dict[str, Any]) -> list[Warning]:
    """Collecte les warnings pertinents, groupés par famille. Max 4 retournés."""
    warnings: list[Warning] = []

    total_trades = m.get("total_trades", 0)
    pnl = m.get("total_pnl", 0)
    max_dd = m.get("max_drawdown", 0)
    max_dd_pct = m.get("max_drawdown_pct_true") or m.get("max_drawdown_pct")
    pf = m.get("profit_factor")
    expectancy = m.get("expectancy", 0)
    win_rate = m.get("win_rate", 0)
    sharpe = m.get("sharpe_ratio")
    best_trade = m.get("best_trade", 0)
    split_half = m.get("split_half")
    consistency = m.get("consistency_score")
    monthly = m.get("monthly_breakdown", [])

    # ---- Fiabilité des données ----

    if total_trades < _MIN_TRADES_CONFIRM:
        warnings.append(Warning(
            code="SMALL_SAMPLE",
            family=WarningFamily.fiabilite,
            title="Échantillon faible",
            message=f"Seulement {total_trades} trades — minimum recommandé : {_MIN_TRADES_CONFIRM}.",
        ))

    covered_months = len(monthly)
    if covered_months < 2:
        warnings.append(Warning(
            code="SHORT_PERIOD",
            family=WarningFamily.fiabilite,
            title="Période trop courte",
            message="La période couverte est trop courte pour tirer des conclusions fiables.",
        ))

    run_types = context.get("run_types", [])
    if isinstance(run_types, list) and len(set(run_types)) > 1:
        warnings.append(Warning(
            code="MIXED_RUN_TYPES",
            family=WarningFamily.fiabilite,
            title="Données mixtes",
            message=f"Les données mélangent : {', '.join(sorted(set(run_types)))}. À interpréter avec prudence.",
        ))

    # Peu de trades récents
    if len(monthly) >= 3:
        last_month_trades = monthly[-1].get("trades", 0) if monthly else 0
        avg_trades = sum(mb.get("trades", 0) for mb in monthly) / len(monthly)
        if avg_trades > 0 and last_month_trades < avg_trades * 0.3:
            warnings.append(Warning(
                code="FEW_RECENT_TRADES",
                family=WarningFamily.fiabilite,
                title="Peu de trades récents",
                message="Le dernier mois montre une activité nettement plus faible que la moyenne.",
            ))

    # ---- Risque ----

    recovery_factor = m.get("recovery_factor")
    if max_dd > 0 and pnl != 0 and max_dd > abs(pnl) * 0.5:
        # Un bon recovery factor atténue le signal
        if recovery_factor is None or recovery_factor < 5:
            warnings.append(Warning(
                code="HIGH_DRAWDOWN",
                family=WarningFamily.risque,
                title="Drawdown élevé",
                message=f"Drawdown de {max_dd:.2f} — disproportionné par rapport au PnL total.",
            ))

    # Drawdown en % du capital — dangereux au-delà de 30%, critique au-delà de 50%
    # Remplace tout warning DD$ existant par le warning DD% (plus pertinent)
    if max_dd_pct is not None:
        dd_pct_abs = abs(max_dd_pct)
        if dd_pct_abs >= 0.50:
            warnings = [w for w in warnings if w.code != "HIGH_DRAWDOWN"]
            warnings.append(Warning(
                code="HIGH_DRAWDOWN",
                family=WarningFamily.risque,
                title="Drawdown élevé",
                message=f"Drawdown de {dd_pct_abs:.0%} du capital — risque majeur de ruine.",
            ))
        elif dd_pct_abs >= 0.30:
            warnings = [w for w in warnings if w.code != "HIGH_DRAWDOWN"]
            warnings.append(Warning(
                code="HIGH_DRAWDOWN",
                family=WarningFamily.risque,
                title="Drawdown élevé",
                message=f"Drawdown de {dd_pct_abs:.0%} du capital — vigilance nécessaire.",
            ))

    # Pertes concentrées
    if split_half and split_half.get("status") == "degrading":
        warnings.append(Warning(
            code="RECENT_INSTABILITY",
            family=WarningFamily.risque,
            title="Instabilité récente",
            message="La deuxième moitié de la période montre une dégradation significative.",
        ))

    # ---- Qualité de performance ----

    # Performance portée par quelques gros trades
    # Seuil adaptatif : plus il y a de trades, moins un seul devrait peser
    if total_trades >= 100:
        dominance_threshold = 0.10
    elif total_trades >= 50:
        dominance_threshold = 0.20
    elif total_trades >= 30:
        dominance_threshold = 0.30
    else:
        dominance_threshold = 0.50

    if best_trade > 0 and pnl > 0 and best_trade > pnl * dominance_threshold:
        pct = best_trade / pnl * 100
        warnings.append(Warning(
            code="SINGLE_TRADE_DOMINANCE",
            family=WarningFamily.qualite,
            title="Performance concentrée",
            message=f"Le meilleur trade représente {pct:.0f}% du PnL total — trop pour {total_trades} trades.",
        ))

    # Expectancy trop faible malgré bon win rate
    if win_rate >= 0.55 and expectancy < 1.0 and total_trades >= 10:
        warnings.append(Warning(
            code="LOW_EXPECTANCY_HIGH_WR",
            family=WarningFamily.qualite,
            title="Expectancy faible malgré bon win rate",
            message=f"Win rate de {win_rate:.0%} mais expectancy de seulement {expectancy:.2f} par trade.",
        ))

    # Profit factor trop limite
    if pf is not None and 1.0 < pf < 1.2 and total_trades >= 10:
        warnings.append(Warning(
            code="PF_BORDERLINE",
            family=WarningFamily.qualite,
            title="Profit factor limite",
            message=f"Profit factor de {pf:.2f} — trop juste pour être rassurant.",
        ))

    # Sharpe ratio faible malgré PnL positif
    if sharpe is not None and sharpe < 0.5 and pnl > 0:
        warnings.append(Warning(
            code="LOW_SHARPE_POSITIVE_PNL",
            family=WarningFamily.qualite,
            title="Sharpe ratio faible",
            message=f"Sharpe de {sharpe:.2f} malgré un PnL positif — rendement très variable.",
        ))

    # Retourner max 4 warnings, priorisés.
    # Échantillon faible toujours en P0 : si on a peu de trades, tout le
    # reste est peu fiable → "tester plus" doit être le premier message.
    family_priority = {WarningFamily.risque: 1, WarningFamily.fiabilite: 2, WarningFamily.qualite: 3}
    warnings.sort(key=lambda w: (0 if w.code == "SMALL_SAMPLE" else family_priority.get(w.family, 99)))
    return warnings[:4]


# ══════════════════════════════════════════════════════════════
# Régularité
# ══════════════════════════════════════════════════════════════

_REGULARITY_MAP = {
    Regularity.reguliere: ("Régulière", "Les résultats sont répartis de manière cohérente dans le temps."),
    Regularity.assez_reguliere: ("Assez régulière", "Les résultats montrent une certaine régularité, avec quelques écarts."),
    Regularity.irreguliere: ("Irrégulière", "Les résultats manquent encore de stabilité."),
    Regularity.tres_irreguliere: ("Très irrégulière", "La performance dépend surtout d'une courte période."),
}


def _compute_regularity(m: dict[str, Any]) -> RegularityResult | None:
    """Évalue la régularité à partir du consistency_score."""
    score = m.get("consistency_score")
    if score is None:
        return None

    if score >= 70:
        level = Regularity.reguliere
    elif score >= 50:
        level = Regularity.assez_reguliere
    elif score >= 30:
        level = Regularity.irreguliere
    else:
        level = Regularity.tres_irreguliere

    label, phrase = _REGULARITY_MAP[level]
    return RegularityResult(level=level, label=label, phrase=phrase)


# ══════════════════════════════════════════════════════════════
# Confiance
# ══════════════════════════════════════════════════════════════

def _compute_confidence(m: dict[str, Any], warnings: list[Warning]) -> ConfidenceLevel:
    """Calcule l'indice de confiance de l'analyse."""
    total_trades = m.get("total_trades", 0)
    monthly = m.get("monthly_breakdown", [])
    n_warnings = len(warnings)
    has_risk_warning = any(w.family == WarningFamily.risque for w in warnings)

    if total_trades < _MIN_TRADES_FRAGILE or n_warnings >= 3:
        return ConfidenceLevel.faible
    if total_trades < _MIN_TRADES_CONFIRM or has_risk_warning or n_warnings >= 2:
        return ConfidenceLevel.moyen
    if total_trades >= _MIN_TRADES_SOLID and len(monthly) >= 6 and n_warnings == 0:
        return ConfidenceLevel.eleve
    return ConfidenceLevel.bon


_CONFIDENCE_LABELS = {
    ConfidenceLevel.faible: "Limitée",
    ConfidenceLevel.moyen: "Correcte",
    ConfidenceLevel.bon: "Bonne",
    ConfidenceLevel.eleve: "Élevée",
}


# ══════════════════════════════════════════════════════════════
# Score interne & verdict
# ══════════════════════════════════════════════════════════════

def _compute_internal_score(m: dict[str, Any]) -> int:
    """Score interne sur 100 qui pilote le verdict. Non exposé tel quel."""
    score = 0
    total_trades = m.get("total_trades", 0)
    pnl = m.get("total_pnl", 0)
    pf = m.get("profit_factor")
    wr = m.get("win_rate", 0)
    dd = m.get("max_drawdown", 0)
    expectancy = m.get("expectancy", 0)
    sharpe = m.get("sharpe_ratio")
    consistency = m.get("consistency_score")

    recovery = m.get("recovery_factor")
    dd_pct = m.get("max_drawdown_pct_true") or m.get("max_drawdown_pct")

    # Performance (40 pts max)
    if pnl > 0:
        score += 10
    if pf is not None and pf > 1.5:
        score += 10
    elif pf is not None and pf > 1.2:
        score += 5
    if expectancy > 0:
        score += 10
    if sharpe is not None and sharpe > 1.0:
        score += 5
    elif sharpe is not None and sharpe > 0.5:
        score += 2
    if recovery is not None and recovery >= 3:
        score += 5

    # Risque (25 pts max)
    if dd == 0 or (pnl != 0 and dd < abs(pnl) * 0.3):
        score += 15
    elif pnl != 0 and dd < abs(pnl) * 0.5:
        score += 10
    elif pnl != 0 and dd < abs(pnl):
        score += 5
    if wr >= 0.5:
        score += 10
    elif wr >= 0.4:
        score += 5

    # Pénalité DD% — un drawdown > 30% du capital est un signal de risque fort
    if dd_pct is not None:
        dd_pct_abs = abs(dd_pct)
        if dd_pct_abs >= 0.50:
            score -= 20
        elif dd_pct_abs >= 0.30:
            score -= 10

    # Échantillon (20 pts max)
    if total_trades >= 100:
        score += 20
    elif total_trades >= 50:
        score += 15
    elif total_trades >= 30:
        score += 10
    elif total_trades >= 10:
        score += 5

    # Régularité (15 pts max)
    if consistency is not None:
        if consistency >= 70:
            score += 15
        elif consistency >= 50:
            score += 10
        elif consistency >= 30:
            score += 5

    return max(0, min(100, score))


def _determine_verdict(score: int, m: dict[str, Any], warnings: list[Warning]) -> Verdict:
    """Détermine le verdict à partir du score interne et des warnings."""
    total_trades = m.get("total_trades", 0)
    pnl = m.get("total_pnl", 0)
    has_risk_warning = any(w.family == WarningFamily.risque for w in warnings)

    expectancy = m.get("expectancy", 0)

    # Pas assez de trades → à confirmer
    if total_trades < _MIN_TRADES_FRAGILE:
        return Verdict.a_confirmer

    # PnL négatif ET expectancy négative → Fragile (breakeven toléré)
    if pnl < 0 and expectancy <= 0 and score < 35:
        return Verdict.fragile

    # Solide exige un large échantillon + score élevé + pas de risque
    if score >= 70 and not has_risk_warning and total_trades >= _MIN_TRADES_SOLID:
        return Verdict.solide

    # Bons signaux mais un critère manque
    if score >= 45:
        return Verdict.prometteuse

    # Signaux mitigés ou données insuffisantes
    if score >= 25:
        return Verdict.a_confirmer

    return Verdict.fragile


_VERDICT_LABELS = {
    Verdict.solide: "Solide",
    Verdict.prometteuse: "Prometteuse",
    Verdict.a_confirmer: "À confirmer",
    Verdict.fragile: "Fragile",
}


def compute_verdict_only(metrics: dict[str, Any]) -> tuple[str, str]:
    """Calcul léger du verdict sans synthèse/action/warnings détaillés.

    Returns (verdict_value, verdict_label) — ex. ("prometteuse", "Prometteuse").
    """
    if not metrics or metrics.get("total_trades", 0) == 0:
        return ("fragile", "Fragile")
    context = _build_context(metrics)
    warnings = _collect_warnings(metrics, context)
    score = _compute_internal_score(metrics)
    verdict = _determine_verdict(score, metrics, warnings)
    return (verdict.value, _VERDICT_LABELS[verdict])


# ══════════════════════════════════════════════════════════════
# Phrase de synthèse
# ══════════════════════════════════════════════════════════════

def _build_synthesis(verdict: Verdict, m: dict[str, Any], warnings: list[Warning]) -> str:
    """Construit la phrase de synthèse : [point fort], mais [limite principale]."""
    pnl = m.get("total_pnl", 0)
    pf = m.get("profit_factor")
    wr = m.get("win_rate", 0)
    dd = m.get("max_drawdown", 0)
    total_trades = m.get("total_trades", 0)
    sharpe = m.get("sharpe_ratio")
    consistency = m.get("consistency_score")
    expectancy = m.get("expectancy", 0)

    # ---- Point fort ----
    strength = None
    if pnl > 0 and pf is not None and pf > 1.5:
        strength = "Bonne rentabilité"
    elif pnl > 0 and wr >= 0.55:
        strength = "Bon taux de réussite"
    elif consistency is not None and consistency >= 60:
        strength = "Variante régulière"
    elif pnl > 0:
        strength = "Résultats positifs"
    elif expectancy > 0:
        strength = "Espérance positive"
    elif pnl <= 0:
        strength = "Résultats négatifs pour l'instant"
    else:
        strength = "Données insuffisantes"

    # ---- Limite ----
    limit = None
    if total_trades < _MIN_TRADES_CONFIRM:
        remaining = _MIN_TRADES_CONFIRM - total_trades
        limit = f"échantillon trop faible — encore au moins {remaining} trades pour conclure"
    elif any(w.code == "HIGH_DRAWDOWN" for w in warnings):
        dd_pct_val = m.get("max_drawdown_pct_true") or m.get("max_drawdown_pct")
        if dd_pct_val is not None:
            limit = f"drawdown de {abs(dd_pct_val):.0%} du capital — trop risqué"
        else:
            limit = "drawdown trop élevé pour être rassurant"
    elif any(w.code == "SINGLE_TRADE_DOMINANCE" for w in warnings):
        limit = "trop dépendante de quelques gros trades"
    elif any(w.code == "RECENT_INSTABILITY" for w in warnings):
        limit = "instabilité récente détectée"
    elif pf is not None and pf < 1.3:
        limit = "profit factor encore modeste"
    elif sharpe is not None and sharpe < 0.5:
        limit = "rendement encore trop variable"
    elif pnl <= 0:
        limit = "rendement global négatif"
    elif consistency is not None and consistency < 50:
        limit = "résultats encore irréguliers"
    else:
        # Aucune faiblesse concrète détectée — adapter au verdict
        if verdict == Verdict.solide:
            limit = "à maintenir dans la durée"
        elif verdict == Verdict.prometteuse:
            limit = "à consolider avec plus de données"
        else:
            limit = "à confirmer sur une période plus longue"

    return f"{strength}, mais {limit}."


# ══════════════════════════════════════════════════════════════
# Action recommandée
# ══════════════════════════════════════════════════════════════

_ACTION_LABELS = {
    ActionType.continuer_test: "Continuer le test",
    ActionType.comparer_variante_mere: "Comparer à la variante mère",
    ActionType.reduire_risque: "Réduire le risque / retravailler l'exécution",
    ActionType.forward_test: "Passer en forward test",
    ActionType.promouvoir_active: "Promouvoir en active",
    ActionType.mettre_en_pause: "Mettre en pause",
    ActionType.archiver: "Archiver",
}


def _recommend_action(
    verdict: Verdict,
    m: dict[str, Any],
    warnings: list[Warning],
    has_parent: bool = False,
) -> RecommendedAction:
    """Détermine l'action principale + éventuelle action secondaire."""
    total_trades = m.get("total_trades", 0)
    pnl = m.get("total_pnl", 0)

    # P0 : peu de trades → toujours "continuer le test", quel que soit le verdict
    if total_trades < _MIN_TRADES_CONFIRM:
        remaining = max(0, _MIN_TRADES_CONFIRM - total_trades)
        primary = ActionType.continuer_test
        secondary = f"Accumuler au moins {remaining} trades de plus avant toute conclusion"
    elif verdict == Verdict.solide:
        primary = ActionType.forward_test
        secondary = "Promouvoir en active si le forward test confirme" if total_trades >= 50 else None
    elif verdict == Verdict.prometteuse:
        primary = ActionType.continuer_test
        secondary_parts = []
        if any(w.code == "HIGH_DRAWDOWN" for w in warnings):
            secondary_parts.append("réduire le risque ou le levier")
        if has_parent:
            secondary_parts.append("comparer à la variante mère")
        secondary = " — ".join(secondary_parts) if secondary_parts else None
    elif verdict == Verdict.a_confirmer:
        has_dd = any(w.code == "HIGH_DRAWDOWN" for w in warnings)
        if has_dd:
            primary = ActionType.reduire_risque
            secondary = "Revoir la gestion du risque avant de poursuivre"
        else:
            primary = ActionType.continuer_test
            secondary_parts = []
            if total_trades < _MIN_TRADES_CONFIRM:
                remaining = max(0, _MIN_TRADES_CONFIRM - total_trades)
                secondary_parts.append(f"accumuler au moins {remaining} trades de plus")
            if has_parent:
                secondary_parts.append("comparer à la variante mère")
            secondary = " — ".join(secondary_parts) if secondary_parts else None
    else:
        # Fragile
        if pnl <= 0 and total_trades >= _MIN_TRADES_SOLID:
            primary = ActionType.archiver
            secondary = None
        elif any(w.code == "HIGH_DRAWDOWN" for w in warnings):
            primary = ActionType.reduire_risque
            secondary = "Revoir la gestion du risque avant de poursuivre"
        else:
            primary = ActionType.mettre_en_pause
            secondary = "Revoir les paramètres ou créer une itération"

    return RecommendedAction(
        primary=primary,
        primary_label=_ACTION_LABELS[primary],
        secondary=secondary,
    )


# ══════════════════════════════════════════════════════════════
# KPIs
# ══════════════════════════════════════════════════════════════

def _extract_kpis(m: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Sépare les KPIs en bloc principal et bloc secondaire."""
    primary = {
        "pnl": m.get("total_pnl"),
        "total_trades": m.get("total_trades"),
        "win_rate": m.get("win_rate"),
        "profit_factor": m.get("profit_factor"),
        "expectancy": m.get("expectancy"),
        "max_drawdown": m.get("max_drawdown"),
        "sharpe_ratio": m.get("sharpe_ratio"),
    }
    secondary = {
        "avg_win": m.get("avg_win"),
        "avg_loss": m.get("avg_loss"),
        "best_trade": m.get("best_trade"),
        "worst_trade": m.get("worst_trade"),
        "risk_reward_ratio": m.get("risk_reward_ratio"),
    }
    return primary, secondary


# ══════════════════════════════════════════════════════════════
# Contexte
# ══════════════════════════════════════════════════════════════

def _build_context(
    m: dict[str, Any],
    *,
    run_types: list[str] | None = None,
    runs_count: int | None = None,
    instruments: list[str] | None = None,
    timeframes: list[str] | None = None,
    strategy_name: str | None = None,
    variant_name: str | None = None,
    parent_variant_name: str | None = None,
) -> dict[str, Any]:
    """Construit le bloc de contexte de lecture."""
    monthly = m.get("monthly_breakdown", [])
    period_start = monthly[0]["month"] if monthly else None
    period_end = monthly[-1]["month"] if monthly else None

    return {
        "run_types": run_types or [],
        "period_start": period_start,
        "period_end": period_end,
        "runs_count": runs_count,
        "instruments": instruments or [],
        "timeframes": timeframes or [],
        "strategy_name": strategy_name,
        "variant_name": variant_name,
        "parent_variant_name": parent_variant_name,
    }


# ══════════════════════════════════════════════════════════════
# Point d'entrée : analyse variante
# ══════════════════════════════════════════════════════════════

def analyze_variant(
    metrics: dict[str, Any],
    *,
    run_types: list[str] | None = None,
    runs_count: int | None = None,
    instruments: list[str] | None = None,
    timeframes: list[str] | None = None,
    strategy_name: str | None = None,
    variant_name: str | None = None,
    parent_variant_name: str | None = None,
) -> VariantAnalysis:
    """Analyse complète d'une variante à partir de ses métriques agrégées.

    Args:
        metrics: Résultat de compute_metrics().
        run_types: Liste des types de runs agrégés (backtest, forward, live).
        runs_count: Nombre de runs agrégés.
        instruments, timeframes, strategy_name, variant_name, parent_variant_name:
            Contexte optionnel pour enrichir l'affichage.

    Returns:
        VariantAnalysis — résultat complet de l'analyse V1.
    """
    context = _build_context(
        metrics,
        run_types=run_types,
        runs_count=runs_count,
        instruments=instruments,
        timeframes=timeframes,
        strategy_name=strategy_name,
        variant_name=variant_name,
        parent_variant_name=parent_variant_name,
    )

    warnings = _collect_warnings(metrics, context)
    regularity = _compute_regularity(metrics)
    internal_score = _compute_internal_score(metrics)
    verdict = _determine_verdict(internal_score, metrics, warnings)
    confidence = _compute_confidence(metrics, warnings)
    synthesis = _build_synthesis(verdict, metrics, warnings)
    action = _recommend_action(
        verdict, metrics, warnings,
        has_parent=parent_variant_name is not None,
    )
    kpis_primary, kpis_secondary = _extract_kpis(metrics)

    return VariantAnalysis(
        verdict=verdict,
        verdict_label=_VERDICT_LABELS[verdict],
        synthesis=synthesis,
        action=action,
        confidence=confidence,
        confidence_label=_CONFIDENCE_LABELS[confidence],
        regularity=regularity,
        warnings=warnings,
        context=context,
        kpis_primary=kpis_primary,
        kpis_secondary=kpis_secondary,
        _internal_score=internal_score,
    )


# ══════════════════════════════════════════════════════════════
# Compare de variantes
# ══════════════════════════════════════════════════════════════

def _compare_metric(
    val_a: float | None,
    val_b: float | None,
    higher_is_better: bool = True,
) -> str | None:
    """Retourne 'a', 'b', ou None (tie / n/a)."""
    if val_a is None or val_b is None:
        return None
    if val_a == val_b:
        return None
    if higher_is_better:
        return "a" if val_a > val_b else "b"
    return "a" if val_a < val_b else "b"


def compare_variants(
    metrics_a: dict[str, Any],
    metrics_b: dict[str, Any],
    name_a: str = "A",
    name_b: str = "B",
) -> CompareAnalysis:
    """Compare deux variantes selon 3 angles : performance, stabilité, compromis.

    Args:
        metrics_a, metrics_b: Résultats de compute_metrics() pour chaque variante.
        name_a, name_b: Noms d'affichage.

    Returns:
        CompareAnalysis — verdict, badges, table KPI, décision.
    """
    # ---- Angle 1 : Performance (plus rentable) ----
    perf_signals = []
    for metric, higher in [("total_pnl", True), ("expectancy", True), ("profit_factor", True)]:
        w = _compare_metric(metrics_a.get(metric), metrics_b.get(metric), higher)
        if w:
            perf_signals.append(w)

    perf_winner = None
    if perf_signals:
        a_count = perf_signals.count("a")
        b_count = perf_signals.count("b")
        if a_count > b_count:
            perf_winner = "a"
        elif b_count > a_count:
            perf_winner = "b"

    # ---- Angle 2 : Stabilité (meilleur drawdown + régularité) ----
    stab_signals = []
    dd_w = _compare_metric(
        metrics_a.get("max_drawdown"),
        metrics_b.get("max_drawdown"),
        higher_is_better=False,
    )
    if dd_w:
        stab_signals.append(dd_w)

    cons_w = _compare_metric(
        metrics_a.get("consistency_score"),
        metrics_b.get("consistency_score"),
    )
    if cons_w:
        stab_signals.append(cons_w)

    sharpe_w = _compare_metric(
        metrics_a.get("sharpe_ratio"),
        metrics_b.get("sharpe_ratio"),
    )
    if sharpe_w:
        stab_signals.append(sharpe_w)

    stab_winner = None
    if stab_signals:
        a_count = stab_signals.count("a")
        b_count = stab_signals.count("b")
        if a_count > b_count:
            stab_winner = "a"
        elif b_count > a_count:
            stab_winner = "b"

    # ---- Angle 3 : Compromis (meilleur équilibre rendement/risque/fiabilité) ----
    # Combinaison des deux angles + recovery factor + risk/reward
    comp_signals = []
    if perf_winner:
        comp_signals.append(perf_winner)
    if stab_winner:
        comp_signals.append(stab_winner)

    rf_w = _compare_metric(
        metrics_a.get("recovery_factor"),
        metrics_b.get("recovery_factor"),
    )
    if rf_w:
        comp_signals.append(rf_w)

    rr_w = _compare_metric(
        metrics_a.get("risk_reward_ratio"),
        metrics_b.get("risk_reward_ratio"),
    )
    if rr_w:
        comp_signals.append(rr_w)

    comp_winner = None
    if comp_signals:
        a_count = comp_signals.count("a")
        b_count = comp_signals.count("b")
        if a_count > b_count:
            comp_winner = "a"
        elif b_count > a_count:
            comp_winner = "b"

    # ---- Badges ----
    badges: list[CompareBadgeResult] = []
    if perf_winner:
        badges.append(CompareBadgeResult(
            badge=CompareBadge.plus_rentable,
            label="Plus rentable",
            winner=perf_winner,
            winner_name=name_a if perf_winner == "a" else name_b,
        ))
    if stab_winner:
        badges.append(CompareBadgeResult(
            badge=CompareBadge.plus_stable,
            label="Plus stable",
            winner=stab_winner,
            winner_name=name_a if stab_winner == "a" else name_b,
        ))
    if comp_winner:
        badges.append(CompareBadgeResult(
            badge=CompareBadge.meilleur_compromis,
            label="Meilleur compromis",
            winner=comp_winner,
            winner_name=name_a if comp_winner == "a" else name_b,
        ))

    # ---- Décision finale ----
    trades_a = metrics_a.get("total_trades", 0)
    trades_b = metrics_b.get("total_trades", 0)
    min_trades = min(trades_a, trades_b)

    if min_trades < _MIN_TRADES_FRAGILE:
        decision = CompareDecision.pas_assez_de_recul
    elif comp_winner == "a" and perf_winner == "a":
        decision = CompareDecision.garder_a
    elif comp_winner == "b" and perf_winner == "b":
        decision = CompareDecision.garder_b
    elif comp_winner is None:
        decision = CompareDecision.continuer_test
    else:
        decision = CompareDecision.continuer_test

    _DECISION_LABELS = {
        CompareDecision.garder_a: f"Conserver {name_a}",
        CompareDecision.garder_b: f"Conserver {name_b}",
        CompareDecision.continuer_test: "Continuer le test",
        CompareDecision.pas_assez_de_recul: "Pas assez de recul pour trancher",
    }

    # ---- Verdict texte ----
    if decision == CompareDecision.garder_a:
        verdict_text = (
            f"La variante {name_a} semble meilleure à ce stade, "
            f"surtout grâce à un meilleur compromis rendement / drawdown."
        )
    elif decision == CompareDecision.garder_b:
        verdict_text = (
            f"La variante {name_b} semble meilleure à ce stade, "
            f"surtout grâce à un meilleur compromis rendement / drawdown."
        )
    elif decision == CompareDecision.pas_assez_de_recul:
        verdict_text = (
            f"Les deux variantes manquent encore de données pour être départagées."
        )
    else:
        verdict_text = (
            f"Les deux variantes sont trop proches pour trancher. "
            f"Continuer les tests pour accumuler plus de données."
        )

    # ---- Table KPI ----
    kpi_keys = [
        ("pnl", "total_pnl", "PnL"),
        ("total_trades", "total_trades", "Nombre de trades"),
        ("win_rate", "win_rate", "Win rate"),
        ("profit_factor", "profit_factor", "Profit factor"),
        ("expectancy", "expectancy", "Expectancy"),
        ("max_drawdown", "max_drawdown", "Max drawdown"),
        ("sharpe_ratio", "sharpe_ratio", "Sharpe ratio"),
    ]
    kpi_table = []
    for key, metric_key, label in kpi_keys:
        val_a = metrics_a.get(metric_key)
        val_b = metrics_b.get(metric_key)
        kpi_table.append({
            "key": key,
            "label": label,
            "value_a": val_a,
            "value_b": val_b,
        })

    # ---- Warnings compare ----
    warnings: list[Warning] = []
    if min_trades < _MIN_TRADES_CONFIRM:
        warnings.append(Warning(
            code="SMALL_SAMPLE_COMPARE",
            family=WarningFamily.fiabilite,
            title="Échantillon insuffisant",
            message="L'une des variantes a trop peu de trades pour une comparaison fiable.",
        ))

    # Déséquilibre de volume
    if trades_a > 0 and trades_b > 0:
        ratio = max(trades_a, trades_b) / min(trades_a, trades_b)
        if ratio > 3:
            warnings.append(Warning(
                code="TRADE_IMBALANCE",
                family=WarningFamily.fiabilite,
                title="Déséquilibre de volume",
                message=f"Ratio de trades : {ratio:.1f}x — la comparaison perd en fiabilité.",
            ))

    return CompareAnalysis(
        verdict=verdict_text,
        decision=decision,
        decision_label=_DECISION_LABELS[decision],
        badges=badges,
        kpi_table=kpi_table,
        warnings=warnings[:4],
    )
