import logging
import os
import sys
import threading
import time

from django.db import close_old_connections

logger = logging.getLogger(__name__)

_started = False
_lock = threading.Lock()


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    value = os.getenv(name)
    if value is None or str(value).strip() == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _should_start_scheduler():
    if not _env_bool("CANTEENX_AUTO_EXPIRE_ORDERS", True):
        return False

    argv = {arg.lower() for arg in sys.argv}
    executable_name = os.path.basename(sys.argv[0]).lower() if sys.argv else ""
    if executable_name == "manage.py" and "runserver" not in argv:
        return False

    skipped_commands = {
        "makemigrations",
        "migrate",
        "check",
        "collectstatic",
        "expire_orders",
        "shell",
        "test",
    }
    if argv & skipped_commands:
        return False

    if "runserver" in argv and os.environ.get("RUN_MAIN") != "true":
        return False

    return True


def _background_loop(interval_seconds, startup_delay_seconds):
    if startup_delay_seconds > 0:
        time.sleep(startup_delay_seconds)

    while True:
        try:
            close_old_connections()
            from apps.cms.services.orders import expire_due_orders

            expired_count = expire_due_orders()
            if expired_count:
                logger.info("AUTO_ORDER_EXPIRY expired_count=%s", expired_count)
        except Exception:
            logger.exception("AUTO_ORDER_EXPIRY_FAILED")

        try:
            from apps.cms.tasks import run_post_cutoff_summary_sync

            summary_count = run_post_cutoff_summary_sync()
            if summary_count:
                logger.info("POST_CUTOFF_SUMMARY processed=%s", summary_count)
        except Exception:
            logger.exception("POST_CUTOFF_SUMMARY_LOOP_FAILED")
        finally:
            close_old_connections()
            time.sleep(interval_seconds)


def start_order_expiry_scheduler():
    global _started

    if not _should_start_scheduler():
        return

    with _lock:
        if _started:
            return
        _started = True

        interval_seconds = max(60, _env_int("CANTEENX_ORDER_EXPIRY_INTERVAL_SECONDS", 300))
        startup_delay_seconds = max(0, _env_int("CANTEENX_ORDER_EXPIRY_STARTUP_DELAY_SECONDS", 10))

        thread = threading.Thread(
            target=_background_loop,
            args=(interval_seconds, startup_delay_seconds),
            name="cafinity-background-scheduler",
            daemon=True,
        )
        thread.start()
        logger.info(
            "CAFINITY_BACKGROUND_SCHEDULER_STARTED interval_seconds=%s startup_delay_seconds=%s",
            interval_seconds,
            startup_delay_seconds,
        )
