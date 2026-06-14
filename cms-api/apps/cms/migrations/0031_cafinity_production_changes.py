# Cafinity — Guest Menu Three Tabs + Post-Cutoff Summary + Simplified Order Status
from django.db import migrations, models


def set_menuitem_available_for_defaults(apps, schema_editor):
    MenuItem = apps.get_model('cms', 'MenuItem')
    MenuItem.objects.filter(available_for=[]).update(
        available_for=['GUEST', 'NEW_JOINEE', 'VENDOR']
    )


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0030_drop_employee_slot_active_order_constraint'),
    ]

    operations = [
        migrations.AddField(
            model_name='guestorder',
            name='guest_type',
            field=models.CharField(
                choices=[('GUEST', 'Guest'), ('NEW_JOINEE', 'New Joinee'), ('VENDOR', 'Vendor')],
                db_column='guest_type',
                db_index=True,
                default='GUEST',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='menuitem',
            name='available_for',
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Guest types this item is shown for: GUEST, NEW_JOINEE, VENDOR.',
            ),
        ),
        migrations.RunPython(set_menuitem_available_for_defaults, migrations.RunPython.noop),
        migrations.AddField(
            model_name='mealslot',
            name='summary_sent',
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text='True after post-cutoff summary email has been dispatched.',
            ),
        ),
        migrations.AlterField(
            model_name='order',
            name='status',
            field=models.CharField(
                choices=[
                    ('PENDING', 'Pending'),
                    ('PLACED', 'Placed'),
                    ('PREPARING', 'Preparing'),
                    ('READY', 'Ready for Collection'),
                    ('DELIVERED', 'Delivered'),
                    ('CANCELLED', 'Cancelled'),
                    ('EXPIRED', 'Expired'),
                ],
                db_index=True,
                default='PENDING',
                max_length=20,
            ),
        ),
    ]
