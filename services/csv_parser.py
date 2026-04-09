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
    "open_time": "dateStart",
    "close_time": "dateEnd",
    "symbol": "pair",
    "side": "side",
    "entry_price": "entryPrice",
    "exit_price": "avgClosePrice",
    "lot_size": "amount",
    "pnl": "rPnL",
}

# Noms de colonnes connues pour la balance initiale (insensible à la casse)
_BALANCE_COLUMNS = {"initialbalance", "initial_balance", "balance"}


def _normalize_side(value: str) -> str:
    """Normalise le champ side : buy/BUY/long → long, sell/SELL/short → short."""
    v = str(value).strip().lower()
    if v in ("buy", "long"):
        return "long"
    if v in ("sell", "short"):
        return "short"
    raise ValueError(f"Valeur de side non reconnue : '{value}'")


def _detect_currency(df: pd.DataFrame) -> str | None:
    """Tente de détecter la devise du compte depuis le CSV.

    Stratégies :
    1. Colonne 'currency' / 'accountCurrency' / 'base_currency' → première valeur non-vide
    2. Colonne 'Currency Deposit' (MT5) → première valeur non-vide
    """
    cols_lower = {c.strip().lower(): c for c in df.columns}

    for candidate in ("currency", "accountcurrency", "base_currency", "currency deposit"):
        if candidate in cols_lower:
            col = cols_lower[candidate]
            vals = df[col].dropna().astype(str).str.strip()
            vals = vals[vals != ""]
            if len(vals) > 0:
                return vals.iloc[0].upper()

    return None


def _detect_initial_balance(df: pd.DataFrame, mapping: dict[str, str]) -> float | None:
    """Tente de détecter la balance initiale depuis le CSV.

    Stratégies (par ordre de priorité) :
    1. Colonne 'initialBalance' / 'initial_balance' (FX Replay) → première valeur non-nulle
    2. Colonne 'Balance' (MT5) → Balance - Profit sur la première ligne de trade
    3. Ligne de type 'balance' (MT5) → valeur Profit de cette ligne (= dépôt)
    """
    cols_lower = {c.strip().lower(): c for c in df.columns}

    # 1. Colonne dédiée initialBalance / initial_balance
    for candidate in ("initialbalance", "initial_balance"):
        if candidate in cols_lower:
            col = cols_lower[candidate]
            val = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(val) > 0 and val.iloc[0] > 0:
                return float(val.iloc[0])

    # 2. Colonne 'balance' + colonne 'profit' (format MT5)
    if "balance" in cols_lower:
        bal_col = cols_lower["balance"]
        # Trouver la colonne profit
        profit_col = None
        for p in ("profit", "pnl", "rpnl"):
            if p in cols_lower:
                profit_col = cols_lower[p]
                break
        # Aussi chercher via le mapping
        if profit_col is None:
            pnl_csv_col = mapping.get("pnl")
            if pnl_csv_col and pnl_csv_col in df.columns:
                profit_col = pnl_csv_col

        # Chercher d'abord une ligne de type "balance" (dépôt MT5)
        type_col = None
        for t in ("type", "side"):
            if t in cols_lower:
                type_col = cols_lower[t]
                break
        if type_col is not None:
            balance_rows = df[df[type_col].astype(str).str.strip().str.lower() == "balance"]
            if len(balance_rows) > 0:
                deposit_val = pd.to_numeric(balance_rows.iloc[0].get(profit_col or bal_col), errors="coerce")
                if pd.notna(deposit_val) and deposit_val > 0:
                    return float(deposit_val)

        # Sinon : Balance - Profit sur la première ligne réelle
        if profit_col is not None:
            # Filtrer les lignes qui ne sont pas des opérations de balance
            trade_rows = df
            if type_col is not None:
                trade_rows = df[df[type_col].astype(str).str.strip().str.lower() != "balance"]
            if len(trade_rows) > 0:
                first = trade_rows.iloc[0]
                bal = pd.to_numeric(first[bal_col], errors="coerce")
                pft = pd.to_numeric(first[profit_col], errors="coerce")
                if pd.notna(bal) and pd.notna(pft) and bal > 0:
                    initial = bal - pft
                    if initial > 0:
                        return float(initial)

    return None


def parse_csv(
    file_content: bytes,
    column_mapping: dict[str, str] | None = None,
) -> tuple[list[dict], list[str], float | None, str | None]:
    """Parse un fichier CSV et retourne (trades_valides, erreurs_par_ligne, initial_balance, currency).

    Args:
        file_content: contenu brut du fichier CSV.
        column_mapping: mapping {champ_interne: nom_colonne_csv}. Si None, utilise le format FX Replay.

    Returns:
        Tuple (liste de dicts trades, liste de messages d'erreur, balance initiale détectée ou None, devise détectée ou None).
    """
    mapping = column_mapping or DEFAULT_MAPPING

    df = pd.read_csv(io.BytesIO(file_content))
    # Nettoyage espaces dans les noms de colonnes
    df.columns = df.columns.str.strip()

    # Détecter la balance initiale et la devise avant le filtrage
    detected_balance = _detect_initial_balance(df, mapping)
    detected_currency = _detect_currency(df)

    # Vérifier que les colonnes du mapping existent (sauf pips qui est optionnel)
    missing = []
    for field, csv_col in mapping.items():
        if csv_col not in df.columns and field != "pips":
            missing.append(f"Colonne '{csv_col}' manquante pour le champ '{field}'")
    if missing:
        return [], missing, detected_balance, detected_currency

    # Renommage inverse : csv_col → champ_interne
    rename_map = {csv_col: field for field, csv_col in mapping.items() if csv_col in df.columns}
    df = df.rename(columns=rename_map)

    # Filtrer les lignes de type "balance" (dépôts MT5) si présentes
    cols_lower_renamed = {c.lower(): c for c in df.columns}
    if "side" in df.columns:
        df = df[df["side"].astype(str).str.strip().str.lower() != "balance"]

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

    return trades, errors, detected_balance, detected_currency
