# Cafinity Security Fix — VAPT June 2026 — XSS input sanitization
import bleach
from django.utils.html import strip_tags

ALLOWED_TAGS = []
ALLOWED_ATTRIBUTES = {}


def sanitize_text(value: str) -> str:
    if value is None:
        return value
    if not isinstance(value, str):
        value = str(value)
    if not value:
        return value
    return bleach.clean(
        strip_tags(value),
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True,
    ).strip()
