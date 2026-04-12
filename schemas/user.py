from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
import re


def _validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Le mot de passe doit contenir au moins 8 caractères")
    if not re.search(r"[A-Z]", v):
        raise ValueError("Le mot de passe doit contenir au moins une majuscule")
    if not re.search(r"[a-z]", v):
        raise ValueError("Le mot de passe doit contenir au moins une minuscule")
    if not re.search(r"\d", v):
        raise ValueError("Le mot de passe doit contenir au moins un chiffre")
    return v


class UserRegister(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)

    @classmethod
    def model_validate(cls, *args, **kwargs):
        obj = super().model_validate(*args, **kwargs)
        _validate_password(obj.password)
        return obj

    def model_post_init(self, __context) -> None:
        _validate_password(self.password)


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
