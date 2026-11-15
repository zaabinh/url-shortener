from datetime import datetime, timezone
from pydantic import BaseModel, HttpUrl, field_validator, ConfigDict, computed_field
import uuid

MAX_URL_LENGTH = 2048

class UrlCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    original_url: HttpUrl
    expires_at: datetime | None = None

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
