from app.core.logging import get_logger
import threading
import paho.mqtt.client as mqtt

from app.config import settings

logger = get_logger(__name__)


class MQTTClient:
    """
    Robust MQTT client singleton dengan auto-reconnect.
    """

    _instance = None
    _lock     = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._ready = False
        return cls._instance

    def __init__(self):
        if self._ready:
            return
        self._client:     mqtt.Client | None = None
        self._connected:  bool               = False
        self._on_connect  = None
        self._on_message  = None
        self._ready       = True

    def initialize(self, on_connect, on_message):
        if self._client is not None:
            return

        self._on_connect = on_connect
        self._on_message = on_message

        self._client = mqtt.Client(
            client_id="Kapitmas_IoT_Backend",
            clean_session=True,
            protocol=mqtt.MQTTv311
        )

        self._client.on_connect    = self._handle_connect
        self._client.on_disconnect = self._handle_disconnect
        self._client.on_message    = on_message

        if settings.mqtt_username:
            self._client.username_pw_set(
                settings.mqtt_username,
                settings.mqtt_password
            )

        # Auto-reconnect built-in paho
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)

        try:
            self._client.connect(
                settings.mqtt_broker_host,
                settings.mqtt_broker_port,
                keepalive=settings.mqtt_keepalive
            )
            self._client.loop_start()
            logger.info(
                f"MQTT connecting to "
                f"{settings.mqtt_broker_host}:{settings.mqtt_broker_port}"
            )
        except Exception as e:
            logger.error(f"MQTT connect error: {e}")

    def _handle_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected = True
            logger.info("MQTT connected")
            if self._on_connect:
                self._on_connect(client, userdata, flags, rc)
        else:
            self._connected = False
            errors = {
                1: "Wrong protocol version",
                2: "Invalid client ID",
                3: "Server unavailable",
                4: "Bad credentials",
                5: "Not authorized"
            }
            logger.error(f"MQTT connect failed: {errors.get(rc, f'rc={rc}')}")

    def _handle_disconnect(self, client, userdata, rc):
        self._connected = False
        if rc != 0:
            logger.warning(f"MQTT disconnected unexpectedly (rc={rc}), reconnecting...")
        else:
            logger.info("MQTT disconnected")

    def publish(
        self,
        topic:   str,
        payload: str,
        qos:     int  = 1,
        retain:  bool = False
    ) -> bool:
        if not self._connected or self._client is None:
            logger.warning(f"Cannot publish to {topic}: not connected")
            return False

        try:
            result = self._client.publish(topic, payload, qos=qos, retain=retain)
            return result.rc == mqtt.MQTT_ERR_SUCCESS
        except Exception as e:
            logger.error(f"Publish error to {topic}: {e}")
            return False

    def disconnect(self):
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def client(self) -> mqtt.Client | None:
        return self._client


mqtt_client = MQTTClient()