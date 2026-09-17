import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.firebase import initialize_firebase  # FCM push only
from app.core.logging import get_logger, setup_logging
from app.core.mqtt import mqtt_client
from app.core.sse import sse_manager
from app.db.session import create_all_tables
from app.modules.timbangan.mqtt_handler import TimbanganMQTTHandler
from app.modules.timbangan.scheduler import timbangan_scheduler
from app.modules.timbangan.service import TimbanganService
from app.modules.smartbuddy.mqtt_handler import SmartBuddyMQTTHandler, is_smartbuddy_topic
from app.modules.smartbuddy.scheduler import smartbuddy_scheduler
from app.modules.smartbuddy.service import SmartBuddyService
from app.modules.notifications.scheduler import notification_scheduler

# Routers
from app.modules.timbangan.router import router as timbangan_router
from app.modules.smartbuddy.router import router as smartbuddy_router
from app.modules.users.router import router as users_router
from app.modules.locations.router import router as locations_router
from app.modules.notifications.router import router as notifications_router
from app.modules.asset_units.router import router as asset_units_router
from app.api.auth import router as auth_router
from app.api.devices import router as devices_router
from app.api.provisioning import router as provisioning_router
from app.api.provisioning_smartbuddy import router as provisioning_smartbuddy_router
from app.api.system import router as system_router

setup_logging(
    level="DEBUG" if settings.app_debug else "INFO",
    env=settings.app_env,
)
logger = get_logger(__name__)


# ==================== MQTT ====================

def on_mqtt_connect(client, userdata, flags, rc):
    if rc != 0:
        return

    topics = [
        ("weight/#", settings.mqtt_qos),
        ("status/#", settings.mqtt_qos),
        (f"{settings.mqtt_kapitmas_prefix}/timbangan/#", settings.mqtt_qos),
        (f"{settings.mqtt_kapitmas_prefix}/smartbuddy/#", settings.mqtt_qos),
    ]

    client.subscribe(topics)
    logger.info("MQTT subscribed:")
    logger.info("  Legacy     : weight/# and status/#")
    logger.info(f"  Timbangan  : {settings.mqtt_kapitmas_prefix}/timbangan/#")
    logger.info(f"  SmartBuddy : {settings.mqtt_kapitmas_prefix}/smartbuddy/#")


def on_mqtt_message(client, userdata, msg):
    topic = msg.topic

    if (
        topic.startswith("weight/") or
        topic.startswith("status/") or
        topic.startswith(f"{settings.mqtt_kapitmas_prefix}/timbangan/")
    ):
        TimbanganMQTTHandler.handle(client, userdata, msg)
    elif is_smartbuddy_topic(topic, settings.mqtt_kapitmas_prefix):
        SmartBuddyMQTTHandler.handle(client, userdata, msg)
    else:
        logger.debug(f"Unknown topic: {topic}")


# ==================== LIFESPAN ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Kapitmas IoT Backend v3.0.0...")

    # 1. Firebase
    initialize_firebase()

    # 2. Create tables
    await create_all_tables()

    # 3. Ensure directories
    TimbanganService.ensure_dirs()
    SmartBuddyService.ensure_firmware_dir()

    # 4. MQTT
    mqtt_client.initialize(
        on_connect=on_mqtt_connect,
        on_message=on_mqtt_message
    )

    # 5. Schedulers
    asyncio.create_task(timbangan_scheduler.start())
    asyncio.create_task(smartbuddy_scheduler.start())
    asyncio.create_task(notification_scheduler.start())

    logger.info("Kapitmas IoT Backend ready")
    logger.info(f"  Docs: http://{settings.app_host}:{settings.app_port}/docs")

    yield

    logger.info("Shutting down...")
    timbangan_scheduler.stop()
    smartbuddy_scheduler.stop()
    notification_scheduler.stop()
    mqtt_client.disconnect()
    logger.info("Shutdown complete")


# ==================== APP ====================

app = FastAPI(
    title="Kapitmas IoT Platform",
    description="Unified IoT Backend — Timbangan & more",
    version="3.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router,                    prefix="/api")
app.include_router(timbangan_router,               prefix="/api")
app.include_router(smartbuddy_router,              prefix="/api")
app.include_router(users_router,                   prefix="/api")
app.include_router(locations_router,               prefix="/api")
app.include_router(notifications_router,           prefix="/api")
app.include_router(asset_units_router,             prefix="/api")
app.include_router(devices_router,                 prefix="/api")
app.include_router(provisioning_router,            prefix="/api")
app.include_router(provisioning_smartbuddy_router, prefix="/api")
app.include_router(system_router,                  prefix="/api")


@app.get("/")
def root():
    return {
        "service": "Kapitmas IoT Platform",
        "version": "3.0.0",
        "docs":    "/docs"
    }


@app.get("/health")
def health():
    return {
        "status":          "healthy",
        "mqtt_connected":  mqtt_client.connected,
        "sse_subscribers": sse_manager.subscriber_count
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_debug
    )
