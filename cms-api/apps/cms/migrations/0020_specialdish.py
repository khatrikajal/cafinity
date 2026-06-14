from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0019_remove_mealslot_label'),
    ]

    operations = [
        migrations.CreateModel(
            name='SpecialDish',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['name'],
            },
        ),
    ]
