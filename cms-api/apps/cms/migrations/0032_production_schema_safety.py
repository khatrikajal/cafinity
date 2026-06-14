# Idempotent schema fixes for servers where app code was deployed before migrate.
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0031_cafinity_production_changes'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE cms_meal_slots
                ADD COLUMN IF NOT EXISTS summary_sent boolean NOT NULL DEFAULT false;

                CREATE INDEX IF NOT EXISTS cms_meal_slots_summary_sent_idx
                ON cms_meal_slots (summary_sent);

                ALTER TABLE cms_guest_orders
                ADD COLUMN IF NOT EXISTS guest_type varchar(20) NOT NULL DEFAULT 'GUEST';

                CREATE INDEX IF NOT EXISTS cms_guest_orders_guest_type_idx
                ON cms_guest_orders (guest_type);

                ALTER TABLE cms_menu_items
                ADD COLUMN IF NOT EXISTS available_for jsonb NOT NULL DEFAULT '[]'::jsonb;
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
