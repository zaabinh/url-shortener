
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL)


with engine.connect() as connection:
    print(
        "DATABASE:",
        connection.exec_driver_sql(
            "SELECT current_database(), current_schema()"
        ).fetchone(),
    )

    print(
        "URL COUNT:",
        connection.exec_driver_sql(
            "SELECT COUNT(*) FROM public.urls"
        ).scalar(),
    )
    print(
        "URL DATA:",
        connection.exec_driver_sql(
            "SELECT id, original_url, short_code FROM public.urls ORDER BY id"
        ).fetchall(),
    )

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
