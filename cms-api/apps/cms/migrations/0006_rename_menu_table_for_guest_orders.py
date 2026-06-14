from django.db import migrations


def rename_existing_menu_table(apps, schema_editor):
    existing_tables = schema_editor.connection.introspection.table_names()
    old_table = 'cms_menu_items'
    new_table = 'cms_canteen_menu_items'

    if old_table in existing_tables and new_table not in existing_tables:
        quote_name = schema_editor.quote_name
        schema_editor.execute(
            f'ALTER TABLE {quote_name(old_table)} RENAME TO {quote_name(new_table)}'
        )


class Migration(migrations.Migration):

    dependencies = [
        ('cms', '0005_unique_menu_item_name_per_canteen'),
    ]

    operations = [
        migrations.RunPython(rename_existing_menu_table, migrations.RunPython.noop),
    ]
