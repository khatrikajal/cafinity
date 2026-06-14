"""
Migration: 0010_announcement_remove_slotmenuitem_slot_and_more

ROOT CAUSE OF FAILURE:
  Django auto-generated this migration with operations in the wrong order:
    1. Create Announcement                     ← OK
    2. Remove field 'slot' from SlotMenuItem   ← OK
    3. Alter unique_together for SlotMenuItem  ← CRASH — 'slot' field already gone

  The unique_together constraint ("slot", "menu_item_id") references the 'slot'
  field. Django tried to DROP the constraint AFTER the column was already removed,
  so it couldn't find the field → FieldDoesNotExist.

FIX:
  Reorder so unique_together is cleared FIRST (step 2), THEN the field is removed (step 3).
  Correct order:
    1. Create Announcement
    2. Alter unique_together → empty set  (drop the constraint while 'slot' still exists)
    3. Remove field 'slot' from SlotMenuItem
    4. Delete model MealSlot (after all FK references are removed)
    5. Delete model SlotMenuItem (after MealSlot is gone)
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        # Keep your original dependency — do not change this
        ('cms', '0009_merge_20260511_1341'),  # ← replace with your actual previous migration name
    ]

    operations = [
        # ── STEP 1: Create the Announcement table ─────────────────────────────
        migrations.CreateModel(
            name='Announcement',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=80)),
                ('message', models.CharField(blank=True, default='', max_length=280)),
                ('date', models.DateField()),
                ('time_from', models.TimeField()),
                ('time_to', models.TimeField()),
                ('special_dish', models.CharField(blank=True, default='', max_length=255)),
                ('status', models.CharField(
                    choices=[('active', 'Active'), ('inactive', 'Inactive')],
                    default='active',
                    max_length=10,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-date', '-time_from'],
                'app_label': 'cms',
            },
        ),

        # ── STEP 2: Clear unique_together BEFORE removing the 'slot' field ────
        #
        # THIS IS THE FIX.
        # Django's auto-generator put step 3 (RemoveField) before this, which
        # meant it tried to drop the constraint after the column was gone.
        # We move AlterUniqueTogether FIRST so the constraint is dropped while
        # the 'slot' column still exists in the DB.
        migrations.AlterUniqueTogether(
            name='slotmenuitem',
            unique_together=set(),  # clear the ("slot", "menu_item_id") constraint
        ),

        # ── STEP 3: Remove the slot FK field from SlotMenuItem ────────────────
        #
        # Now safe — the unique_together that referenced it is already dropped.
        migrations.RemoveField(
            model_name='slotmenuitem',
            name='slot',
        ),

        # ── STEP 4: Delete MealSlot ────────────────────────────────────────────
        #
        # Safe now — no FK from SlotMenuItem pointing to it anymore.
        migrations.DeleteModel(
            name='MealSlot',
        ),

        # ── STEP 5: Delete SlotMenuItem ───────────────────────────────────────
        migrations.DeleteModel(
            name='SlotMenuItem',
        ),
    ]