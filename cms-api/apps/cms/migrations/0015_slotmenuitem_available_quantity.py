# Generated manually for slot-level stock per menu item.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cms", "0014_link_orders_to_mealslot"),
    ]

    operations = [
        migrations.AddField(
            model_name="slotmenuitem",
            name="available_quantity",
            field=models.PositiveIntegerField(
                blank=True,
                help_text="Total portions available for this item in this slot across all employees. Empty = no slot-level cap.",
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="slotmenuitem",
            name="max_qty_per_order",
            field=models.PositiveIntegerField(
                default=4,
                help_text="Maximum quantity of this dish one employee may order in a single order for this slot.",
            ),
        ),
    ]
