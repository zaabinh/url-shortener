from datetime import datetime, timezone
from pydantic import BaseModel, HttpUrl, field_validator, ConfigDict, computed_field
import uuid
import re

MAX_URL_LENGTH = 2048
RESERVED_SHORT_CODES = {"api", "app", "docs", "redoc"}

class UrlCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    original_url: HttpUrl
    expires_at: datetime | None = None
    short_code: str | None = None

    @field_validator("short_code", mode="before")
    @classmethod
    def validate_short_code(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Short code must be a string")
        code = value.strip()
        if not code:
            return None
        if not re.fullmatch(r"[A-Za-z0-9]{1,32}", code):
            raise ValueError("Use 1-32 ASCII letters or digits")
        if code.lower() in RESERVED_SHORT_CODES:
            raise ValueError("This short code is reserved")
        return code

    @field_validator("original_url")
    @classmethod
    def limit_length(cls, value: HttpUrl) -> HttpUrl:
        if len(str(value)) > MAX_URL_LENGTH:
            raise ValueError(f"URL must be at most {MAX_URL_LENGTH} characters")
        return value

    @field_validator("expires_at")
    @classmethod
    def validate_expires_at(cls, value: datetime | None) -> datetime | None:
        if value is not None:
            if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
                raise ValueError("Expiration date must be timezone-aware")
            now = datetime.now(timezone.utc)
            if value <= now:
                raise ValueError("Expiration date must be in the future")
            return value.astimezone(timezone.utc)
        return value

class UrlResponse(BaseModel):
    id: uuid.UUID
    original_url: str
    short_code: str
    click_count: int
    created_at: datetime | None = None
    expires_at: datetime
    @computed_field
    @property
    def active(self) -> bool:
        expiration = self.expires_at
        if expiration.tzinfo is None:
            expiration = expiration.replace(tzinfo=timezone.utc)
        return expiration > datetime.now(timezone.utc)
      
    model_config = ConfigDict(from_attributes=True)
