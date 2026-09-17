from app.core.logging import get_logger
import os

import firebase_admin
from firebase_admin import credentials, messaging

from app.config import settings

logger = get_logger(__name__)

_app = None


def initialize_firebase():
    global _app
    if _app is not None:
        return

    path = settings.firebase_service_account_path
    if not path or not os.path.exists(path):
        logger.warning(f"Firebase service account tidak ditemukan: {path} — FCM push disabled")
        return

    try:
        cred = credentials.Certificate(path)
        _app = firebase_admin.initialize_app(cred)
        logger.info(f"Firebase FCM initialized dari {path}")
    except Exception as e:
        logger.error(f"Failed to initialize Firebase FCM: {e}")
        raise


def send_multicast_push(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
) -> tuple[int, int]:
    """
    Send push notification to multiple FCM tokens.
    Returns (success_count, failure_count).
    """
    if not tokens or _app is None:
        return 0, len(tokens)

    message = messaging.MulticastMessage(
        tokens=tokens,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in (data or {}).items()},
        android=messaging.AndroidConfig(priority="high"),
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(
                aps=messaging.Aps(content_available=True)
            )
        ),
    )

    response = messaging.send_each_for_multicast(message)
    return response.success_count, response.failure_count
