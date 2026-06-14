#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')
django.setup()

from apps.cms.models.canteen import CanteenLocation
from apps.accounts.models import Company, Location

# Ensure a company exists
company, _ = Company.objects.get_or_create(
    code="DEFAULT",
    defaults={
        "name": "Default Company",
        "is_active": True,
    },
)

# Ensure a location exists for the canteen
location, _ = Location.objects.get_or_create(
    company=company,
    name="Main Office",
    defaults={
        "city": "",
        "state": "",
        "country": "India",
        "timezone": "Asia/Kolkata",
        "is_active": True,
    },
)

# Create a canteen
canteen, created = CanteenLocation.objects.get_or_create(
    name="Main Canteen",
    company=company,
    defaults={
        "location": location,
        "is_active": True,
    }
)

print(f"Canteen {'created' if created else 'already exists'}")
print(f"Canteen ID: {canteen.id}")
print(f"Canteen Name: {canteen.name}")
