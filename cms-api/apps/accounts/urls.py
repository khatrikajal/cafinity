# Cafinity Security Fix Round 2 — VAPT June 2026 — Auth + device login routes
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.cms.views.device_auth import device_login_view
from . import views

# ── Register ViewSet routes ─────────────────────────────────────────────────
router = DefaultRouter()
router.register(r'companies', views.CompanyViewSet, basename='company')
router.register(r'employees', views.EmployeeViewSet, basename='employee')
router.register(r'departments', views.DepartmentViewSet, basename='department')

urlpatterns = [
    # ── Authentication routes ────────────────────────────────────────────────
    path('login/',   views.login_view,   name='employee-login'),
    path('otp/request/', views.request_employee_otp_view, name='employee-otp-request'),
    path('otp/verify/', views.verify_employee_otp_view, name='employee-otp-verify'),
    path('refresh/', views.refresh_view, name='employee-refresh'),
    path('logout/',  views.logout_view,  name='employee-logout'),
    path('me/',      views.me_view,      name='employee-me'),
    
    # ── Password reset/change routes ────────────────────────────────────────
    path('password-reset/request/', views.password_reset_request_view, name='password-reset-request'),
    path('forgot-password/', views.password_reset_request_view, name='forgot-password'),
    path('password-reset/confirm/', views.password_reset_confirm_view, name='password-reset-confirm'),
    path('password-change/', views.password_change_view, name='password-change'),
    path('set-password/', views.set_password_init_view, name='set-password-init'),
    path('set-password/verify/', views.set_password_verify_view, name='set-password-verify'),
    path('set-password/legacy/', views.set_password_view, name='set-password-legacy'),
    path('forgot-password/', views.password_reset_request_view, name='forgot-password'),
    path('reset-password/', views.password_reset_confirm_view, name='reset-password'),
    path('device-login/', device_login_view, name='auth-device-login'),

    # ── Employee management routes (via router) ─────────────────────────────
    path('employees/bulk/', views.EmployeeViewSet.as_view({'post': 'bulk_create'}), name='employee-bulk-alias'),
    path('', include(router.urls)),
]
