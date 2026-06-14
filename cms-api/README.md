# cms-api
Canteen Management System Backend

## Temporary HTTP Deployment Mode

If production is temporarily deployed without TLS termination, set these in `.env`:

```env
SECURE_SSL_REDIRECT=false
SESSION_COOKIE_SECURE=false
CSRF_COOKIE_SECURE=false
ENABLE_HSTS=false
USE_X_FORWARDED_PROTO=true
```

After TLS/proxy HTTPS is verified, switch back to secure defaults:

```env
SECURE_SSL_REDIRECT=true
SESSION_COOKIE_SECURE=true
CSRF_COOKIE_SECURE=true
ENABLE_HSTS=true
```
