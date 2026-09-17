from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


class Settings(BaseSettings):

    # ==================== DATABASE ====================
    database_url: str = Field(
        default="postgresql+asyncpg://kapitmas:password@localhost:5432/kapitmas_iot",
        alias="DATABASE_URL"
    )

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace(
            "postgresql+asyncpg://",
            "postgresql+psycopg2://"
        )

    # ==================== MQTT ====================
    mqtt_broker_host: str = Field(default="localhost",  alias="MQTT_BROKER_HOST")
    mqtt_broker_port: int = Field(default=1883,         alias="MQTT_BROKER_PORT")
    mqtt_username:    str = Field(default="",           alias="MQTT_USERNAME")
    mqtt_password:    str = Field(default="",           alias="MQTT_PASSWORD")
    mqtt_keepalive:   int = Field(default=60,           alias="MQTT_KEEPALIVE")
    mqtt_qos:         int = Field(default=1,            alias="MQTT_QOS")

    # MQTT Topics
    # Legacy topics — untuk ESP32 existing selama transisi OTA
    mqtt_legacy_weight_prefix: str = "weight"
    mqtt_legacy_status_prefix: str = "status"
    # New topic structure
    mqtt_kapitmas_prefix: str = "kapitmas"

    # ==================== APP ====================
    app_env:   str  = Field(default="development", alias="APP_ENV")
    app_host:  str  = Field(default="0.0.0.0",     alias="APP_HOST")
    app_port:  int  = Field(default=8000,           alias="APP_PORT")
    app_debug: bool = Field(default=True,           alias="APP_DEBUG")

    # ==================== CORS ====================
    cors_origins: str = Field(
        default="http://localhost:5173,http://localhost:3000",
        alias="CORS_ORIGINS"
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    # ==================== AUTH (JWT) ====================
    jwt_secret:       str = Field(default="change-me-in-production", alias="JWT_SECRET")
    jwt_expire_hours: int = Field(default=8,                          alias="JWT_EXPIRE_HOURS")
    odoo_login_url:   str = Field(default="https://odoo.example.com/apps/login", alias="ODOO_LOGIN_URL")
    admin_odoo_uids:  str = Field(default="",                         alias="ADMIN_ODOO_UIDS")
    # Hardcoded admin — bypass Odoo, langsung dapat role admin
    admin_username:   str = Field(default="", alias="ADMIN_USERNAME")
    admin_password:   str = Field(default="", alias="ADMIN_PASSWORD")
    # API key untuk integrasi tanpa login (mis. Odoo)
    odoo_api_key:     str = Field(default="", alias="ODOO_API_KEY")

    # ==================== FIREBASE (FCM push only) ====================
    firebase_service_account_path: str = Field(default="secrets/firebase-service-account.json", alias="FIREBASE_SERVICE_ACCOUNT_PATH")

    # ==================== DEVICES ====================
    device_offline_timeout:        int = Field(default=720, alias="DEVICE_OFFLINE_TIMEOUT")   # 12 menit
    device_event_retention_days:   int = Field(default=30,  alias="DEVICE_EVENT_RETENTION_DAYS")

    # ==================== TIMBANGAN ====================
    timbangan_status_timeout:      int = Field(default=360,      alias="TIMBANGAN_STATUS_TIMEOUT")
    timbangan_backup_time_hour:    int = Field(default=23,        alias="TIMBANGAN_BACKUP_TIME_HOUR")
    timbangan_backup_time_minute:  int = Field(default=0,         alias="TIMBANGAN_BACKUP_TIME_MINUTE")
    timbangan_log_retention_days:  int = Field(default=14,        alias="TIMBANGAN_LOG_RETENTION_DAYS")
    timbangan_backup_retention_days: int = Field(default=30,      alias="TIMBANGAN_BACKUP_RETENTION_DAYS")
    timbangan_data_dir:            str = Field(default="data/timbangan",          alias="TIMBANGAN_DATA_DIR")
    timbangan_backup_dir:          str = Field(default="data/timbangan/backups",  alias="TIMBANGAN_BACKUP_DIR")
    timbangan_firmware_dir:        str = Field(default="data/firmware/timbangan", alias="TIMBANGAN_FIRMWARE_DIR")
    timbangan_ota_base_url:        str = Field(default="http://localhost:8000",   alias="TIMBANGAN_OTA_BASE_URL")
    timbangan_ota_download_secret: str = Field(default="kapitmas-ota-secret-key", alias="TIMBANGAN_OTA_DOWNLOAD_SECRET")
    timbangan_device_menu_password: str = Field(default="admin123", alias="TIMBANGAN_DEVICE_MENU_PASSWORD")

    # ==================== SMARTBUDDY ====================
    smartbuddy_firmware_dir:        str = Field(default="data/firmware/smartbuddy", alias="SMARTBUDDY_FIRMWARE_DIR")
    smartbuddy_ota_base_url:        str = Field(default="http://localhost:8000",     alias="SMARTBUDDY_OTA_BASE_URL")
    smartbuddy_ota_download_secret: str = Field(default="kapitmas-sb-ota-secret",   alias="SMARTBUDDY_OTA_DOWNLOAD_SECRET")

    class Config:
        env_file         = ".env"
        env_file_encoding = "utf-8"
        populate_by_name = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()