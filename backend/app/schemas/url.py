from datetime import datetime, timezone
from pydantic import BaseModel, HttpUrl, field_validator

MAX_URL_LENGTH = 2048

class UrlCreate(BaseModel):
    original_url: HttpUrl
    expired_at: datetime | None = None

    @field_validator("original_url")
    @classmethod
    def limit_length(cls, value: HttpUrl) -> HttpUrl:
        if len(str(value)) > MAX_URL_LENGTH:
            raise ValueError(f"URL must be at most {MAX_URL_LENGTH} characters")
        return value

    @field_validator("expired_at")
    @classmethod
    def validate_expired_at(cls, value: datetime | None) -> datetime | None:
        if value is not None:
            if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
                raise ValueError("Expiration date must be timezone-aware")
            now = datetime.now(timezone.utc)
            if value <= now:
                raise ValueError("Expiration date must be in the future")
            return value.astimezone(timezone.utc)
        return value

class UrlResponse(BaseModel):
    short_code: str
    short_url: str
    original_url: str
    click_count: int
    created_at: datetime
    expired_at: datetime
