# Cafinity rebrand — logo + favicon update
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_employeecategory_is_discount_eligible"),
    ]

    operations = [
        migrations.CreateModel(
            name="PasswordResetToken",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("token", models.CharField(db_index=True, max_length=128, unique=True)),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("used_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("created_from", models.CharField(default="forgot_password", max_length=32)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="password_reset_tokens", to="accounts.user"),
                ),
            ],
            options={
                "db_table": "auth_password_reset_tokens",
            },
        ),
        migrations.AddIndex(
            model_name="passwordresettoken",
            index=models.Index(fields=["user", "expires_at"], name="idx_prt_user_expires"),
        ),
    ]
