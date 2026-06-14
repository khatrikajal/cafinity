from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0025_mealslot_buffer_minutes'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name='order',
                    name='version',
                    field=models.PositiveIntegerField(default=1),
                ),
            ],
        ),
    ]
