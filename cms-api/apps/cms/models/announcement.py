from django.db import models


class Announcement(models.Model):
    STATUS_ACTIVE = 'active'
    STATUS_INACTIVE = 'inactive'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Active'),
        (STATUS_INACTIVE, 'Inactive'),
    ]

    title = models.CharField(max_length=80)
    message = models.CharField(max_length=280, blank=True, default='')
    date = models.DateField()
    time_from = models.TimeField()
    time_to = models.TimeField()
    special_dish = models.CharField(max_length=255, blank=True, default='')
    status = models.CharField(
        max_length=10,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = 'cms'
        ordering = ['-date', '-time_from']

    def __str__(self):
        return f"{self.title} ({self.date})"

    @property
    def is_active(self):
        return self.status == self.STATUS_ACTIVE

    @property
    def time_range(self):
        return f"{self.time_from.strftime('%H:%M')} — {self.time_to.strftime('%H:%M')}"