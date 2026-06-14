from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.cms.views.health import HealthCheckView
from apps.cms.views.announcement_view import AnnouncementViewSet
from apps.cms.views.device_auth import (
    device_login_view,
    device_users_view,
    device_user_detail_view,
    device_user_reset_pin_view,
)
from apps.cms.views.menu import (
    canteen_list_view,
    canteen_detail_view,
    category_list_view,
    category_detail_view,
    menu_item_bulk_import_view,
    menu_item_list_create_view,
    menu_item_detail_view,
    menu_item_availability_view,
)
from apps.cms.views.employee_order import (
    employee_menu_view,
    employee_order_cancel_view,
    employee_order_mark_delivered_view,
    employee_orders_view,
)
from apps.cms.views.dashboard import (
    dashboard_live_slots_view,
    dashboard_slot_order_summary_view,
)
from apps.cms.views.kitchen import (
    kitchen_orders_view,
    kitchen_orders_history_view,
    kitchen_order_status_view,
    kitchen_stats_view,
)
from apps.cms.views.counter import (
    counter_order_collect_view,
    counter_order_lookup_view,
    counter_order_print_receipt_view,
    counter_recent_collections_view,
)
from apps.cms.views.admin import (
    admin_dashboard_view,
    admin_orders_view,
    admin_sales_report_view,
    admin_customer_report_view,
    admin_customer_orders_view,
    admin_employee_search_view,
    admin_debug_slots_view,
)
from apps.cms.views.guest_order import GuestOrderViewSet, MenuViewSet
from apps.cms.views.special_dish import SpecialDishViewSet
from apps.cms.views.slot import MealSlotViewSet

router = DefaultRouter()
router.register(r'guest-orders', GuestOrderViewSet)
router.register(r'menu', MenuViewSet, basename='menu')
router.register(r'announcements', AnnouncementViewSet, basename='announcement')
router.register(r'special-dishes', SpecialDishViewSet, basename='special-dish')
router.register(r'slots', MealSlotViewSet, basename='slots')

guest_order_list = GuestOrderViewSet.as_view({'get': 'list', 'post': 'create'})
guest_order_detail = GuestOrderViewSet.as_view({'get': 'retrieve', 'put': 'update', 'patch': 'partial_update'})
guest_order_summary = GuestOrderViewSet.as_view({'get': 'summary'})

urlpatterns = [
    path("health/", HealthCheckView.as_view(), name="cms-health"),

    # ── Device auth (Kitchen / Counter) ──────────────────────────────────────
    path('auth/device-login/', device_login_view, name='device-login'),
    path('auth/device/', device_login_view, name='device-login-alias'),
    path('devices/', device_users_view, name='device-users'),
    path('devices/<uuid:device_user_id>/', device_user_detail_view, name='device-user-detail'),
    path('devices/<uuid:device_user_id>/reset-pin/', device_user_reset_pin_view, name='device-user-reset-pin'),
    path('canteens/', canteen_list_view, name='canteen-list'),
    path('canteens/<uuid:canteen_id>/', canteen_detail_view, name='canteen-detail'),
    path('employee/menu/', employee_menu_view, name='employee-menu'),
    path('employee/orders/', employee_orders_view, name='employee-orders'),
    path('employee/orders/<uuid:order_id>/cancel/', employee_order_cancel_view, name='employee-order-cancel'),
    path('orders/<uuid:order_id>/mark-delivered/', employee_order_mark_delivered_view, name='order-mark-delivered'),
    path('dashboard/live-slots/', dashboard_live_slots_view, name='dashboard-live-slots'),
    path('dashboard/slot-order-summary/', dashboard_slot_order_summary_view, name='dashboard-slot-order-summary'),
    path('counter/orders/<str:order_code>/', counter_order_lookup_view, name='counter-order-lookup'),
    path('counter/orders/<uuid:order_id>/print-receipt/', counter_order_print_receipt_view, name='counter-order-print-receipt'),
    path('counter/orders/<uuid:order_id>/collect/', counter_order_collect_view, name='counter-order-collect'),
    path('counter/recent/', counter_recent_collections_view, name='counter-recent-collections'),

    # ── Kitchen endpoints ─────────────────────────────────────────────────────
    path('kitchen/orders/', kitchen_orders_view, name='kitchen-orders'),
    path('kitchen/orders/history/', kitchen_orders_history_view, name='kitchen-orders-history'),
    path('kitchen/orders/<uuid:order_id>/status/', kitchen_order_status_view, name='kitchen-order-status'),
    path('kitchen/stats/', kitchen_stats_view, name='kitchen-stats'),

# ── Admin endpoints ──────────────────────────────────────────────────────
    # ── Admin endpoints ──────────────────────────────────────────────────────
    path('admin/dashboard/', admin_dashboard_view, name='admin-dashboard'),
    path('admin/orders/', admin_orders_view, name='admin-orders'),
    path('admin/reports/sales/', admin_sales_report_view, name='admin-sales-report'),
    path('admin/reports/customers/', admin_customer_report_view, name='admin-customer-report'),
    path('admin/reports/customers/<uuid:customer_id>/orders/', admin_customer_orders_view, name='admin-customer-orders'),
    path('admin/employees/search/', admin_employee_search_view, name='admin-employee-search'),
    path('admin/debug/slots/', admin_debug_slots_view, name='admin-debug-slots'),
    path('reports/', include('apps.cms.reports.urls')),
    path('admin/reports/', include('apps.cms.reports.urls')),

# ── Menu: Categories ──────────────────────────────────────────────────────
    path(
        'canteens/<uuid:canteen_id>/menu/categories/',
        category_list_view,
        name='menu-category-list',
    ),
    path(
        'canteens/<uuid:canteen_id>/menu/categories/<uuid:category_id>/',
        category_detail_view,
        name='menu-category-detail',
    ),
 
    # ── Menu: Items list + create ─────────────────────────────────────────────
    path(
        'canteens/<uuid:canteen_id>/menu/items/',
        menu_item_list_create_view,
        name='menu-item-list-create',
    ),
    path(
        'canteens/<uuid:canteen_id>/menu/items/bulk-import/',
        menu_item_bulk_import_view,
        name='menu-item-bulk-import',
    ),
 
    # ── Menu: Item detail + update + delete ───────────────────────────────────
    path(
        'canteens/<uuid:canteen_id>/menu/items/<uuid:item_id>/',
        menu_item_detail_view,
        name='menu-item-detail',
    ),
 
    # ── Menu: Availability toggle ─────────────────────────────────────────────
    path(
        'canteens/<uuid:canteen_id>/menu/items/<uuid:item_id>/availability/',
        menu_item_availability_view,
        name='menu-item-availability',

    ),
    path('guest/orders/', guest_order_list, name='guest-orders-alias-list'),
    path('guest/orders/summary/', guest_order_summary, name='guest-orders-alias-summary'),
    path('guest/orders/<uuid:pk>/', guest_order_detail, name='guest-orders-alias-detail'),
    path('', include(router.urls)),
]

 



    
    
