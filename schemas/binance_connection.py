from pydantic import BaseModel
from datetime import date, datetime


class BinanceConnectionCreate(BaseModel):
    variant_id: str
    api_key: str
    api_secret: str
    account_type: str = "futures_usdm"  # futures_usdm | spot
    sync_from: date | None = None
    sync_to: date | None = None


class BinanceConnectionOut(BaseModel):
    id: str
    user_id: str
    variant_id: str
    run_id: str | None = None
    account_type: str
    status: str
    currency: str | None = None
    initial_balance: float | None = None
    last_sync_at: datetime | None = None
    error_message: str | None = None
    sync_from: date | None = None
    sync_to: date | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
