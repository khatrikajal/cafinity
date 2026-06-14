from django.urls import path

from apps.audit.views import (
    AuditLogDetailView,
    AuditLogExportView,
    AuditLogListView,
    AuditLogSummaryView,
)

urlpatterns = [
    path("logs/", AuditLogListView.as_view(), name="audit-log-list"),
    path("logs/summary/", AuditLogSummaryView.as_view(), name="audit-log-summary"),
    path("logs/export/", AuditLogExportView.as_view(), name="audit-log-export"),
    path("logs/<uuid:id>/", AuditLogDetailView.as_view(), name="audit-log-detail"),
]
