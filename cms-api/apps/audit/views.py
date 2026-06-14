import csv
import json

from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import generics, pagination, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import RoleChoices
from apps.audit.models import AuditLog
from apps.audit.serializers import AuditLogSerializer
from apps.core.audit_guard import audit_service_available, audit_unavailable_response


def _request_role_type(request):
    try:
        role_type = request.auth.get("role_type") if request.auth else None
    except Exception:
        role_type = None
    return role_type or getattr(request.user, "role_type", "")


class IsAuditViewer(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return _request_role_type(request) in {RoleChoices.SUPER_ADMIN, RoleChoices.LIMITED_ADMIN}


def _is_super_admin(request) -> bool:
    return _request_role_type(request) == RoleChoices.SUPER_ADMIN


def _parse_bool(value):
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    return None


def _json_string(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return str(value)


def _parse_boundary(value, *, end=False):
    if not value:
        return None
    dt = parse_datetime(value)
    if dt is not None:
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt
    date_value = parse_date(value)
    if date_value is None:
        return None
    base = timezone.datetime.combine(date_value, timezone.datetime.max.time() if end else timezone.datetime.min.time())
    return timezone.make_aware(base, timezone.get_current_timezone())


def _apply_filters(queryset, request):
    params = request.query_params

    actor_id = params.get("actor_id")
    actor_email = params.get("actor_email")
    action_category = params.get("action_category")
    action = params.get("action")
    target_model = params.get("target_model")
    target_id = params.get("target_id")
    from_date = params.get("from_date")
    to_date = params.get("to_date")
    is_sensitive = _parse_bool(params.get("is_sensitive"))
    search = (params.get("search") or "").strip()

    if actor_id:
        queryset = queryset.filter(actor_id=actor_id)
    if actor_email:
        queryset = queryset.filter(actor_email__icontains=actor_email)
    if action_category:
        queryset = queryset.filter(action_category=action_category)
    if action:
        queryset = queryset.filter(action=action)
    if target_model:
        queryset = queryset.filter(target_model__iexact=target_model)
    if target_id:
        queryset = queryset.filter(target_id=str(target_id))
    if is_sensitive is not None:
        queryset = queryset.filter(is_sensitive=is_sensitive)

    from_boundary = _parse_boundary(from_date, end=False)
    to_boundary = _parse_boundary(to_date, end=True)
    if from_boundary:
        queryset = queryset.filter(timestamp__gte=from_boundary)
    if to_boundary:
        queryset = queryset.filter(timestamp__lte=to_boundary)

    if search:
        queryset = queryset.filter(
            Q(actor_email__icontains=search)
            | Q(target_display__icontains=search)
            | Q(action__icontains=search)
        )

    return queryset


class AuditPagination(pagination.PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class _AuditBaseView:
    permission_classes = [permissions.IsAuthenticated, IsAuditViewer]

    def get_queryset(self):
        return _apply_filters(AuditLog.objects.select_related("actor").all(), self.request).order_by("-timestamp")

    def _can_view_sensitive(self):
        return _is_super_admin(self.request)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["can_view_sensitive"] = self._can_view_sensitive()
        return context


class AuditLogListView(_AuditBaseView, generics.ListAPIView):
    serializer_class = AuditLogSerializer
    pagination_class = AuditPagination

    def get_queryset(self):
        return super().get_queryset()


class AuditLogDetailView(_AuditBaseView, generics.RetrieveAPIView):
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("actor").all()
    lookup_field = "id"


class AuditLogSummaryView(_AuditBaseView, APIView):
    def get(self, request):
        if not audit_service_available():
            return audit_unavailable_response()
        queryset = _apply_filters(AuditLog.objects.all(), request)

        now = timezone.localtime()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        total_today = queryset.filter(timestamp__range=(start_of_day, end_of_day)).count()

        by_category = {
            row["action_category"]: row["count"]
            for row in queryset.values("action_category").annotate(count=Count("id")).order_by("action_category")
        }
        recent_actors = list(
            queryset.values("actor_email", "actor_role")
            .exclude(actor_email="")
            .annotate(action_count=Count("id"))
            .order_by("-action_count", "-actor_email")[:10]
        )
        recent_actor_payload = [
            {"email": row["actor_email"], "role": row["actor_role"], "action_count": row["action_count"]}
            for row in recent_actors
        ]

        last_password_change_log = queryset.filter(
            action_category=AuditLog.ACTION_AUTH,
            action__in=["password_change", "password_reset", "first_time_password_set"],
        ).first()
        last_password_change = None
        if last_password_change_log:
            last_password_change = {
                "actor_email": last_password_change_log.actor_email,
                "timestamp": last_password_change_log.timestamp,
            }

        return Response(
            {
                "total_today": total_today,
                "by_category": by_category,
                "recent_actors": recent_actor_payload,
                "last_password_change": last_password_change,
            }
        )


class AuditLogExportView(_AuditBaseView, APIView):
    def get(self, request):
        if not audit_service_available():
            return audit_unavailable_response()
        export_format = (request.query_params.get("format") or "csv").strip().lower()
        if export_format != "csv":
            return Response({"detail": "Only csv export is supported."}, status=400)

        queryset = _apply_filters(AuditLog.objects.all(), request).order_by("-timestamp")
        can_view_sensitive = _is_super_admin(request)

        response = HttpResponse(content_type="text/csv")
        timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
        response["Content-Disposition"] = f'attachment; filename="audit_logs_{timestamp}.csv"'

        writer = csv.writer(response)
        writer.writerow(
            [
                "timestamp",
                "actor_email",
                "actor_role",
                "action_category",
                "action",
                "target_model",
                "target_display",
                "changed_fields",
                "ip_address",
                "metadata",
            ]
        )

        for row in queryset:
            changed_fields = row.changed_fields
            metadata = row.metadata
            if row.is_sensitive and not can_view_sensitive:
                changed_fields = "***RESTRICTED***"
                metadata = "***RESTRICTED***"
            writer.writerow(
                [
                    row.timestamp.isoformat() if row.timestamp else "",
                    row.actor_email,
                    row.actor_role,
                    row.action_category,
                    row.action,
                    row.target_model,
                    row.target_display,
                    _json_string(changed_fields),
                    row.ip_address or "",
                    _json_string(metadata),
                ]
            )

        return response
