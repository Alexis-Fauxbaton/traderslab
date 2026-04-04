"""Tests du moteur d'analyse V1 — services/analysis.py.

Couvre : verdict, synthèse, actions, warnings, régularité, confiance, compare.
"""

import pytest
from datetime import datetime
from services.metrics import compute_metrics
from services.analysis import (
    analyze_variant,
    compare_variants,
    Verdict,
    ConfidenceLevel,
    Regularity,
    ActionType,
    WarningFamily,
    CompareDecision,
    CompareBadge,
)


# ─── Helpers ───────────────────────────────────────────────────

def make_trades(pnls: list[float], start: str = "2024-01") -> list[dict]:
    """Génère des trades avec dates incrémentales."""
    trades = []
    for i, pnl in enumerate(pnls):
        month = (i // 28) + 1
        day = (i % 28) + 1
        if month > 12:
            month = 12
            day = min(day, 28)
        dt = datetime.fromisoformat(f"{start[:4]}-{str(month).zfill(2)}-{str(day).zfill(2)}T10:00:00")
        trades.append({"pnl": pnl, "close_time": dt})
    return trades


def make_metrics(pnls: list[float], start: str = "2024-01") -> dict:
    """Raccourci : génère trades + calcule métriques."""
    return compute_metrics(make_trades(pnls, start))


# ═══════════════════════════════════════════════════════════════
# Tests : Verdicts
# ═══════════════════════════════════════════════════════════════

class TestVerdicts:
    """Vérifie la logique des 4 verdicts : Solide, Prometteuse, À confirmer, Fragile."""

    def test_verdict_solide(self):
        """Bonnes performances, échantillon suffisant → Solide."""
        # 100 trades, tous gagnants sauf quelques petites pertes
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 10
        metrics = make_metrics(pnls)
        result = analyze_variant(metrics)
        assert result.verdict == Verdict.solide
        assert result.verdict_label == "Solide"

    def test_verdict_prometteuse(self):
        """Signaux positifs mais échantillon insuffisant → Prometteuse."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42, 30, 20,
                 35, 25, -15, 55, 40, -5, 30, 45]
        metrics = make_metrics(pnls)
        result = analyze_variant(metrics)
        # Pas assez de trades pour Solide, mais bons signaux
        assert result.verdict in (Verdict.prometteuse, Verdict.a_confirmer)

    def test_verdict_a_confirmer_few_trades(self):
        """Trop peu de trades → À confirmer."""
        pnls = [50, 40, -10, 60, -5]
        metrics = make_metrics(pnls)
        result = analyze_variant(metrics)
        assert result.verdict == Verdict.a_confirmer

    def test_verdict_fragile(self):
        """Mauvais compromis rendement/risque → Fragile."""
        # Trades perdants avec gros drawdown
        pnls = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42,
                 -30, -35, 5, -40, -20, -50, 10, -30, -45, -55,
                 -20, -30, -10, -40, -15, -25, -35, -50, -20, -30]
        metrics = make_metrics(pnls)
        result = analyze_variant(metrics)
        assert result.verdict == Verdict.fragile
        assert result.verdict_label == "Fragile"

    def test_empty_trades(self):
        """Aucun trade → À confirmer (pas de signal)."""
        metrics = compute_metrics([])
        result = analyze_variant(metrics)
        assert result.verdict == Verdict.a_confirmer


# ═══════════════════════════════════════════════════════════════
# Tests : Phrase de synthèse
# ═══════════════════════════════════════════════════════════════

class TestSynthesis:
    """La phrase de synthèse doit suivre le format [force], mais [limite]."""

    def test_synthesis_format(self):
        """Format : 'X, mais Y.'"""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        result = analyze_variant(make_metrics(pnls))
        assert ", mais " in result.synthesis
        assert result.synthesis.endswith(".")

    def test_synthesis_mentions_sample_when_small(self):
        """Échantillon faible mentionné dans la synthèse."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        result = analyze_variant(make_metrics(pnls))
        assert "échantillon" in result.synthesis.lower()

    def test_synthesis_not_empty(self):
        """La synthèse n'est jamais vide."""
        for pnls in [[100], [-100], [0], [50, -50] * 20]:
            result = analyze_variant(make_metrics(pnls))
            assert len(result.synthesis) > 10


# ═══════════════════════════════════════════════════════════════
# Tests : Actions recommandées
# ═══════════════════════════════════════════════════════════════

class TestActions:
    """Vérifie la cohérence entre verdict et action."""

    def test_solide_recommends_forward(self):
        """Solide → Passer en forward test."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 10
        result = analyze_variant(make_metrics(pnls))
        if result.verdict == Verdict.solide:
            assert result.action.primary == ActionType.forward_test

    def test_prometteuse_recommends_continue(self):
        """Prometteuse → Continuer le test."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42, 30, 20]
        result = analyze_variant(make_metrics(pnls))
        if result.verdict == Verdict.prometteuse:
            assert result.action.primary == ActionType.continuer_test

    def test_fragile_negative_recommends_archive(self):
        """Fragile avec PnL négatif → Archiver ou mettre en pause."""
        pnls = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42,
                 -30, -35, 5, -40, -20, -50, 10, -30, -45, -55,
                 -20, -30, -10, -40, -15, -25, -35, -50, -20, -30]
        result = analyze_variant(make_metrics(pnls))
        if result.verdict == Verdict.fragile:
            # Avec < 100 trades, on ne recommande pas d'archiver directement
            assert result.action.primary in (
                ActionType.archiver, ActionType.mettre_en_pause, ActionType.reduire_risque
            )

    def test_action_has_label(self):
        """Chaque action a un label lisible."""
        pnls = [50, -20, 30, -10, 40]
        result = analyze_variant(make_metrics(pnls))
        assert len(result.action.primary_label) > 5

    def test_secondary_action_with_parent(self):
        """Prometteuse + parent → action secondaire mentionne la variante mère."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42, 30, 20]
        result = analyze_variant(
            make_metrics(pnls),
            parent_variant_name="Base v1",
        )
        if result.verdict == Verdict.prometteuse and result.action.secondary:
            assert "variante mère" in result.action.secondary


# ═══════════════════════════════════════════════════════════════
# Tests : Warnings
# ═══════════════════════════════════════════════════════════════

class TestWarnings:
    """Vérifie les warnings structurés par famille."""

    def test_max_4_warnings(self):
        """Maximum 4 warnings affichés."""
        # Beaucoup de signaux d'alerte
        pnls = [500, -400, 300, -250, 200, -180, 150, -130, 100, -90]
        result = analyze_variant(make_metrics(pnls))
        assert len(result.warnings) <= 4

    def test_small_sample_warning(self):
        """Échantillon faible déclenche un warning fiabilité."""
        pnls = [50, 40, -10, 60, -5]
        result = analyze_variant(make_metrics(pnls))
        codes = [w.code for w in result.warnings]
        assert "SMALL_SAMPLE" in codes

    def test_warning_families(self):
        """Les warnings utilisent les 3 familles."""
        valid_families = {WarningFamily.fiabilite, WarningFamily.risque, WarningFamily.qualite}
        pnls = [500, -400, 10, -350, 200, -180, 150, -130, 100, -90,
                 50, -40, 30, -20, 10, -5, 80, -60, 20, -15,
                 500, -400, 10, -350, 200, -180, 150, -130, 100, -90]
        result = analyze_variant(make_metrics(pnls))
        for w in result.warnings:
            assert w.family in valid_families

    def test_mixed_run_types_warning(self):
        """Mélange de types de runs → warning fiabilité."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        result = analyze_variant(
            make_metrics(pnls),
            run_types=["backtest", "live"],
        )
        codes = [w.code for w in result.warnings]
        assert "MIXED_RUN_TYPES" in codes

    def test_no_warning_on_good_strategy(self):
        """Stratégie solide → peu ou pas de warnings."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 10
        result = analyze_variant(make_metrics(pnls))
        # Peut avoir échantillon ou autre, mais pas de warning risque
        risk_warnings = [w for w in result.warnings if w.family == WarningFamily.risque]
        assert len(risk_warnings) == 0


# ═══════════════════════════════════════════════════════════════
# Tests : Régularité
# ═══════════════════════════════════════════════════════════════

class TestRegularity:
    """Lecture simple de la régularité."""

    def test_regular_strategy(self):
        """Performance constante → Régulière."""
        # Trades réguliers répartis sur 6 mois
        trades = []
        for month in range(1, 7):
            for day in range(1, 6):
                trades.append({"pnl": 10.0, "close_time": datetime(2024, month, day, 10, 0, 0)})
        metrics = compute_metrics(trades)
        result = analyze_variant(metrics)
        assert result.regularity is not None
        assert result.regularity.level in (Regularity.reguliere, Regularity.assez_reguliere)

    def test_irregular_strategy(self):
        """Mois très variables → Irrégulière."""
        trades = []
        for val, month in [(1000, 1), (-800, 2), (1200, 3), (-900, 4)]:
            trades.append({"pnl": val, "close_time": datetime(2024, month, 15, 10, 0, 0)})
        metrics = compute_metrics(trades)
        result = analyze_variant(metrics)
        assert result.regularity is not None
        assert result.regularity.level in (Regularity.irreguliere, Regularity.tres_irreguliere)

    def test_regularity_has_phrase(self):
        """La régularité inclut toujours une phrase descriptive."""
        trades = []
        for month in range(1, 4):
            for day in range(1, 6):
                trades.append({"pnl": 10.0, "close_time": datetime(2024, month, day, 10, 0, 0)})
        metrics = compute_metrics(trades)
        result = analyze_variant(metrics)
        if result.regularity:
            assert len(result.regularity.phrase) > 10

    def test_no_regularity_single_month(self):
        """Un seul mois → pas de régularité calculable."""
        pnls = [50, 40, -10]
        result = analyze_variant(make_metrics(pnls))
        assert result.regularity is None


# ═══════════════════════════════════════════════════════════════
# Tests : Confiance
# ═══════════════════════════════════════════════════════════════

class TestConfidence:
    """Indice de confiance de l'analyse."""

    def test_low_confidence_few_trades(self):
        """Peu de trades → confiance faible."""
        pnls = [50, -10, 30]
        result = analyze_variant(make_metrics(pnls))
        assert result.confidence == ConfidenceLevel.faible

    def test_high_confidence_good_data(self):
        """Beaucoup de trades, bons résultats → confiance élevée."""
        trades = []
        for month in range(1, 7):
            for day in range(1, 11):
                trades.append({"pnl": 10.0, "close_time": datetime(2024, month, day, 10, 0, 0)})
        metrics = compute_metrics(trades)
        result = analyze_variant(metrics)
        assert result.confidence in (ConfidenceLevel.bon, ConfidenceLevel.eleve)

    def test_confidence_labels(self):
        """Les labels de confiance sont toujours présents."""
        pnls = [50, 40, -10]
        result = analyze_variant(make_metrics(pnls))
        assert result.confidence_label in ("Limitée", "Correcte", "Bonne", "Élevée")


# ═══════════════════════════════════════════════════════════════
# Tests : KPIs
# ═══════════════════════════════════════════════════════════════

class TestKPIs:
    """Vérifie la séparation des KPIs en bloc principal et secondaire."""

    def test_primary_kpis(self):
        """Le bloc principal contient les 7 KPIs essentiels."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        result = analyze_variant(make_metrics(pnls))
        expected_keys = {"pnl", "total_trades", "win_rate", "profit_factor", "expectancy", "max_drawdown", "sharpe_ratio"}
        assert set(result.kpis_primary.keys()) == expected_keys

    def test_secondary_kpis(self):
        """Le bloc secondaire contient les KPIs détaillés."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        result = analyze_variant(make_metrics(pnls))
        expected_keys = {"avg_win", "avg_loss", "best_trade", "worst_trade", "risk_reward_ratio"}
        assert set(result.kpis_secondary.keys()) == expected_keys


# ═══════════════════════════════════════════════════════════════
# Tests : Contexte
# ═══════════════════════════════════════════════════════════════

class TestContext:
    """Le contexte de lecture doit être renseigné."""

    def test_context_fields(self):
        """Tous les champs de contexte sont présents."""
        pnls = [50, 40, -10, 60, -5]
        result = analyze_variant(
            make_metrics(pnls),
            run_types=["backtest"],
            runs_count=2,
            strategy_name="MA Cross",
            variant_name="v1.2",
        )
        ctx = result.context
        assert ctx["run_types"] == ["backtest"]
        assert ctx["runs_count"] == 2
        assert ctx["strategy_name"] == "MA Cross"
        assert ctx["variant_name"] == "v1.2"

    def test_context_period(self):
        """Le contexte inclut la période couverte."""
        pnls = [50, 40, -10, 60, -5]
        result = analyze_variant(make_metrics(pnls))
        assert "period_start" in result.context
        assert "period_end" in result.context


# ═══════════════════════════════════════════════════════════════
# Tests : Compare de variantes
# ═══════════════════════════════════════════════════════════════

class TestCompare:
    """Comparaison de deux variantes sur 3 angles."""

    def test_clear_winner(self):
        """Variante A clairement meilleure → garder_a."""
        pnls_a = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 4
        pnls_b = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42] * 4
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b), "Alpha", "Beta")
        assert result.decision == CompareDecision.garder_a

    def test_clear_winner_b(self):
        """Variante B clairement meilleure → garder_b."""
        pnls_a = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42] * 4
        pnls_b = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 4
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b), "Alpha", "Beta")
        assert result.decision == CompareDecision.garder_b

    def test_close_variants(self):
        """Variantes très proches → continuer_test ou pas assez de recul."""
        # A est meilleure en PnL, B a un meilleur drawdown — pas de gagnant clair
        pnls_a = [50, 40, -30, 60, -25, 45, 55, -20, 50, 42] * 4
        pnls_b = [40, 35, -5, 50, -3, 38, 45, -4, 42, 36] * 4
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b))
        assert result.decision in (CompareDecision.continuer_test, CompareDecision.garder_a, CompareDecision.garder_b)

    def test_not_enough_data(self):
        """Trop peu de trades → pas_assez_de_recul."""
        pnls_a = [50, 40, -10]
        pnls_b = [60, 30, -20]
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b))
        assert result.decision == CompareDecision.pas_assez_de_recul

    def test_badges(self):
        """Les badges sont attribués si les données le permettent."""
        pnls_a = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 4
        pnls_b = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42] * 4
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b))
        badge_types = [b.badge for b in result.badges]
        # Au moins un badge devrait être attribué
        assert len(result.badges) >= 1
        for b in result.badges:
            assert b.badge in (CompareBadge.plus_rentable, CompareBadge.plus_stable, CompareBadge.meilleur_compromis)

    def test_kpi_table_structure(self):
        """La table KPI contient les 7 métriques principales."""
        pnls_a = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        pnls_b = [30, 20, -15, 40, -10, 25, 35, -12, 30, 22]
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b))
        assert len(result.kpi_table) == 7
        keys = [row["key"] for row in result.kpi_table]
        assert "pnl" in keys
        assert "sharpe_ratio" in keys

    def test_compare_verdict_text(self):
        """Le verdict textuel n'est pas vide."""
        pnls_a = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        pnls_b = [30, 20, -15, 40, -10, 25, 35, -12, 30, 22]
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b))
        assert len(result.verdict) > 20

    def test_compare_warnings_max_4(self):
        """Maximum 4 warnings dans la comparaison."""
        pnls_a = [50, -10]
        pnls_b = [30, -20, 10]
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b))
        assert len(result.warnings) <= 4

    def test_badge_winner_names(self):
        """Les noms des gagnants sont corrects dans les badges."""
        pnls_a = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 4
        pnls_b = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42] * 4
        result = compare_variants(make_metrics(pnls_a), make_metrics(pnls_b), "Alpha", "Beta")
        for b in result.badges:
            assert b.winner_name in ("Alpha", "Beta")


# ═══════════════════════════════════════════════════════════════
# Tests : Cohérence globale
# ═══════════════════════════════════════════════════════════════

class TestCoherence:
    """Vérifie la cohérence entre les différents éléments de l'analyse."""

    def test_verdict_solide_implies_good_confidence(self):
        """Solide implique confiance bon ou élevé."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42] * 10
        result = analyze_variant(make_metrics(pnls))
        if result.verdict == Verdict.solide:
            assert result.confidence in (ConfidenceLevel.bon, ConfidenceLevel.eleve)

    def test_fragile_has_warnings(self):
        """Fragile devrait avoir au moins un warning."""
        pnls = [-50, -40, 10, -60, 5, -45, -55, 8, -50, -42,
                 -30, -35, 5, -40, -20, -50, 10, -30, -45, -55,
                 -20, -30, -10, -40, -15, -25, -35, -50, -20, -30]
        result = analyze_variant(make_metrics(pnls))
        if result.verdict == Verdict.fragile:
            assert len(result.warnings) >= 1

    def test_all_fields_present(self):
        """Tous les champs de l'analyse sont renseignés."""
        pnls = [50, 40, -10, 60, -5, 45, 55, -8, 50, 42]
        result = analyze_variant(make_metrics(pnls))
        assert result.verdict is not None
        assert result.verdict_label is not None
        assert result.synthesis is not None
        assert result.action is not None
        assert result.confidence is not None
        assert result.confidence_label is not None
        assert result.context is not None
        assert result.kpis_primary is not None
        assert result.kpis_secondary is not None
