from django.apps import AppConfig


class CmsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.cms'

    def ready(self):
        # Import signals to register handlers.
        try:
            from . import signals  # noqa: F401
        except Exception:
            pass

        try:
            from apps.cms.scheduler import start_order_expiry_scheduler
            start_order_expiry_scheduler()
        except Exception:
            pass
