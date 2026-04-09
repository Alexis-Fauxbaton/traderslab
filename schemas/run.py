from pydantic import BaseModel
from datetime import date, datetime
from typing import Any


class RunOut(BaseModel):
    id: str
    variant_id: str
    label: str
    type: str
    start_date: date | None
    end_date: date | None
    imported_at: datetime
    initial_balance: float | None = 10000.0
    currency: str | None = "USD"
    currency_source: str | None = "detected"
    timeframe: str | None = None
    pairs: list[str] | None = None
    metrics: dict[str, Any] | None

    model_config = {"from_attributes": True}


class RunDetail(RunOut):
    """Run avec ses trades inclus."""
    trades: list["TradeOut"] = []


class RunImportResponse(BaseModel):
    run_id: str
    nb_trades_imported: int
    warnings: list[str]
    metrics: dict[str, Any]
    initial_balance: float
    currency: str


class TradesPaginated(BaseModel):
    items: list["TradeOut"] = []
    total: int
    page: int
    per_page: int
    pages: int


from schemas.trade import TradeOut  # noqa: E402

RunDetail.model_rebuild()
TradesPaginated.model_rebuild()
