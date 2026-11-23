from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.schemas.auth import UserCreate
from app.security import hash_password, verify_password


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def register_user(db: Session, user_data: UserCreate) -> User:
    user = User(
        email=user_data.email.lower(),
        password_hash=hash_password(user_data.password),
    )
    db.add(user)
    db.flush()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(db, email.lower())
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user
