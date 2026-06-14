# Generated manually to prevent duplicate active menu item names per canteen.

import django.db.models.functions.text
from django.db import migrations, models
from django.db.models import Q
from django.utils import timezone


def soft_delete_duplicate_menu_items(apps, schema_editor):
    CanteenMenuItem = apps.get_model('cms', 'CanteenMenuItem')

    seen = set()
    qs = (
        CanteenMenuItem.objects
        .filter(deleted_at__isnull=True)
        .order_by('canteen_id', 'name', '-created_at', '-id')
    )

    for item in qs:
        key = (str(item.canteen_id), item.name.strip().lower())
        if key not in seen:
            seen.add(key)
            continue

        item.deleted_at = timezone.now()
        item.is_active = False
        item.save(update_fields=['deleted_at', 'is_active', 'updated_at'])


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0004_menuitem_photo_upload_path'),
    ]

    operations = [
        migrations.RunPython(soft_delete_duplicate_menu_items, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='canteenmenuitem',
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower('name'),
                models.F('canteen'),
                condition=Q(('deleted_at__isnull', True)),
                name='uniq_active_menu_item_name_per_canteen_ci',
            ),
        ),
    ]
