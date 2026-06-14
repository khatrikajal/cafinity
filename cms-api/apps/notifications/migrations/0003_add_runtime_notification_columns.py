from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0002_match_existing_notification_table"),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id uuid;",
                "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_order_id uuid;",
                "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type varchar(50) NOT NULL DEFAULT 'system';",
                "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title varchar(255) NOT NULL DEFAULT '';",
                "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';",
                "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamp with time zone NULL;",
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'notifications' AND column_name = 'message'
                    ) THEN
                        ALTER TABLE notifications ALTER COLUMN message SET DEFAULT '';
                        UPDATE notifications SET body = message
                        WHERE body = '' AND message IS NOT NULL;
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'notifications' AND column_name = 'employee_id'
                    ) THEN
                        UPDATE notifications SET recipient_id = employee_id
                        WHERE recipient_id IS NULL AND employee_id IS NOT NULL;
                    END IF;
                END $$;
                """,
            ],
            reverse_sql=migrations.RunSQL.noop,
            state_operations=[],
        ),
    ]
