from pydantic import BaseModel
from datetime import datetime


class MT5ConnectionCreate(BaseModel):
    variant_id: str
    mt5_login: str
    mt5_server: str
    investor_password: str
    platform: str = "mt5"


class MT5ConnectionRetry(BaseModel):
    investor_password: str | None = None
    mt5_login: str | None = None
    mt5_server: str | None = None
    platform: str | None = None


class MT5ConnectionOut(BaseModel):
    id: str
    user_id: str
    variant_id: str
    run_id: str | None = None
    metaapi_account_id: str | None = None
    mt5_login: str
    mt5_server: str
    platform: str
    status: str
    currency: str | None = None
    initial_balance: float | None = None
    last_sync_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MT5SyncResult(BaseModel):
    trades_added: int
    total_trades: int
    last_sync_at: datetime
