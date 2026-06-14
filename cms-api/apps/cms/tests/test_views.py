"""
test_views.py

Fixes applied vs original:
  BUG 8 FIX  — Import path normalised to `apps.cms.models` (was `cms.models`).
  BUG 5 FIX  — Added test for toggle_status with irrelevant body keys to verify
                the `if 'status' in request.data` guard works correctly.
  BUG 9 NOTE — res.data['id'] vs a.id comparison: safe while PK is integer.
                If model migrates to UUID PK, change to `str(a.id)`.
  NEW TEST   — test_search_special_dish: verifies special_dish icontains search.
  NEW TEST   — test_toggle_status_irrelevant_body: sends body without 'status'
                key — should flip (not 400), verifying BUG 5 fix in the view.
"""

from rest_framework.test import APITestCase, APIClient
from rest_framework import status
from datetime import date, time

from apps.accounts.models import Company, Department, Employee, RoleChoices, User
from apps.cms.models import Announcement, CanteenLocation, GuestOrder  # BUG 8 FIX
from apps.notifications.models import Notification


def make_announcement(**kwargs):
    defaults = {
        'title': 'View Test',
        'message': 'msg',
        'date': date(2026, 5, 11),
        'time_from': time(7, 0),
        'time_to': time(9, 0),
        'special_dish': 'Dosa',
        'status': Announcement.STATUS_ACTIVE,
    }
    defaults.update(kwargs)
    return Announcement.objects.create(**defaults)


BASE = '/api/v1/cms/announcements/'


class CanteenAuthenticationTests(APITestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Canteen Security Co', code='CSC')
        self.canteen = CanteenLocation.objects.create(
            company=self.company,
            name='Secured Canteen',
            is_active=True,
        )
        self.other_company = Company.objects.create(name='Other Security Co', code='OSC')
        self.other_canteen = CanteenLocation.objects.create(
            company=self.other_company,
            name='Other Canteen',
            is_active=True,
        )
        self.department = Department.objects.create(company=self.company, name='Operations')
        self.limited_user = User.objects.create_user(
            username='limited-security-admin',
            password='pass12345',
            role_type=RoleChoices.LIMITED_ADMIN,
        )
        self.limited_employee = Employee.objects.create(
            user=self.limited_user,
            company=self.company,
            department=self.department,
            canteen=self.canteen,
            employee_code='LIMITED-SEC',
            first_name='Limited',
            last_name='Admin',
            email='limited-security@example.com',
            is_active=True,
        )
        self.admin_user = User.objects.create_user(
            username='canteen-security-admin',
            password='pass12345',
            role_type=RoleChoices.SUPER_ADMIN,
            is_staff=True,
            is_superuser=True,
        )

    def test_anonymous_canteen_list_and_detail_are_rejected_on_all_url_aliases(self):
        urls = [
            '/api/v1/canteens/',
            f'/api/v1/canteens/{self.canteen.id}/',
            '/api/v1/cms/canteens/',
            f'/api/v1/cms/canteens/{self.canteen.id}/',
        ]

        for url in urls:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
                self.assertNotContains(response, self.company.name, status_code=401)
                self.assertNotContains(response, str(self.canteen.id), status_code=401)

    def test_authenticated_user_can_access_canteen_list_and_detail(self):
        self.client.force_authenticate(
            user=self.admin_user,
            token={
                'user_id': str(self.admin_user.id),
                'role_type': RoleChoices.SUPER_ADMIN,
            },
        )

        list_response = self.client.get('/api/v1/canteens/')
        detail_response = self.client.get(f'/api/v1/canteens/{self.canteen.id}/')

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['id'], str(self.canteen.id))

    def _authenticate_limited_admin(self):
        self.client.force_authenticate(
            user=self.limited_user,
            token={
                'user_id': str(self.limited_user.id),
                'employee_id': str(self.limited_employee.id),
                'company_id': str(self.company.id),
                'canteen_id': str(self.canteen.id),
                'role_type': RoleChoices.LIMITED_ADMIN,
            },
        )

    def test_limited_admin_is_restricted_to_approved_modules_and_assigned_canteen(self):
        GuestOrder.objects.create(
            canteen=self.canteen,
            guest_name='Assigned Guest',
            phone='9000000001',
        )
        GuestOrder.objects.create(
            canteen=self.other_canteen,
            guest_name='Other Guest',
            phone='9000000002',
        )
        self._authenticate_limited_admin()

        denied_urls = [
            '/api/v1/kitchen/stats/',
            '/api/v1/admin/reports/sales/',
            '/api/v1/admin/employees/search/?emp_id=LIMITED-SEC',
            '/api/v1/cms/devices/',
        ]
        for url in denied_urls:
            with self.subTest(denied=url):
                self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN)

        self.assertEqual(
            self.client.post(
                '/api/v1/canteens/',
                {'name': 'Blocked', 'company_id': str(self.company.id)},
                format='json',
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(f'/api/v1/canteens/{self.other_canteen.id}/').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.get(
                f'/api/v1/canteens/{self.other_canteen.id}/menu/categories/'
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )

        allowed_urls = [
            '/api/v1/admin/dashboard/',
            f'/api/v1/canteens/{self.canteen.id}/menu/categories/',
            '/api/v1/slots/',
            '/api/v1/admin/orders/',
            '/api/v1/counter/orders/DOES-NOT-EXIST/',
            '/api/v1/guest-orders/',
            '/api/v1/announcements/',
            '/api/v1/notifications/',
        ]
        expected_statuses = [200, 200, 200, 200, 404, 200, 200, 200]
        for url, expected in zip(allowed_urls, expected_statuses):
            with self.subTest(allowed=url):
                self.assertEqual(self.client.get(url).status_code, expected)

        guest_response = self.client.get('/api/v1/guest-orders/')
        guest_body = guest_response.content.decode()
        self.assertIn('Assigned Guest', guest_body)
        self.assertNotIn('Other Guest', guest_body)

    def test_super_admin_retains_cross_canteen_access(self):
        self.client.force_authenticate(
            user=self.admin_user,
            token={
                'user_id': str(self.admin_user.id),
                'role_type': RoleChoices.SUPER_ADMIN,
            },
        )

        self.assertEqual(self.client.get('/api/v1/admin/dashboard/').status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.client.get(f'/api/v1/canteens/{self.other_canteen.id}/').status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(self.client.get('/api/v1/guest-orders/').status_code, status.HTTP_200_OK)


class AnnouncementViewTest(APITestCase):

    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_user(
            username='announcement-admin',
            password='pass12345',
            role_type=RoleChoices.CANTEEN_ADMIN,
        )
        self.client.force_authenticate(
            user=self.admin_user,
            token={"role_type": RoleChoices.CANTEEN_ADMIN, "user_id": str(self.admin_user.id)},
        )

    def test_create_201(self):
        payload = {
            'title': 'Iftar Celebration',
            'message': 'Refreshment served.',
            'date': '2026-05-11',
            'time_from': '07:00:00',
            'time_to': '09:00:00',
            'special_dish': 'Dosa',
            'status': 'active',
        }
        res = self.client.post(BASE, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['title'], 'Iftar Celebration')
        self.assertEqual(res.data['time_range'], '07:00 — 09:00')

    def test_create_and_update_create_employee_notifications(self):
        company = Company.objects.create(name="Acme", code="ACME")
        department = Department.objects.create(company=company, name="Ops")
        user = User.objects.create_user(username="emp-notify", password="pass12345")
        employee = Employee.objects.create(
            user=user,
            company=company,
            department=department,
            employee_code="EMP-NOTIFY",
            first_name="Nikita",
            last_name="Ahire",
            email="nikita.notify@example.com",
            is_active=True,
        )
        payload = {
            'title': 'Lunch Update',
            'message': 'Refreshment served.',
            'date': '2026-05-11',
            'time_from': '07:00:00',
            'time_to': '09:00:00',
            'special_dish': 'Dosa',
            'status': 'active',
        }

        created = self.client.post(BASE, payload, format='json')
        updated = self.client.patch(
            f"{BASE}{created.data['id']}/",
            {'message': 'Refreshment and tea served.'},
            format='json',
        )

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        notifications = Notification.objects.filter(recipient=employee).order_by('created_at')
        self.assertEqual(notifications.count(), 2)
        self.assertIn("New announcement", notifications[0].title)
        self.assertIn("Announcement updated", notifications[1].title)

    def test_create_invalid_time_range_400(self):
        payload = {
            'title': 'Bad',
            'date': '2026-05-11',
            'time_from': '09:00:00',
            'time_to': '07:00:00',
        }
        res = self.client.post(BASE, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_title_too_long_400(self):
        payload = {
            'title': 'A' * 81,
            'date': '2026-05-11',
            'time_from': '07:00:00',
            'time_to': '09:00:00',
        }
        res = self.client.post(BASE, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_200(self):
        make_announcement()
        make_announcement(title='Second', status=Announcement.STATUS_INACTIVE)
        res = self.client.get(BASE)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 2)

    def test_filter_active(self):
        make_announcement(status=Announcement.STATUS_ACTIVE)
        make_announcement(title='Inactive', status=Announcement.STATUS_INACTIVE)
        res = self.client.get(BASE, {'status': 'active'})
        self.assertEqual(res.data['count'], 1)

    def test_search_title(self):
        make_announcement(title='Iftar Party')
        make_announcement(title='Lunch')
        res = self.client.get(BASE, {'search': 'iftar'})
        self.assertEqual(res.data['count'], 1)

    def test_search_special_dish(self):
        """Verify special_dish is included in icontains search."""
        make_announcement(title='A', special_dish='Biryani')
        make_announcement(title='B', special_dish='Idli')
        res = self.client.get(BASE, {'search': 'biryani'})
        self.assertEqual(res.data['count'], 1)

    def test_retrieve_200(self):
        a = make_announcement()
        res = self.client.get(f'{BASE}{a.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # BUG 9 NOTE: safe for integer PK; use str(a.id) if migrated to UUID.
        self.assertEqual(res.data['id'], a.id)

    def test_retrieve_404(self):
        res = self.client.get(f'{BASE}9999/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_partial_update_200(self):
        a = make_announcement()
        res = self.client.patch(f'{BASE}{a.id}/', {'title': 'Updated'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['title'], 'Updated')

    def test_full_update_200(self):
        a = make_announcement()
        payload = {
            'title': 'Full Update',
            'message': 'new msg',
            'date': '2026-06-01',
            'time_from': '08:00:00',
            'time_to': '10:00:00',
            'special_dish': 'Idli',
            'status': 'active',
        }
        res = self.client.put(f'{BASE}{a.id}/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['title'], 'Full Update')

    def test_delete_204(self):
        a = make_announcement()
        res = self.client.delete(f'{BASE}{a.id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Announcement.objects.filter(id=a.id).exists())

    def test_toggle_status_flip(self):
        a = make_announcement(status=Announcement.STATUS_ACTIVE)
        res = self.client.patch(f'{BASE}{a.id}/toggle_status/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], Announcement.STATUS_INACTIVE)

    def test_toggle_status_explicit(self):
        a = make_announcement(status=Announcement.STATUS_ACTIVE)
        res = self.client.patch(
            f'{BASE}{a.id}/toggle_status/', {'status': 'inactive'}, format='json'
        )
        self.assertEqual(res.data['status'], Announcement.STATUS_INACTIVE)

    def test_toggle_status_irrelevant_body_still_flips(self):
        """
        BUG 5 FIX verification: sending a body without the 'status' key
        must flip (not raise 400). Original `if request.data:` guard would
        have tried to validate the body and returned 400.
        """
        a = make_announcement(status=Announcement.STATUS_ACTIVE)
        res = self.client.patch(
            f'{BASE}{a.id}/toggle_status/', {'unrelated_key': 'value'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], Announcement.STATUS_INACTIVE)

    def test_stats(self):
        make_announcement(status=Announcement.STATUS_ACTIVE, special_dish='Dosa')
        make_announcement(status=Announcement.STATUS_INACTIVE, special_dish='')
        res = self.client.get(f'{BASE}stats/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['total'], 2)
        self.assertEqual(res.data['active'], 1)
        self.assertEqual(res.data['inactive'], 1)
        self.assertEqual(res.data['with_special_dish'], 1)
