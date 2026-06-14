from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0028_slotmenuitem_min_qty_per_order'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        'ALTER TABLE cms_orders '
                        'ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1'
                    ),
                    reverse_sql=(
                        'ALTER TABLE cms_orders '
                        'DROP COLUMN IF EXISTS version'
                    ),
                ),
            ],
            state_operations=[],
        ),
    ]
