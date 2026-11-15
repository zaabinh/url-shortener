
from sqlalchemy import Column, DateTime, Integer, String, func, UUID

from app.db.database import Base
import uuid


class Url(Base):
    __tablename__ = "urls"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

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
        nullable=True,
    )

    expires_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )
