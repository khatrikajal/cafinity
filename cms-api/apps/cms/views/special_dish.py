# Cafinity Security Fix — VAPT June 2026 — Secure Special Dishes endpoint
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from apps.audit.models import AuditLog
from apps.audit.service import log_action
from apps.cms.models import SpecialDish
from apps.cms.serializers import SpecialDishSerializer
from apps.core.permissions import IsAdminOrLimitedAdmin


class SpecialDishViewSet(viewsets.ModelViewSet):
    queryset = SpecialDish.objects.all()
    serializer_class = SpecialDishSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminOrLimitedAdmin()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data['name']
        instance, created = SpecialDish.objects.get_or_create(
            name__iexact=name,
            defaults={'name': name},
        )
        log_action(
            actor=request.user if getattr(request.user, "is_authenticated", False) else None,
            action_category=AuditLog.ACTION_GUEST_MENU,
            action='guest_item_created' if created else 'guest_item_updated',
            target=instance,
            request=request,
            new_state=SpecialDishSerializer(instance).data,
        )
        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(self.get_serializer(instance).data, status=response_status)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        before = SpecialDishSerializer(instance).data
        response = super().destroy(request, *args, **kwargs)
        log_action(
            actor=request.user if getattr(request.user, "is_authenticated", False) else None,
            action_category=AuditLog.ACTION_GUEST_MENU,
            action='guest_item_deleted',
            target=instance,
            previous_state=before,
            request=request,
        )
        return response
