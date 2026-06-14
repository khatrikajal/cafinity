"""Router for CMS report endpoints."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.cms.reports.views import ReportViewSet

router = DefaultRouter()
router.register(r"", ReportViewSet, basename="reports")

urlpatterns = [
    path("", include(router.urls)),
]
