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


from schemas.trade import TradeOut  # noqa: E402

RunDetail.model_rebuild()
