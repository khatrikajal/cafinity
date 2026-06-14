from apps.audit.service import log_action


class AuditableMixin:
    def audit(self, action_category, action, **kwargs):
        request = kwargs.pop("request", None) or getattr(self, "request", None)
        actor = kwargs.pop("actor", None)
        if actor is None and request is not None:
            actor = getattr(request, "user", None)
        log_action(
            actor=actor,
            action_category=action_category,
            action=action,
            request=request,
            **kwargs,
        )
