import os
import warnings
# Cafinity Security Fix — VAPT June 2026 — Base Django settings
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Load .env file before reading any settings
load_dotenv(BASE_DIR / '.env')


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_int(name, default):
    value = os.getenv(name)
    if value is None or str(value).strip() == '':
        return default
    return int(value)


def _env_list(name, default=None):
    value = os.getenv(name)
    if value is None or not str(value).strip():
        return list(default or [])
    return [item.strip() for item in value.split(',') if item.strip()]


# Cafinity Security Fix — VAPT June 2026 — Disable DEBUG Mode Permanently
DEBUG = _env_bool('DJANGO_DEBUG', default=False)

SECRET_KEY = os.getenv("SECRET_KEY")

ALLOWED_HOSTS = _env_list('ALLOWED_HOSTS', default=['cms-api.atpl.corp'])

# Cafinity Security Fix — VAPT June 2026 — HTTPS, Cookie Security & Security Headers
SECURE_SSL_REDIRECT = _env_bool('SECURE_SSL_REDIRECT', default=True)
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'

CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Lax'

SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = 'DENY'
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'

# Cafinity Security Fix — VAPT June 2026 — Secure Django Admin Panel
ADMIN_URL = os.getenv('DJANGO_ADMIN_URL', 'secret-mgmt-panel-2024/')
ADMIN_ALLOWED_IPS = _env_list('ADMIN_ALLOWED_IPS', default=['127.0.0.1'])
ADMIN_HONEYPOT = True

# Cafinity Security Fix Round 2 — VAPT June 2026 — CORS + CSP + middleware order
APPEND_SLASH = True

# Cafinity Security Fix Round 2 — VAPT June 2026 — Explicit CORS allowlist
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = _env_list(
    'CORS_ALLOWED_ORIGINS',
    default=['https://cms.atpl.corp', 'https://cms-api.atpl.corp'],
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]
CORS_ALLOW_HEADERS = [
    'accept',
    'authorization',
    'content-type',
    'x-csrftoken',
    'x-requested-with',
]
CORS_EXPOSE_HEADERS = ['content-disposition']

# Cafinity Security Fix Round 2 — VAPT June 2026 — Content Security Policy
_api_connect_origin = os.getenv('API_CONNECT_ORIGIN', os.getenv('VITE_API_BASE_URL', '')).strip()
_csp_connect_src = ("'self'",)
if _api_connect_origin:
    _csp_connect_src = ("'self'", _api_connect_origin)

CONTENT_SECURITY_POLICY = {
    'DIRECTIVES': {
        'default-src': ("'self'",),
        'script-src': ("'self'",),
        'style-src': ("'self'", "'unsafe-inline'"),
        'img-src': ("'self'", 'data:', 'blob:'),
        'font-src': ("'self'", 'data:'),
        'connect-src': _csp_connect_src,
        'frame-ancestors': ("'none'",),
        'form-action': ("'self'",),
        'base-uri': ("'self'",),
    },
}

# JSON error handlers (no HTML tracebacks in production)
handler404 = 'apps.core.error_handlers.handler404'
handler500 = 'apps.core.error_handlers.handler500'

TIME_ZONE = os.getenv("TIME_ZONE", "Asia/Kolkata")
USE_TZ = True

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    'django_filters',
    'django_extensions',
    'csp',

    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",

    # apps
    "apps.core.apps.CoreConfig",
    "apps.cms.apps.CmsConfig",
    "apps.accounts",
    "apps.audit.apps.AuditConfig",
    "apps.common",
    "apps.notifications",
    
]

ROOT_URLCONF = "config.urls"


MIDDLEWARE = [
    'apps.core.middleware.HideServerHeaderMiddleware',
    'apps.core.middleware.AdminIPWhitelistMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'apps.common.middleware.SecureApiErrorMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'apps.core.middleware.PermissionsPolicyMiddleware',
    'csp.middleware.CSPMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.core.middleware.InactivityTimeoutMiddleware',
    'apps.core.middleware.ApiCacheControlMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'apps.common.middleware.TenantContextMiddleware',
]

_csrf_trusted_origins_env = os.getenv("CSRF_TRUSTED_ORIGINS", "")
_csrf_trusted_origins_parsed = [origin.strip() for origin in _csrf_trusted_origins_env.split(",") if origin.strip()]
CSRF_TRUSTED_ORIGINS = _csrf_trusted_origins_parsed

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

STATIC_URL = "/static/"

STATIC_ROOT = BASE_DIR / "staticfiles"   
STATICFILES_DIRS = []                   

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"




DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME","cms"),
        "USER": os.getenv("DB_USER","postgres"),
        "PASSWORD": os.getenv("DB_PASSWORD","admin@123"),
        "HOST": os.getenv("DB_HOST","localhost"),
        "PORT": os.getenv("DB_PORT","5432"),
    }
}



# DRF
REST_FRAMEWORK = {
    # simplejwt handles Employee / Admin tokens.
    # Device tokens (Kitchen / Counter) also use simplejwt AccessToken,
    # so JWTAuthentication handles both — the role claim distinguishes them.
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'apps.cms.authentication.CanteenXJWTAuthentication',
    ],
 
    # Default: deny all. Every endpoint must explicitly grant access
    # 'DEFAULT_PERMISSION_CLASSES': [
    #     'rest_framework.permissions.IsAuthenticated',
    # ],
 
    # 'DEFAULT_THROTTLE_CLASSES': [
    #     'rest_framework.throttling.AnonRateThrottle',
    #     'rest_framework.throttling.UserRateThrottle',
    # ],
    # 'DEFAULT_THROTTLE_RATES': {
    #     'anon': '20/min',
    #     'user': '100/min',
    # },
}


AUTH_USER_MODEL = 'accounts.User'

# Cafinity Security Fix Round 2 — VAPT June 2026 — SMTP from environment only
EMAIL_BACKEND = os.getenv(
    'EMAIL_BACKEND',
    'django.core.mail.backends.console.EmailBackend',
)
EMAIL_HOST = os.getenv('EMAIL_HOST') or os.getenv('SMTP_HOST') or ''
EMAIL_PORT = _env_int('EMAIL_PORT', _env_int('SMTP_PORT', 587))
EMAIL_USE_TLS = _env_bool('EMAIL_USE_TLS', default=True)
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER') or os.getenv('SMTP_USER') or ''
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD') or os.getenv('SMTP_PASS') or ''
EMAIL_TIMEOUT = _env_int('EMAIL_TIMEOUT', 10)
ORDER_EMAIL_ASYNC = _env_bool('ORDER_EMAIL_ASYNC', default=False)
DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', 'Cafinity <noreply@cafinity.com>')
EMAIL_REPLY_TO = os.getenv('EMAIL_REPLY_TO', '')

if not EMAIL_HOST_USER:
    warnings.warn('EMAIL_HOST_USER not set — emails will not be sent', stacklevel=2)
EMPLOYEE_LOGIN_URL = os.getenv("EMPLOYEE_LOGIN_URL", "")
EMPLOYEE_PASSWORD_RESET_TTL_SECONDS = _env_int(
    "EMPLOYEE_PASSWORD_RESET_TTL_SECONDS",
    86400,
)
ADMIN_EMAIL = [email.strip() for email in os.getenv("ADMIN_EMAIL", "").split(",") if email.strip()]
REPORT_EMAIL = [email.strip() for email in os.getenv("REPORT_EMAIL", "").split(",") if email.strip()]






# ──────────────────────────────────────────────────────────────────────────────
# simplejwt — token lifetimes and signing
# ──────────────────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    # Employee / Admin token lifetimes
    'ACCESS_TOKEN_LIFETIME':  timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),

    'ROTATE_REFRESH_TOKENS':  True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,

    'SIGNING_KEY': os.getenv("JWT_SECRET_KEY", SECRET_KEY),

    'ALGORITHM': 'HS256',
    'AUTH_HEADER_TYPES': ('Bearer', 'Token'),
    'AUTH_TOKEN_CLASSES': (
        'rest_framework_simplejwt.tokens.AccessToken',
    ),

    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
}

# Configurable log directory — defaults to backend/logs/
LOGS_DIR = Path(os.getenv("LOGS_DIR", BASE_DIR / "logs"))
LOGS_DIR.mkdir(parents=True, exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,

    "formatters": {
        "verbose": {
            "format": "{asctime} {levelname} {name} {module}.{funcName}:{lineno} — {message}",
            "style": "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "simple": {
            "format": "{asctime} {levelname} — {message}",
            "style": "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
    },

    "handlers": {
        # Rotating daily file — keeps today only, auto-deletes old
        "file": {
            "class": "logging.handlers.TimedRotatingFileHandler",
            "filename": str(LOGS_DIR / "cms.log"),
            "when": "midnight",       # rotate at midnight
            "interval": 1,            # every 1 day
            "backupCount": 0,         #  0 = keep only current day, delete on rotate
            "formatter": "verbose",
            "encoding": "utf-8",
            "delay":True,
        },
        # Console output for dev
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
    },

    "loggers": {
        # apps — catches all apps.* loggers
        "apps": {
            "handlers": ["file", "console"],
            "level": os.getenv("LOG_LEVEL", "DEBUG"),
            "propagate": False,
        },
        # Django internals
        # "django": {
        #     "handlers": ["file", "console"],
        #     "level": "INFO",
        #     "propagate": False,
        # },
        
    },

    # Catch anything not covered above
    "root": {
        "handlers": ["file", "console"],
        "level": "WARNING",
    },
}
