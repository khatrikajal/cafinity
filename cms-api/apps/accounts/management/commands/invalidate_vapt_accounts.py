# Cafinity Security Fix Round 2 — VAPT June 2026 — Invalidate compromised accounts
from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.accounts.models import Employee, User
from apps.cms.models.device import KitchenCounterUser


class Command(BaseCommand):
    help = 'Invalidates all accounts exposed in the VAPT report'

    COMPROMISED_LOGINS = [
        'canteenadmin@gmail.com',
        'cfinity_admin@gmail.com',
        'EMP123',
        'EMP234',
        'emp321',
        'testbac99',
        'thane',
        'Prakvikitchen',
        'LADMIN-200',
    ]

    def handle(self, *args, **options):
        count = 0
        for login in self.COMPROMISED_LOGINS:
            users = User.objects.filter(Q(username=login) | Q(email__iexact=login))
            users = users | User.objects.filter(
                employee_profile__employee_code__iexact=login
            )
            for user in users.distinct():
                user.set_unusable_password()
                user.must_change_password = True
                user.save(update_fields=['password', 'must_change_password'])
                count += 1
                self.stdout.write(f'Invalidated user: {login}')

            employees = Employee.objects.filter(
                Q(employee_code__iexact=login) | Q(email__iexact=login)
            )
            for employee in employees:
                if employee.user_id:
                    employee.user.set_unusable_password()
                    employee.user.must_change_password = True
                    employee.user.save(update_fields=['password', 'must_change_password'])
                    count += 1
                    self.stdout.write(f'Invalidated employee-linked user: {login}')

            device_users = KitchenCounterUser.objects.filter(username__iexact=login, is_active=True)
            for device_user in device_users:
                device_user.is_active = False
                device_user.save(update_fields=['is_active', 'updated_at'])
                count += 1
                self.stdout.write(f'Deactivated device user: {login}')

        self.stdout.write(self.style.SUCCESS(f'Done. {count} accounts require password reset or reactivation.'))
