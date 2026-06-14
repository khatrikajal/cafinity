from django.db import models


class SpecialDish(models.Model):
    name = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = 'cms'
        ordering = ['name']

    def __str__(self):
        return self.name
