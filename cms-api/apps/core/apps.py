# Cafinity Security Fix — VAPT June 2026 — Migration startup validation
import logging
import os

from django.apps import AppConfig

logger = logging.getLogger(__name__)

REQUIRED_TABLES = (
    'auth_password_reset_tokens',
    'audit_logs',
)


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.core'
    verbose_name = 'Cafinity Core Security'

    def ready(self):
        if os.environ.get('RUN_MAIN') == 'false':
            return
        if os.environ.get('SKIP_MIGRATION_CHECK', '').lower() in {'1', 'true', 'yes'}:
            return

        try:
            from django.db import connection

            if connection.settings_dict.get('ENGINE', '').endswith('dummy'):
                return

            existing = set(connection.introspection.table_names())
            missing = [table for table in REQUIRED_TABLES if table not in existing]
            if missing:
                raise RuntimeError(
                    f"Missing database table(s): {', '.join(missing)}. Run migrations."
                )
        except RuntimeError:
            raise
        except Exception as exc:
            logger.warning('Migration table check skipped: %s', exc)
