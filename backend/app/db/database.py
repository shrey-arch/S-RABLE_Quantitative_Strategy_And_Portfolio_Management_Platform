# backend/app/db/database.py

from sqlalchemy import create_engine

from app.config import settings

engine = create_engine(
    settings.database_url,
    echo=settings.debug,      # Print SQL queries in development
    future=True
)