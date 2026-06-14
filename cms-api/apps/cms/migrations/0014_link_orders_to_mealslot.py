import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0013_recreate_mealslot_slotmenuitem'),
    ]

    operations = [
        migrations.RenameField(
            model_name='order',
            old_name='slot_id',
            new_name='slot',
        ),
        migrations.AlterField(
            model_name='order',
            name='slot',
            field=models.ForeignKey(
                db_column='slot_id',
                db_constraint=False,
                help_text='The meal slot this order belongs to.',
                on_delete=django.db.models.deletion.PROTECT,
                related_name='slot_orders',
                to='cms.mealslot',
            ),
        ),
    ]
