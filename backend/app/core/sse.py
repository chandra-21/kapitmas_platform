import asyncio
import json
from app.core.logging import get_logger
from datetime import datetime, timezone
from typing import Any

logger = get_logger(__name__)


class SSEManager:
    """
    Thread-safe SSE event manager.
    Auto-cleanup subscriber yang mati (queue full).
    """

    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    async def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        self._queues.append(q)
        logger.debug(f"SSE subscriber added. Total: {len(self._queues)}")
        return q

    async def unsubscribe(self, q: asyncio.Queue):
        if q in self._queues:
            self._queues.remove(q)
        logger.debug(f"SSE subscriber removed. Total: {len(self._queues)}")

    async def publish(self, event_type: str, data: Any):
        """Publish dari async context"""
        if not self._queues:
            return

        payload = {
            "type":      event_type,
            "data":      data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        dead = []
        for q in list(self._queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)

        for q in dead:
            await self.unsubscribe(q)
            logger.warning("Removed dead SSE subscriber")

    def publish_sync(self, event_type: str, data: Any):
        """
        Publish dari sync context (MQTT handler, scheduler).
        Tidak butuh await.
        """
        if not self._queues:
            return

        payload = {
            "type":      event_type,
            "data":      data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        dead = []
        for q in list(self._queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
            except Exception as e:
                logger.error(f"SSE publish error: {e}")
                dead.append(q)

        for q in dead:
            if q in self._queues:
                self._queues.remove(q)

    @property
    def subscriber_count(self) -> int:
        return len(self._queues)


# Global instance
sse_manager = SSEManager()