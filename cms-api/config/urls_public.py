"""Compatibility URL config for environments that load config.urls_public.

The development and LAN builds need the same API routes as config.urls.
"""

from .urls import urlpatterns
