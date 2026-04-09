import os
from datetime import datetime, timedelta

import bcrypt
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from database import get_db
from models.user import User

SECRET_KEY = os.getenv("SECRET_KEY", "traderslab-dev-secret-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

security = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": user_id, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = creds.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def verify_google_id_token(token: str) -> dict:
    """Verify a Google Sign-In id_token and return user info dict."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(400, "Google OAuth not configured on this server")
    try:
        info = google_id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
        if info["iss"] not in ("accounts.google.com", "https://accounts.google.com"):
            raise ValueError("Invalid issuer")
        return {"email": info["email"], "name": info.get("name", ""), "sub": info["sub"]}
    except ValueError:
        raise HTTPException(401, "Invalid Google token")


def verify_apple_id_token(token: str) -> dict:
    """Decode an Apple Sign-In id_token (RS256, public key from Apple)."""
    try:
        header = jwt.get_unverified_header(token)
        # Fetch Apple public keys
        import urllib.request, json
        resp = urllib.request.urlopen("https://appleid.apple.com/auth/keys")
        apple_keys = json.loads(resp.read())
        from jose import jwk
        key = None
        for k in apple_keys["keys"]:
            if k["kid"] == header["kid"]:
                key = jwk.construct(k)
                break
        if not key:
            raise ValueError("Apple key not found")
        payload = jwt.decode(token, key, algorithms=["RS256"], audience=os.getenv("APPLE_CLIENT_ID", ""))
        return {"email": payload["email"], "name": payload.get("name", ""), "sub": payload["sub"]}
    except (JWTError, ValueError, KeyError):
        raise HTTPException(401, "Invalid Apple token")
