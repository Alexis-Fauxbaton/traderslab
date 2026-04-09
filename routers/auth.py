from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.user import UserRegister, UserLogin, UserUpdate, UserOut, Token, OAuthLogin
from services.auth import hash_password, verify_password, create_access_token, get_current_user, verify_google_id_token, verify_apple_id_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(body: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already taken")

    user = User(
        email=body.email,
        username=body.username,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=Token)
def login(body: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


def _oauth_login_or_register(provider: str, info: dict, db: Session) -> Token:
    """Shared logic for Google/Apple OAuth: find or create user, return JWT."""
    # Check if user already linked via provider_id
    user = db.query(User).filter(User.auth_provider == provider, User.provider_id == info["sub"]).first()
    if not user:
        # Check if email already exists (link accounts)
        user = db.query(User).filter(User.email == info["email"]).first()
        if user:
            # Link existing account to this provider
            user.auth_provider = provider
            user.provider_id = info["sub"]
            db.commit()
            db.refresh(user)
        else:
            # Create new user
            base_username = info.get("name", info["email"].split("@")[0]).replace(" ", "_").lower()
            username = base_username
            counter = 1
            while db.query(User).filter(User.username == username).first():
                username = f"{base_username}{counter}"
                counter += 1
            user = User(
                email=info["email"],
                username=username,
                auth_provider=provider,
                provider_id=info["sub"],
            )
            db.add(user)
            db.commit()
            db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/google", response_model=Token)
def google_login(body: OAuthLogin, db: Session = Depends(get_db)):
    info = verify_google_id_token(body.id_token)
    return _oauth_login_or_register("google", info, db)


@router.post("/apple", response_model=Token)
def apple_login(body: OAuthLogin, db: Session = Depends(get_db)):
    info = verify_apple_id_token(body.id_token)
    return _oauth_login_or_register("apple", info, db)
