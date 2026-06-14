import logging
import os
from pathlib import Path

# backend/ root — goes up from common/logger.py → apps/ → backend/
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent

# Configurable via .env — defaults to backend/logs/
LOGS_DIR = Path(os.getenv("LOGS_DIR", BACKEND_DIR / "logs"))
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def get_logger(name: str) -> logging.Logger:
    """
    Usage anywhere in the project:
        from apps.common.logger import get_logger
        logger = get_logger(__name__)
    """
    return logging.getLogger(name)