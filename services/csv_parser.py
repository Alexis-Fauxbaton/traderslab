"""Service de parsing CSV pour l'import de trades.

Supporte un mapping de colonnes flexible. Si aucun mapping n'est fourni,
utilise le format FX Replay par défaut :
Open Time, Close Time, Symbol, Type, Entry, Exit, Lots, Profit, Pips
"""

import io
from datetime import datetime

import pandas as pd


# Mapping par défaut (format FX Replay)
DEFAULT_MAPPING = {
    "open_time": "Open Time",
    "close_time": "Close Time",
    "symbol": "Symbol",
    "side": "Type",
    "entry_price": "Entry",
    "exit_price": "Exit",
    "lot_size": "Lots",
    "pnl": "Profit",
    "pips": "Pips",
}


def _normalize_side(value: str) -> str:
    """Normalise le champ side : buy/BUY/long → long, sell/SELL/short → short."""
    v = str(value).strip().lower()
    if v in ("buy", "long"):
        return "long"
    if v in ("sell", "short"):
        return "short"
    raise ValueError(f"Valeur de side non reconnue : '{value}'")


def parse_csv(
    file_content: bytes,
    column_mapping: dict[str, str] | None = None,
) -> tuple[list[dict], list[str]]:
    """Parse un fichier CSV et retourne (trades_valides, erreurs_par_ligne).

    Args:
        file_content: contenu brut du fichier CSV.
        column_mapping: mapping {champ_interne: nom_colonne_csv}. Si None, utilise le format FX Replay.

    Returns:
        Tuple (liste de dicts trades, liste de messages d'erreur).
    """
    mapping = column_mapping or DEFAULT_MAPPING

    df = pd.read_csv(io.BytesIO(file_content))
    # Nettoyage espaces dans les noms de colonnes
    df.columns = df.columns.str.strip()

    # Vérifier que les colonnes du mapping existent (sauf pips qui est optionnel)
    missing = []
    for field, csv_col in mapping.items():
        if csv_col not in df.columns and field != "pips":
            missing.append(f"Colonne '{csv_col}' manquante pour le champ '{field}'")
    if missing:
        return [], missing

    # Renommage inverse : csv_col → champ_interne
    rename_map = {csv_col: field for field, csv_col in mapping.items() if csv_col in df.columns}
    df = df.rename(columns=rename_map)

    trades: list[dict] = []
    errors: list[str] = []

    for idx, row in df.iterrows():
        line_num = idx + 2  # +2 car header=ligne 1, index 0=ligne 2
        try:
            open_time = pd.to_datetime(row["open_time"])
            close_time = pd.to_datetime(row["close_time"])

            if pd.isna(open_time) or pd.isna(close_time):
                raise ValueError("Date manquante")

            side = _normalize_side(row["side"])
            entry_price = float(row["entry_price"])
            exit_price = float(row["exit_price"])
            lot_size = float(row["lot_size"])
            pnl = float(row["pnl"])
            symbol = str(row["symbol"]).strip()

            pips = None
            if "pips" in df.columns and pd.notna(row.get("pips")):
                pips = float(row["pips"])

            trades.append({
                "open_time": open_time.to_pydatetime(),
                "close_time": close_time.to_pydatetime(),
                "symbol": symbol,
                "side": side,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "lot_size": lot_size,
                "pnl": pnl,
                "pips": pips,
            })

        except Exception as e:
            errors.append(f"Ligne {line_num}: {e}")

    return trades, errors
