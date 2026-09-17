from datetime import datetime, timezone, timedelta

from jose import JWTError, jwt

from app.config import settings

ALGORITHM = "HS256"


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=ALGORITHM)


def verify_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError:
        raise ValueError("Token tidak valid atau sudah expired")
