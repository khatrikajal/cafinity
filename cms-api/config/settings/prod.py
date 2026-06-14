from .base import *
from .base import _env_bool

DEBUG = False



# Security
SECURE_SSL_REDIRECT = _env_bool("SECURE_SSL_REDIRECT", default=True)
SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", default=True)
CSRF_COOKIE_SECURE = _env_bool("CSRF_COOKIE_SECURE", default=True)

# Respect HTTPS forwarded by reverse proxies/load balancers.
if _env_bool("USE_X_FORWARDED_PROTO", default=True):
	SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
	USE_X_FORWARDED_HOST = True

if _env_bool("ENABLE_HSTS", default=True):
	SECURE_HSTS_SECONDS = 31536000
	SECURE_HSTS_INCLUDE_SUBDOMAINS = True
	SECURE_HSTS_PRELOAD = True
else:
	SECURE_HSTS_SECONDS = 0
	SECURE_HSTS_INCLUDE_SUBDOMAINS = False
	SECURE_HSTS_PRELOAD = False