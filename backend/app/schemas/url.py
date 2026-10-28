from datetime import datetime

from pydantic import BaseModel, ConfigDict, HttpUrl


class URLCreate(BaseModel):
    original_url: HttpUrl


class URLResponse(BaseModel):
    id: int
    original_url: str
    short_code: str
    short_url: str
    click_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)