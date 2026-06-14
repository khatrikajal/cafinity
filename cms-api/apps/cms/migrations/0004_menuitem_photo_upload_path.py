# Generated manually to store menu item images in MEDIA_ROOT/item-image/.

import apps.cms.models.menu
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0003_menucategory_menuitem_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='canteenmenuitem',
            name='photo',
            field=models.ImageField(
                blank=True,
                help_text='Stored in MEDIA_ROOT/item-image/ with the item name in the file path.',
                null=True,
                upload_to=apps.cms.models.menu.menu_item_photo_upload_to,
            ),
        ),
    ]
