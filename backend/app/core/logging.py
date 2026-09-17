"""
Centralized logging setup for Kapitmas IoT Backend.

Usage in any module:
    from app.core.logging import get_logger
    logger = get_logger(__name__)

Call setup_logging() once at app startup (done in main.py lifespan).
"""

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Literal

# ── ANSI colors ─────────────────────────────────────────────────────────────

_C = {
    "DEBUG":    "\033[36m",   # cyan
    "INFO":     "\033[32m",   # green
    "WARNING":  "\033[33m",   # yellow
    "ERROR":    "\033[31m",   # red
    "CRITICAL": "\033[35m",   # magenta
    "RESET":    "\033[0m",
    "DIM":      "\033[2m",
    "BOLD":     "\033[1m",
}

# ── Formatters ───────────────────────────────────────────────────────────────


class _ColoredFormatter(logging.Formatter):
    """Human-readable colored output for development."""

    def format(self, record: logging.LogRecord) -> str:
        ts    = self.formatTime(record, "%H:%M:%S")
        color = _C.get(record.levelname, "")
        text  = record.getMessage()
        out   = (
            f"{_C['DIM']}{ts}{_C['RESET']} "
            f"{color}{record.levelname:<8}{_C['RESET']} "
            f"{_C['BOLD']}{record.name}{_C['RESET']}: "
            f"{text}"
        )
        if record.exc_info:
            out += "\n" + self.formatException(record.exc_info)
        if record.stack_info:
            out += "\n" + self.formatStack(record.stack_info)
        return out


class _JsonFormatter(logging.Formatter):
    """Structured JSON output for production / log aggregators."""

    # Built-in instance attributes on every LogRecord — exclude from extra fields
    _BUILTIN_KEYS: frozenset = frozenset(
        logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()
    )

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "ts":    datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg":   record.getMessage(),
        }
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        # Only include genuinely extra fields passed via logger.info(..., extra={...})
        for key, val in record.__dict__.items():
            if key not in self._BUILTIN_KEYS and not key.startswith("_"):
                entry[key] = val
        return json.dumps(entry, ensure_ascii=False, default=str)


# ── Quiet list ────────────────────────────────────────────────────────────────

_NOISY_LOGGERS = [
    "uvicorn.access",
    "sqlalchemy.engine",
    "sqlalchemy.pool",
    "paho.mqtt",
    "multipart",
]

# ── Public API ────────────────────────────────────────────────────────────────


def setup_logging(
    level: str = "INFO",
    env: Literal["development", "production"] = "development",
) -> None:
    """
    Configure the root logger. Call once at startup.

    Args:
        level: Root log level (DEBUG / INFO / WARNING / ERROR).
        env:   "development" → colored console; "production" → JSON lines.
    """
    root = logging.getLogger()
    root.setLevel(level.upper())

    # Clear any handlers added by earlier basicConfig / library imports
    root.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        _ColoredFormatter() if env != "production" else _JsonFormatter()
    )
    root.addHandler(handler)

    # Suppress noisy third-party loggers
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Return a named logger.  Drop-in replacement for logging.getLogger(__name__).

    Example:
        logger = get_logger(__name__)
        logger.info("Device %s connected", device_name)
    """
    return logging.getLogger(name)
