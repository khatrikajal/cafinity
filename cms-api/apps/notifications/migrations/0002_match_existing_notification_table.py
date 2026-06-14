import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0024_alter_canteenmenuitem_discounted_price"),
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RemoveField(
                    model_name="notification",
                    name="employee",
                ),
                migrations.RemoveField(
                    model_name="notification",
                    name="user",
                ),
                migrations.RemoveField(
                    model_name="notification",
                    name="message",
                ),
                migrations.AddField(
                    model_name="notification",
                    name="recipient",
                    field=models.ForeignKey(
                        db_column="recipient_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notifications",
                        to="accounts.employee",
                    ),
                ),
                migrations.AddField(
                    model_name="notification",
                    name="related_order",
                    field=models.ForeignKey(
                        blank=True,
                        db_column="related_order_id",
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notifications",
                        to="cms.order",
                    ),
                ),
                migrations.AddField(
                    model_name="notification",
                    name="notification_type",
                    field=models.CharField(default="system", max_length=50),
                ),
                migrations.AddField(
                    model_name="notification",
                    name="title",
                    field=models.CharField(max_length=255),
                ),
                migrations.AddField(
                    model_name="notification",
                    name="body",
                    field=models.TextField(),
                ),
                migrations.AddField(
                    model_name="notification",
                    name="read_at",
                    field=models.DateTimeField(blank=True, null=True),
                ),
            ],
        ),
    ]
