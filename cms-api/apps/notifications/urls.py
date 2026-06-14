from django.urls import path
from apps.notifications import views

urlpatterns = [
	path('', views.notification_list_view, name='notification-list'),
	path('mark-all-read/', views.notification_mark_all_read_view, name='notification-mark-all-read'),
	path('<uuid:notification_id>/read/', views.notification_mark_read_view, name='notification-mark-read'),
	path('<uuid:notification_id>/', views.notification_delete_view, name='notification-delete'),
]
