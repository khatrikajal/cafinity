from apps.accounts.models import Employee, RoleChoices
from django.db.models import Q
from apps.notifications.models import Notification


def notify_admins(title, body, *, notification_type=Notification.TYPE_SYSTEM, company_id=None, canteen_id=None):
    qs = Employee.objects.filter(
        is_active=True,
        user__isnull=False,
        user__role_type__in=RoleChoices.CMS_ADMIN_ROLES,
    ).select_related("user").only("id", "company_id", "canteen_id", "user__role_type")

    if company_id:
        qs = qs.filter(Q(user__role_type=RoleChoices.SUPER_ADMIN) | Q(company_id=company_id))

    if canteen_id:
        qs = qs.filter(
            Q(user__role_type=RoleChoices.SUPER_ADMIN)
            | Q(user__role_type=RoleChoices.LIMITED_ADMIN, canteen_id=canteen_id)
            | ~Q(user__role_type__in={RoleChoices.SUPER_ADMIN, RoleChoices.LIMITED_ADMIN})
        )

    notifications = [
        Notification(
            recipient=employee,
            notification_type=notification_type,
            title=title,
            body=body,
        )
        for employee in qs.distinct()
    ]
    if notifications:
        Notification.objects.bulk_create(notifications)
