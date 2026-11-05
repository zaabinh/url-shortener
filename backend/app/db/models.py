
from sqlalchemy import Column, DateTime, Integer, String, func

from app.db.database import Base


class URL(Base):
    __tablename__ = "urls"

    id = Column(Integer, primary_key=True, index=True)

    original_url = Column(
        String(2048),
        nullable=False,
    )

    short_code = Column(
        String(32),
        unique=True,
        index=True,
        nullable=False,
    )

    click_count = Column(
        Integer,
        default=0,
        nullable=False,
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    expired_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )
