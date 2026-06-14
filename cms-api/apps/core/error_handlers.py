# Cafinity Security Fix — VAPT June 2026 — JSON error handlers
from django.http import JsonResponse


def handler404(request, exception=None):
    return JsonResponse({'error': 'Not found', 'status': 404}, status=404)


def handler500(request):
    return JsonResponse({'error': 'Internal server error', 'status': 500}, status=500)
