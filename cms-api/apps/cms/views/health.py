from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.db import connection
from apps.common.logger import get_logger

logger = get_logger(__name__)

class HealthCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        logger.info("Health check called")
        db_ok = True
        try:
            connection.ensure_connection()
            logger.debug("DB connection verified")
        except Exception as e:
            logger.error("DB connection failed: %s", e)
            db_ok = False

        return Response({"success": db_ok, "data": {"api": "ok", "database": "ok" if db_ok else "unreachable"}})