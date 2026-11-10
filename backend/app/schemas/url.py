from datetime import datetime, timezone
from pydantic import (
    BaseModel,
    ConfigDict,
    HttpUrl,
    field_validator,
)


class URLCreate(BaseModel):
    original_url: HttpUrl
    expired_at: datetime

    @field_validator("expired_at")
    @classmethod
    def validate_expired_at(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expired_at must include timezone")

        if value <= datetime.now(timezone.utc):
            raise ValueError("expired_at must be in the future")

        return value.astimezone(timezone.utc)


class URLResponse(BaseModel):
    id: int
    original_url: str
    short_code: str
    short_url: str
    click_count: int
    created_at: datetime
    expired_at: datetime
    active: bool = True

    model_config = ConfigDict(from_attributes=True)