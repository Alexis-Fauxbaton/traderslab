"""Auto-mapping de colonnes CSV via LLM (OpenAI GPT-4o-mini)."""

import json
import os
import httpx

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Champs attendus par TradersLab
TARGET_FIELDS = {
    "open_time": "Date/heure d'ouverture du trade",
    "close_time": "Date/heure de fermeture du trade",
    "symbol": "Symbole/paire de l'actif (ex: EURUSD, XAUUSD)",
    "side": "Sens du trade : buy/sell ou long/short",
    "entry_price": "Prix d'entrée",
    "exit_price": "Prix de sortie",
    "lot_size": "Taille de la position / quantité / volume (ex: lots forex, quantité crypto, nombre de contrats, taille du compte en usd si spot, etc.)",
    "pnl": "Profit/perte du trade en devise",
    "pips": "Résultat en pips (optionnel)",
}

SYSTEM_PROMPT = """Tu es un assistant spécialisé dans le mapping de colonnes CSV pour un journal de trading.

On te donne :
1. La liste des colonnes du fichier CSV de l'utilisateur
2. Quelques lignes d'exemple avec leurs valeurs réelles

Tu dois mapper uniquement les colonnes CSV dont la correspondance est ÉVIDENTE et CERTAINE vers les champs internes TradersLab.

Champs attendus :
- open_time : date/heure d'ouverture (valeurs = timestamps, dates)
- close_time : date/heure de fermeture (valeurs = timestamps, dates)
- symbol : symbole/paire de l'actif (valeurs = EURUSD, XAUUSD, BTC, etc.)
- side : sens du trade (valeurs = buy/sell, long/short, B/S)
- entry_price : prix d'entrée (valeurs = nombre décimal, ex: 1.2345)
- exit_price : prix de sortie (valeurs = nombre décimal, ex: 1.2356)
- lot_size : taille de la position / quantité / exposition (valeurs = nombre positif, ex: 0.1 lot, 1.5 BTC, 10 contrats, 100 shares, 500.00 USD) — IMPORTANT : une valeur notionnelle en devise (ex: "position_size_usd", "size_usd", "notional") est aussi valide ici, tant que ce n'est PAS le résultat du trade
- pnl : profit/perte en devise (valeurs = nombre avec signe, ex: 12.50, -8.20)
- pips : résultat en pips (valeurs = entier ou décimal, ex: 11.0, -8.0) — OPTIONNEL

Règles STRICTES :
- NE MAPPE PAS une colonne si tu as le moindre doute sur sa correspondance
- NE DEVINE PAS : si le nom de la colonne est ambigu et que les valeurs ne confirment pas clairement, ne mappe pas
- Une même colonne CSV ne peut être mappée qu'à UN SEUL champ interne
- Si deux champs semblent correspondre à la même colonne (ex: entry_price et exit_price vers "Price"), ne mappe aucun des deux
- Réponds UNIQUEMENT en JSON valide, sans texte autour, sans markdown
- N'inclus dans le JSON QUE les champs dont tu es certain

Exemples de cas à NE PAS mapper :
- Une colonne "Comment" ou "Note" → ne mappe pas (texte libre)
- Une colonne "Commission" → ne mappe pas sur pnl (c'est une commission, pas le PnL total)
- Une colonne "Price" seule sans précision → ne mappe ni entry_price ni exit_price
- Une colonne dont les valeurs ne correspondent pas au type attendu → ne mappe pas

Format de réponse : {"open_time": "nom_colonne_csv", "pnl": "nom_colonne_csv", ...}"""


async def auto_map_columns(
    csv_columns: list[str],
    sample_rows: list[dict],
) -> dict[str, str]:
    """Appelle GPT-4o-mini pour mapper automatiquement les colonnes CSV.

    Returns:
        Dict {champ_interne: nom_colonne_csv}
    """
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY non configurée")

    # Construire le prompt utilisateur avec exemples de valeurs par colonne
    col_samples = {}
    for col in csv_columns:
        vals = [str(row.get(col, "")) for row in sample_rows if row.get(col) not in (None, "")]
        col_samples[col] = vals[:3]

    user_prompt = (
        f"Voici les colonnes du CSV avec des exemples de valeurs réelles :\n"
    )
    for col, vals in col_samples.items():
        user_prompt += f'  "{col}": {vals}\n'
    user_prompt += "\nMappe ces colonnes vers les champs TradersLab. Ne mappe que les correspondances certaines."

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0,
                "max_tokens": 300,
            },
        )
        resp.raise_for_status()

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    # Parser le JSON (parfois entouré de ```json ... ```)
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()

    mapping = json.loads(content)

    # Valider : ne garder que les champs connus avec des colonnes existantes
    valid = {}
    for field, col in mapping.items():
        if field in TARGET_FIELDS and col in csv_columns:
            valid[field] = col

    return valid
