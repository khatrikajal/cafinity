from django.db import models
import uuid
from django.utils import timezone


# Cafinity rebrand — logo + favicon update
class Notification(models.Model):
	TYPE_ORDER = 'order'
	TYPE_SYSTEM = 'system'

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	recipient = models.ForeignKey(
		'accounts.Employee',
		on_delete=models.CASCADE,
		db_column='recipient_id',
		related_name='notifications',
	)
	related_order = models.ForeignKey(
		'cms.Order',
		on_delete=models.CASCADE,
		db_column='related_order_id',
		null=True,
		blank=True,
		related_name='notifications',
	)
	notification_type = models.CharField(max_length=50, default=TYPE_SYSTEM)
	title = models.CharField(max_length=255)
	body = models.TextField()
	is_read = models.BooleanField(default=False, db_index=True)
	read_at = models.DateTimeField(null=True, blank=True)
	created_at = models.DateTimeField(default=timezone.now)

	class Meta:
		db_table = 'notifications'
		ordering = ['-created_at']

	def __str__(self):
		return f"Notification to {self.recipient_id}: {self.title[:40]}"
