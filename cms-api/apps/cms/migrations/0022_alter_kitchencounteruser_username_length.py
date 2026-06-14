from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0021_merge_0020_specialdish_0020_mealslot_categories'),
    ]

    operations = [
        migrations.AlterField(
            model_name='kitchencounteruser',
            name='username',
            field=models.CharField(max_length=100, unique=True),
        ),
    ]
