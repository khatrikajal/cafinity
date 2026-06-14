import json
import logging
import sys
from threading import Thread
from typing import Any

from django.forms.models import model_to_dict

from apps.accounts.models import RoleChoices
from apps.audit.models import AuditLog

logger = logging.getLogger(__name__)

_SENSITIVE_MARKERS = ("password", "token", "secret", "key", "otp")
_REDACTED = "***REDACTED***"

try:
    from celery import shared_task  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    shared_task = None


def _is_sensitive_key(key: str) -> bool:
    lowered = str(key).lower()
    return any(marker in lowered for marker in _SENSITIVE_MARKERS)


def _sanitize(value: Any):
    if isinstance(value, dict):
        cleaned = {}
        for k, v in value.items():
            if _is_sensitive_key(k):
                cleaned[k] = _REDACTED
            else:
                cleaned[k] = _sanitize(v)
        return cleaned
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize(item) for item in value]
    return value


def _json_safe(value: Any):
    if value is None:
        return None
    try:
        json.dumps(value, default=str)
        return value
    except Exception:
        return str(value)


def _to_state(value: Any):
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if hasattr(value, "_meta"):
        try:
            base = model_to_dict(value)
            base["id"] = str(getattr(value, "id", ""))
            return base
        except Exception:
            return {"id": str(getattr(value, "id", "")), "display": str(value)}
    return {"value": str(value)}


def _derive_changed_fields(previous_state, new_state):
    if not isinstance(previous_state, dict) or not isinstance(new_state, dict):
        return None
    keys = set(previous_state.keys()) | set(new_state.keys())
    changed = sorted([key for key in keys if previous_state.get(key) != new_state.get(key)])
    return changed or None


def _actor_type_for(actor) -> str:
    if actor is None:
        return AuditLog.ACTOR_SYSTEM
    role = getattr(actor, "role_type", "")
    if role == RoleChoices.SUPER_ADMIN:
        return AuditLog.ACTOR_SUPER_ADMIN
    if role == RoleChoices.LIMITED_ADMIN:
        return AuditLog.ACTOR_LIMITED_ADMIN
    return AuditLog.ACTOR_SYSTEM


def _extract_request_context(request):
    if request is None:
        return None, None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    ip_address = forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")
    user_agent = request.META.get("HTTP_USER_AGENT")
    return ip_address, user_agent


def _target_fields(target):
    if target is None:
        return "", None, ""
    model_name = getattr(getattr(target, "_meta", None), "object_name", target.__class__.__name__)
    target_id = str(getattr(target, "pk", getattr(target, "id", "")) or "")
    return model_name, (target_id or None), str(target)


def log_action(
    actor,
    action_category,
    action,
    target=None,
    previous_state=None,
    new_state=None,
    changed_fields=None,
    request=None,
    metadata=None,
    is_sensitive=False,
):
    try:
        prev = _sanitize(_to_state(previous_state))
        new = _sanitize(_to_state(new_state))
        changed = changed_fields if changed_fields is not None else _derive_changed_fields(prev, new)
        target_model, target_id, target_display = _target_fields(target)
        ip_address, user_agent = _extract_request_context(request)

        AuditLog.objects.create(
            actor=actor if getattr(actor, "is_authenticated", False) else None,
            actor_type=_actor_type_for(actor),
            actor_email=str(getattr(actor, "email", "") or ""),
            actor_role=str(getattr(actor, "role_type", "") or ""),
            action_category=action_category,
            action=action,
            target_model=target_model,
            target_id=target_id,
            target_display=target_display,
            previous_state=_json_safe(prev),
            new_state=_json_safe(new),
            changed_fields=_json_safe(changed),
            ip_address=ip_address,
            user_agent=user_agent,
            metadata=_json_safe(_sanitize(metadata)),
            is_sensitive=bool(is_sensitive),
        )
    except Exception as exc:
        logger.error("AUDIT_LOG_WRITE_FAILED action=%s category=%s err=%s", action, action_category, str(exc))
        print(
            f"AUDIT_LOG_WRITE_FAILED action={action} category={action_category} err={str(exc)}",
            file=sys.stderr,
        )


if shared_task:
    @shared_task
    def _celery_audit_task(payload):
        log_action(**payload)
else:
    _celery_audit_task = None


def async_log_action(**kwargs):
    def _runner():
        log_action(**kwargs)

    if _celery_audit_task is not None:
        _celery_audit_task.delay(kwargs)
    else:
        Thread(target=_runner, daemon=True).start()
