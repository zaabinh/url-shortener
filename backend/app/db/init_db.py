from app.db.database import Base, engine
from app.db import models

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    print("Database schema ready")