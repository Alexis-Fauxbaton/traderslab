from pydantic import BaseModel, EmailStr
from datetime import datetime


class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    username: str
    is_active: bool
    created_at: datetime
    currency: str
    auth_provider: str = "local"

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    currency: str | None = None


class OAuthLogin(BaseModel):
    id_token: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
