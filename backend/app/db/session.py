from app.core.logging import get_logger
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import settings

logger = get_logger(__name__)

# ==================== ASYNC — untuk FastAPI endpoints ====================
async_engine = create_async_engine(
    settings.database_url,
    echo=settings.app_debug,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# ==================== SYNC — untuk MQTT handler dan scheduler ====================
# MQTT callback berjalan di thread terpisah, tidak bisa async
sync_engine = create_engine(
    settings.sync_database_url,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
    autocommit=False,
    autoflush=False,
)


async def get_async_db() -> AsyncSession:
    """Async DB dependency untuk FastAPI endpoints"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def get_sync_db() -> Session:
    """Sync DB dependency untuk endpoints yang tidak butuh async"""
    db = SyncSessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class SyncDBContext:
    """
    Context manager untuk sync DB session.
    Dipakai di MQTT handler dan scheduler.

    Usage:
        with SyncDBContext() as db:
            service.do_something(db)
    """
    def __enter__(self) -> Session:
        self.db = SyncSessionLocal()
        return self.db

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.db.rollback()
        self.db.close()


async def create_all_tables():
    """Buat semua tabel — dipanggil saat startup"""
    from app.db.base import Base
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified")