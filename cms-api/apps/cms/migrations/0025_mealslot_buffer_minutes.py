from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0024_alter_canteenmenuitem_discounted_price'),
    ]

    operations = [
        migrations.AddField(
            model_name='mealslot',
            name='buffer_minutes',
            field=models.PositiveIntegerField(
                default=0,
                help_text='Minutes before start_time when employee ordering closes.',
            ),
        ),
    ]
