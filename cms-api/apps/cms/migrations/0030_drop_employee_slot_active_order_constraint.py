from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0029_order_version_db_column'),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                'ALTER TABLE cms_orders '
                'DROP CONSTRAINT IF EXISTS uniq_employee_slot_active_order'
            ),
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
