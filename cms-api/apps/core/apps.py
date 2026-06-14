import logging
import os
import sys

from django.apps import AppConfig

logger = logging.getLogger(__name__)

REQUIRED_TABLES = (
    "auth_password_reset_tokens",
    "audit_logs",
)

SKIP_COMMANDS = {
    "makemigrations",
    "migrate",
    "collectstatic",
    "shell",
    "dbshell",
    "test",
}


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    verbose_name = "Cafinity Core Security"

    def ready(self):

        # Django autoreloader
        if os.environ.get("RUN_MAIN") == "false":
            return

        # Manual bypass
        if os.environ.get(
            "SKIP_MIGRATION_CHECK",
            ""
        ).lower() in {"1", "true", "yes"}:
            return

        # Allow management commands to run
        if any(cmd in sys.argv for cmd in SKIP_COMMANDS):
            return

        # Only validate in production
        if os.getenv("DJANGO_ENV", "").lower() != "prod":
            return

        try:
            from django.db import connection

            if connection.settings_dict.get(
                "ENGINE",
                ""
            ).endswith("dummy"):
                return

            existing = set(
                connection.introspection.table_names()
            )

            missing = [
                table
                for table in REQUIRED_TABLES
                if table not in existing
            ]

            if missing:
                raise RuntimeError(
                    "Missing database table(s): "
                    f"{', '.join(missing)}. "
                    "Run migrations."
                )

        except RuntimeError:
            raise

        except Exception as exc:
            logger.warning(
                "Migration table check skipped: %s",
                exc
            )