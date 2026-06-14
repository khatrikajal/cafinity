# Cafinity Security Fix Round 2 — VAPT June 2026 — Audit service availability
from django.db import connection


def audit_service_available() -> bool:
    try:
        return 'audit_logs' in connection.introspection.table_names()
    except Exception:
        return False


def audit_unavailable_response():
    from rest_framework.response import Response
    from rest_framework import status

    return Response(
        {'error': 'Audit service not available'},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )
