"""Custom JWT auth. No Supabase Auth anywhere.

- POST /auth/anonymous {device_id} -> JWT {sub=user_id, verified:false}, trust 0.5
- POST /auth/send-code {phone|email} -> 6-digit code, 10min expiry (Redis, else memory)
- POST /auth/verify {phone|email, code} -> links user, JWT {verified:true}, trust 0.8
- Staff: POST /admin/login {email, password} -> JWT {sub=staff_id, role}
"""

import random
import time
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Staff, User

pwd_ctx = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)
_mem_codes: dict[str, tuple[str, float]] = {}  # key -> (code, expires_ts)

TRUST_ANON = 0.5
TRUST_VERIFIED = 0.8


def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw)


def verify_password(pw: str, h: str) -> bool:
    return pwd_ctx.verify(pw, h)


def create_token(sub: str, extra: dict | None = None) -> str:
    payload = {
        "sub": str(sub),
        "exp": datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MIN),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="invalid token")


def _redis():
    try:
        import redis as redis_lib

        r = redis_lib.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        return r
    except Exception:
        return None


def store_code(key: str, code: str, ttl: int = 600) -> None:
    r = _redis()
    if r is not None:
        try:
            r.setex(f"otp:{key}", ttl, code)
            return
        except Exception:
            pass
    _mem_codes[key] = (code, time.time() + ttl)


def check_code(key: str, code: str) -> bool:
    r = _redis()
    if r is not None:
        try:
            v = r.get(f"otp:{key}")
            if v is None:
                return _check_mem(key, code)
            ok = v.decode() == code
            if ok:
                r.delete(f"otp:{key}")
            return ok
        except Exception:
            pass
    return _check_mem(key, code)


def _check_mem(key: str, code: str) -> bool:
    v = _mem_codes.get(key)
    if not v:
        return False
    saved, exp = v
    if time.time() > exp:
        _mem_codes.pop(key, None)
        return False
    if saved == code:
        _mem_codes.pop(key, None)
        return True
    return False


def new_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def current_token(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if creds is None:
        raise HTTPException(status_code=401, detail="missing bearer token")
    return decode_token(creds.credentials)


def get_current_user(
    token: dict = Depends(current_token), db: Session = Depends(get_db)
) -> User:
    if "role" in token:
        raise HTTPException(status_code=403, detail="citizen only")
    u = db.get(User, token.get("sub"))
    if u is None:
        raise HTTPException(status_code=401, detail="unknown user")
    if getattr(u, "banned", False):
        raise HTTPException(status_code=403, detail="account banned")
    return u


def get_verified_current_user(
    token: dict = Depends(current_token), db: Session = Depends(get_db)
) -> User:
    """Require a citizen JWT whose account has completed verification."""
    if "role" in token:
        raise HTTPException(status_code=403, detail="citizen only")
    u = db.get(User, token.get("sub"))
    if u is None:
        raise HTTPException(status_code=401, detail="unknown user")
    if getattr(u, "banned", False):
        raise HTTPException(status_code=403, detail="account banned")
    if not u.verified:
        raise HTTPException(status_code=403, detail="verify your account first")
    return u


def get_current_staff(
    token: dict = Depends(current_token), db: Session = Depends(get_db)
) -> Staff:
    if "role" not in token:
        raise HTTPException(status_code=403, detail="staff only")
    s = db.get(Staff, token.get("sub"))
    if s is None:
        raise HTTPException(status_code=401, detail="unknown staff")
    return s
