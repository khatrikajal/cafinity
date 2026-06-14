import logging
import mimetypes
from email.mime.image import MIMEImage
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string


logger = logging.getLogger(__name__)


def _resolve_portal_url():
    return (
        getattr(settings, "EMPLOYEE_LOGIN_URL", "").strip()
        or getattr(settings, "COMPANY_DOMAIN", "").strip()
        or getattr(settings, "FRONTEND_URL", "").strip()
        or "https://cms.atpl.corp"
    )


def build_email_branding_context():
    portal_url = _resolve_portal_url().rstrip("/")
    return {
        "portal_url": portal_url,
        "ampcus_logo_url": getattr(
            settings,
            "EMAIL_AMPCUS_LOGO_URL",
            f"{portal_url}/static/emails/ampcus-tech-logo.png",
        ),
        "cafinity_logo_url": getattr(
            settings,
            "EMAIL_CAFINITY_LOGO_URL",
            f"{portal_url}/static/emails/cafinity-logo.png",
        ),
        "support_team_name": getattr(
            settings,
            "EMAIL_SUPPORT_TEAM_NAME",
            "PRAKVI TECHNO SOLUTIONS PVT LTD HR Team",
        ),
        "copyright_line": getattr(
            settings,
            "EMAIL_COPYRIGHT_LINE",
            "© 2009-2026, CAFINITY Corporation Pvt. Ltd. All Rights Reserved.",
        ),
    }


def _guess_mime_subtype(filename: str) -> str:
    guessed_type, _ = mimetypes.guess_type(filename)
    if guessed_type and guessed_type.startswith("image/"):
        return guessed_type.split("/", 1)[1]
    return "png"


def _resolve_local_image_path(source: str, base_dir: Path):
    if source.startswith("/"):
        source = source.lstrip("/")

    candidate = base_dir / source
    if candidate.exists() and candidate.is_file():
        return candidate

    parsed_path = Path(source)
    if "static" in parsed_path.parts:
        static_index = parsed_path.parts.index("static")
        candidate = base_dir.joinpath(*parsed_path.parts[static_index:])
        if candidate.exists() and candidate.is_file():
            return candidate

    candidate = base_dir / "static" / parsed_path.name
    if candidate.exists() and candidate.is_file():
        return candidate

    return None


def _try_load_remote_image(source: str):
    try:
        with urlopen(source, timeout=6) as response:
            content_type = response.headers.get_content_type()
            image_bytes = response.read()
        subtype = (
            content_type.split("/", 1)[1]
            if content_type and content_type.startswith("image/")
            else _guess_mime_subtype(urlparse(source).path)
        )
        return image_bytes, subtype
    except (URLError, ValueError):
        logger.warning(
            "Unable to load email image source %s; falling back to local static assets",
            source,
            exc_info=True,
        )
        return None, None


def _read_image_source(source: str):
    if not source:
        return None, None

    source = source.strip()
    if not source:
        return None, None

    parsed = urlparse(source)
    base_dir = Path(getattr(settings, "BASE_DIR", Path.cwd()))

    if parsed.scheme in {"http", "https"}:
        image_bytes, subtype = _try_load_remote_image(source)
        if image_bytes:
            return image_bytes, subtype
        source = parsed.path

    path = Path(source)
    if path.is_absolute():
        resolved = _resolve_local_image_path(source, base_dir)
        if resolved:
            path = resolved
    else:
        path = _resolve_local_image_path(source, base_dir) or base_dir / source.lstrip("/")

    if path.exists() and path.is_file():
        return path.read_bytes(), _guess_mime_subtype(path.name)

    logger.warning("Unable to load email image source: %s", source)
    return None, None


def _prepare_inline_branding(branding_context):
    inline_assets = []
    asset_specs = [
        ("ampcus_logo_url", "ampcus_logo"),
        ("cafinity_logo_url", "cafinity_logo"),
    ]

    for context_key, cid_prefix in asset_specs:
        image_source = branding_context.get(context_key)
        image_bytes, subtype = _read_image_source(image_source)
        if not image_bytes:
            continue

        content_id = f"{cid_prefix}@cafinity"
        branding_context[context_key] = f"cid:{content_id}"
        inline_assets.append(
            {
                "content_id": content_id,
                "bytes": image_bytes,
                "subtype": subtype or "png",
                "filename": f"{cid_prefix}.{subtype or 'png'}",
            }
        )

    return inline_assets


def send_templated_email(subject, to_email, template, context, text_body=""):
    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or getattr(
        settings, "EMAIL_HOST_USER", None
    )
    reply_to = getattr(settings, "EMAIL_REPLY_TO", "").strip()

    merged_context = {**build_email_branding_context(), **(context or {})}
    if not merged_context.get("cta_url"):
        merged_context["cta_url"] = merged_context.get("portal_url")
    if not merged_context.get("cta_label"):
        merged_context["cta_label"] = "Log In"

    inline_assets = _prepare_inline_branding(merged_context)

    try:
        html_body = render_to_string(template, merged_context)
    except Exception:
        logger.exception("Unable to render email template %s", template)
        html_body = text_body or ""

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body or "",
        from_email=from_email,
        to=[to_email],
        reply_to=[reply_to] if reply_to else None,
        headers={
            "Auto-Submitted": "auto-generated",
            "X-Auto-Response-Suppress": "All",
        },
    )
    if html_body:
        message.attach_alternative(html_body, "text/html")
        for asset in inline_assets:
            image = MIMEImage(asset["bytes"], _subtype=asset["subtype"])
            image.add_header("Content-ID", f"<{asset['content_id']}>")
            image.add_header("Content-Disposition", "inline", filename=asset["filename"])
            message.attach(image)

    sent_count = message.send(fail_silently=False)
    logger.info(
        "Email send result=%s to=%s subject=%s",
        sent_count,
        to_email,
        subject,
    )
