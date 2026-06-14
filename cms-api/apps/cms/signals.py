# Cafinity rebrand — logo + favicon update
import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.cms.models.order import Order
from apps.cms.services.notifications import NOTIFY_STATUSES, notify_order_status

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Order)
def order_post_save_notify(sender, instance, created, **kwargs):
    """Notify employee when an order is placed or its status changes."""
    try:
        update_fields = kwargs.get("update_fields")
        if not created and update_fields is not None and "status" not in update_fields:
            return

        if instance.status not in NOTIFY_STATUSES:
            return

        notify_order_status(instance, instance.status)
    except Exception:
        logger.exception("Order notification signal failed for order %s", getattr(instance, "pk", None))
