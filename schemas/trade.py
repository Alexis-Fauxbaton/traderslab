from pydantic import BaseModel
from datetime import datetime


class TradeOut(BaseModel):
    id: str
    run_id: str
    open_time: datetime
    close_time: datetime
    symbol: str
    side: str
    entry_price: float
    exit_price: float
    lot_size: float
    pnl: float
    pips: float | None

    model_config = {"from_attributes": True}
