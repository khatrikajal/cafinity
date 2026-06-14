"""
AnnouncementService — business logic layer.

Views stay thin; all DB-touching logic lives here.

Fixes applied vs original:
  BUG 2  — get_stats() used 4 separate COUNT queries → replaced with single aggregate()
  BUG 3  — get_stats() with_special_dish missed NULL special_dish → added isnull guard
  BUG 4  — get_filtered() used date__icontains on a DateField → raises FieldError at
             runtime; removed date from the icontains search. Date filtering is handled
             separately via an exact `date` query param in the view if needed.
  BUG 6  — toggle_status used `if new_status:` which is falsy for '' → changed to
             `if new_status is not None:`
"""

from django.db.models import Count, Q, QuerySet

from apps.cms.models import Announcement


class AnnouncementService:

    # ── Queries ────────────────────────────────────────────────────────────────

    @staticmethod
    def get_all() -> QuerySet:
        return Announcement.objects.all()

    @staticmethod
    def get_filtered(status: str | None = None, search: str | None = None) -> QuerySet:
        qs = Announcement.objects.all()

        if status in (Announcement.STATUS_ACTIVE, Announcement.STATUS_INACTIVE):
            qs = qs.filter(status=status)

        if search:
            # BUG 4 FIX: date__icontains is invalid on DateField — removed.
            # To filter by date, pass a separate `date` query param and do
            # qs.filter(date=parsed_date) in the view.
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(message__icontains=search)
                | Q(special_dish__icontains=search)
            )

        return qs

    @staticmethod
    def get_by_id(pk: int) -> Announcement:
        return Announcement.objects.get(pk=pk)

    # ── Mutations ──────────────────────────────────────────────────────────────

    @staticmethod
    def create(validated_data: dict) -> Announcement:
        return Announcement.objects.create(**validated_data)

    @staticmethod
    def update(instance: Announcement, validated_data: dict) -> Announcement:
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance

    @staticmethod
    def delete(instance: Announcement) -> None:
        instance.delete()

    @staticmethod
    def toggle_status(instance: Announcement, new_status: str | None = None) -> Announcement:
        """
        If new_status is provided (not None), set it explicitly.
        Otherwise flip between active ↔ inactive.

        BUG 6 FIX: `if new_status:` was falsy for empty string ''.
        Changed to `if new_status is not None:` for explicit None check.
        """
        if new_status is not None:
            instance.status = new_status
        else:
            instance.status = (
                Announcement.STATUS_INACTIVE
                if instance.status == Announcement.STATUS_ACTIVE
                else Announcement.STATUS_ACTIVE
            )
        instance.save(update_fields=['status', 'updated_at'])
        return instance

    # ── Aggregates (dashboard summary cards) ──────────────────────────────────

    @staticmethod
    def get_stats() -> dict:
        """
        BUG 2 FIX: Original made 4 separate COUNT queries against the DB.
        Replaced with a single aggregate() call using conditional Count filters.

        BUG 3 FIX: with_special_dish originally used exclude(special_dish='')
        which misses NULL rows. Added isnull guard.
        """
        result = Announcement.objects.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(status=Announcement.STATUS_ACTIVE)),
            inactive=Count('id', filter=Q(status=Announcement.STATUS_INACTIVE)),
            # BUG 3 FIX: exclude both empty string and NULL
            with_special_dish=Count(
                'id',
                filter=~Q(special_dish='') & Q(special_dish__isnull=False),
            ),
        )
        return result