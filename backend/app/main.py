from datetime import datetime, timezone
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.db.database import get_db, engine, Base
from app.db.models import URL
from app.api.urls import router as urls_router
from app.core.config import settings

# Khởi tạo bảng DB nếu chưa có (an toàn khi chạy local/test)
# Base.metadata.create_all(bind=engine)

app = FastAPI(title="URL Shortener API")

# 1. Khôi phục CORS Middleware cho local Next.js (:3000) -> FastAPI (:8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(urls_router)

# 2. Health check tối ưu: Không query bừa bãi hoặc in toàn bộ URL gây crash khi chưa có bảng
@app.get("/app/health")
def health_check():
    return {"status": "healthy"}

# 3. Endpoint Redirect /{short_code}
@app.get("/{short_code}")
def redirect_to_url(short_code: str, db: Session = Depends(get_db)):
    db_url = db.query(URL).filter(URL.short_code == short_code).first()
    
    if not db_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Short URL not found")
        
    now = datetime.now(timezone.utc)
    
    # Kiểm tra hết hạn -> Trả về 410 Gone (sử dụng expired_at theo đúng model thực tế)
    if db_url.expired_at and db_url.expired_at <= now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="URL has expired")
        
    # Atomic update click_count tránh lost update khi truy cập đồng thời
    db.query(URL).filter(URL.short_code == short_code).update(
        {"click_count": URL.click_count + 1}
    )
    db.commit()
    
    # Trả về mã 302 Found đúng spec
    return RedirectResponse(url=db_url.original_url, status_code=status.HTTP_302_FOUND)