from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Xác định đường dẫn tới file .env ở thư mục gốc của dự án
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    app_name: str = "URL Shortener API"

    DATABASE_URL: str
    BASE_URL: str = "http://127.0.0.1:8000"

    # Danh sách các origin được phép cấu hình qua biến môi trường (phân cách bằng dấu phẩy)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        """Tự động chuyển chuỗi cors_origins thành list các domain sạch."""
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        extra="ignore",
    )


settings = Settings()