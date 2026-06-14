from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0027_alter_order_order_code'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        'ALTER TABLE cms_slot_menu_items '
                        'ADD COLUMN IF NOT EXISTS min_qty_per_order integer NOT NULL DEFAULT 1'
                    ),
                    reverse_sql=(
                        'ALTER TABLE cms_slot_menu_items '
                        'DROP COLUMN IF EXISTS min_qty_per_order'
                    ),
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name='slotmenuitem',
                    name='min_qty_per_order',
                    field=models.PositiveIntegerField(
                        db_column='min_qty_per_order',
                        default=1,
                        editable=False,
                    ),
                ),
            ],
        ),
    ]
