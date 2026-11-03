from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import URLModel
from app.schemas.url import URLCreate, URLResponse
from app.core.config import settings
from app.services.url_service import create_short_url

router = APIRouter(prefix="/api/urls", tags=["urls"])


@router.post("", response_model=URLResponse, status_code=status.HTTP_201_CREATED)
def create_url(payload: URLCreate, db: Session = Depends(get_db)):
    """Tạo mới một URL rút gọn và trả về short_url hoàn chỉnh."""
    db_url = create_short_url(db, payload, settings.BASE_URL)
    
    # Chuyển đổi sang schema response và gán đầy đủ short_url
    response_data = URLResponse.model_validate(db_url)
    response_data.short_url = f"{settings.BASE_URL}/{db_url.short_code}"
    
    return response_data


@router.get("", response_model=List[URLResponse])
def list_urls(db: Session = Depends(get_db)):
    """Lấy danh sách tất cả URL, tự động cập nhật trạng thái active = False nếu đã quá hạn."""
    urls = db.query(URLModel).all()
    now = datetime.now(timezone.utc)

    result = []
    for item in urls:
        # Tự động đánh dấu active = False nếu đã hết hạn
        if item.expired_at and item.expired_at <= now and item.active:
            item.active = False
            db.commit()

        data = URLResponse.model_validate(item)
        # Gán short_url chuẩn cho từng bản ghi trong danh sách
        data.short_url = f"{settings.BASE_URL}/{item.short_code}"
        result.append(data)

    return result


@router.delete("/{short_code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_url(short_code: str, db: Session = Depends(get_db)):
    """Xóa URL theo short_code khớp với yêu cầu từ Frontend."""
    db_url = db.query(URLModel).filter(URLModel.short_code == short_code).first()
    
    if not db_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="URL not found"
        )

    db.delete(db_url)
    db.commit()
    return None