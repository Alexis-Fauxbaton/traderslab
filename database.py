import os
import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./traderslab.db")

# SQLite needs check_same_thread=False; PostgreSQL doesn't support this arg
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dialect helpers
_IS_SQLITE = DATABASE_URL.startswith("sqlite")
_IS_POSTGRES = DATABASE_URL.startswith("postgresql") or DATABASE_URL.startswith("postgres")


def _col_type(sqlite_type: str, pg_type: str) -> str:
    return pg_type if _IS_POSTGRES else sqlite_type


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_migrations():
    """Apply lightweight migrations for existing databases (new columns + indexes)."""
    insp = inspect(engine)

    _add_column_if_missing(insp, "variants", "aggregate_metrics",
                           _col_type("TEXT", "TEXT"))
    _add_column_if_missing(insp, "strategies", "aggregate_metrics",
                           _col_type("TEXT", "TEXT"))
    _add_column_if_missing(insp, "runs", "initial_balance",
                           _col_type("FLOAT DEFAULT 10000.0", "DOUBLE PRECISION DEFAULT 10000.0"))
    _add_column_if_missing(insp, "runs", "currency",
                           _col_type("TEXT DEFAULT 'USD'", "TEXT DEFAULT 'USD'"))
    _add_column_if_missing(insp, "runs", "currency_source",
                           _col_type("TEXT DEFAULT 'detected'", "TEXT DEFAULT 'detected'"))
    _add_column_if_missing(insp, "strategies", "user_id",
                           _col_type("TEXT", "TEXT"))
    _add_column_if_missing(insp, "users", "auth_provider",
                           _col_type("TEXT DEFAULT 'local'", "TEXT DEFAULT 'local'"))
    _add_column_if_missing(insp, "users", "provider_id",
                           _col_type("TEXT", "TEXT"))
    _add_column_if_missing(insp, "runs", "timeframe",
                           _col_type("TEXT", "TEXT"))
    _add_column_if_missing(insp, "runs", "pairs",
                           _col_type("TEXT", "TEXT"))

    # Migrate market → pairs, timeframe → timeframes (JSON arrays)
    _migrate_strategy_pairs_timeframes(insp)

    _create_index_if_missing("ix_trades_run_id", "trades", "run_id")
    _create_index_if_missing("ix_trades_close_time", "trades", "close_time")
    _create_index_if_missing("ix_runs_variant_id", "runs", "variant_id")
    _create_index_if_missing("ix_variants_strategy_id", "variants", "strategy_id")
    _create_index_if_missing("ix_variants_parent_variant_id", "variants", "parent_variant_id")


def _add_column_if_missing(insp, table: str, column: str, col_type: str):
    if not insp.has_table(table):
        return
    existing = {c["name"] for c in insp.get_columns(table)}
    if column not in existing:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
        logger.info("Migration: added column %s.%s", table, column)


def _create_index_if_missing(index_name: str, table: str, column: str):
    """Create index — dialect-aware (IF NOT EXISTS not supported by all PG versions)."""
    if _IS_POSTGRES:
        with engine.begin() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_indexes WHERE indexname = :name"),
                {"name": index_name},
            ).fetchone()
            if not exists:
                conn.execute(text(f"CREATE INDEX {index_name} ON {table} ({column})"))
    else:
        with engine.begin() as conn:
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})"))
    logger.info("Migration: ensured index %s on %s(%s)", index_name, table, column)


def _migrate_strategy_pairs_timeframes(insp):
    """Migrate old market/timeframe string columns to pairs/timeframes JSON arrays."""
    import json

    if not insp.has_table("strategies"):
        return

    existing = {c["name"] for c in insp.get_columns("strategies")}

    # Add new columns if missing
    if "pairs" not in existing:
        with engine.begin() as conn:
            default = "DEFAULT '[]'" if _IS_SQLITE else "DEFAULT '[]'::text"
            conn.execute(text(f"ALTER TABLE strategies ADD COLUMN pairs TEXT {default}"))
        logger.info("Migration: added column strategies.pairs")

    if "timeframes" not in existing:
        with engine.begin() as conn:
            default = "DEFAULT '[]'" if _IS_SQLITE else "DEFAULT '[]'::text"
            conn.execute(text(f"ALTER TABLE strategies ADD COLUMN timeframes TEXT {default}"))
        logger.info("Migration: added column strategies.timeframes")

    # Migrate data from old columns if they exist
    if "market" in existing and "pairs" in existing:
        with engine.begin() as conn:
            rows = conn.execute(
                text("SELECT id, market FROM strategies WHERE market IS NOT NULL AND (pairs IS NULL OR pairs = '[]')")
            ).fetchall()
            for row in rows:
                pairs_json = json.dumps([row[1]] if row[1] else [])
                conn.execute(
                    text("UPDATE strategies SET pairs = :pairs WHERE id = :id"),
                    {"pairs": pairs_json, "id": row[0]},
                )
            if rows:
                logger.info("Migration: migrated %d strategies market → pairs", len(rows))

    if "timeframe" in existing and "timeframes" in existing:
        with engine.begin() as conn:
            rows = conn.execute(
                text("SELECT id, timeframe FROM strategies WHERE timeframe IS NOT NULL AND (timeframes IS NULL OR timeframes = '[]')")
            ).fetchall()
            for row in rows:
                tfs_json = json.dumps([row[1]] if row[1] else [])
                conn.execute(
                    text("UPDATE strategies SET timeframes = :tfs WHERE id = :id"),
                    {"tfs": tfs_json, "id": row[0]},
                )
            if rows:
                logger.info("Migration: migrated %d strategies timeframe → timeframes", len(rows))

    # Drop old columns now that data has been migrated
    existing = {c["name"] for c in insp.get_columns("strategies")}
    for old_col in ("market", "timeframe"):
        if old_col in existing:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE strategies DROP COLUMN {old_col}"))
            logger.info("Migration: dropped old column strategies.%s", old_col)
