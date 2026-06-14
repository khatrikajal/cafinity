from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.http import HttpResponse
from django.test import RequestFactory, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.email_service import _send_email_sync
from apps.accounts.models import Company, Department, Employee, RoleChoices, User
from apps.accounts.serializers import EmployeeDetailSerializer
from apps.cms.models.canteen import CanteenLocation
from apps.common.middleware import SecureApiErrorMiddleware


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    DEFAULT_FROM_EMAIL='Cafinity <no-reply@example.com>',
    EMAIL_REPLY_TO='support@example.com',
)
class EmployeeCredentialEmailTests(APITestCase):
    def test_credentials_email_uses_transactional_sender_metadata(self):
        _send_email_sync(
            to_email='employee@example.com',
            employee_name='Test Employee',
            username='EMP001',
            raw_password='ExamplePassword123!',
            login_url='https://cms.example.com/login',
            employee_id='EMP001',
        )

        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.subject, 'Your Cafinity account is ready')
        self.assertEqual(message.from_email, 'Cafinity <no-reply@example.com>')
        self.assertEqual(message.reply_to, ['support@example.com'])
        self.assertEqual(message.extra_headers['Auto-Submitted'], 'auto-generated')
        self.assertEqual(message.extra_headers['X-Auto-Response-Suppress'], 'All')
        self.assertIn('One-time password: ExamplePassword123!', message.body)
        self.assertNotIn('Action Required', message.subject)
        self.assertEqual(message.alternatives[0][1], 'text/html')


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class EmployeeOtpAuthTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.company = Company.objects.create(name='Acme', code='ACME')
        self.department = Department.objects.create(company=self.company, name='Ops')

        self.employee_user = User.objects.create_user(
            username='emp1',
            password='pass12345',
            role_type=RoleChoices.EMPLOYEE,
            email='emp1@example.com',
            first_name='Emp',
            last_name='One',
        )
        self.employee = Employee.objects.create(
            user=self.employee_user,
            company=self.company,
            employee_code='E001',
            first_name='Emp',
            last_name='One',
            email='emp1@example.com',
            department=self.department,
            is_active=True,
        )

        self.admin_user = User.objects.create_user(
            username='admin1',
            password='pass12345',
            role_type=RoleChoices.CANTEEN_ADMIN,
            email='admin1@example.com',
            first_name='Admin',
            last_name='One',
        )

    def test_login_rejects_invalid_role_value(self):
        response = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'emp1', 'password': 'pass12345', 'role': 'supervisor'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data, {'detail': 'Invalid login credentials.'})

    def test_login_failures_do_not_disclose_account_or_role(self):
        attempts = [
            {'login_id': 'missing-user', 'password': 'pass12345', 'role': 'employee'},
            {'login_id': 'emp1', 'password': 'wrong-password', 'role': 'employee'},
            {'login_id': 'emp1', 'password': 'pass12345', 'role': 'admin'},
            {'login_id': 'admin1', 'password': 'pass12345', 'role': 'employee'},
            {'login_id': 'emp1', 'password': 'pass12345', 'role': 'invalid'},
        ]

        responses = [
            self.client.post('/api/v1/auth/login/', attempt, format='json')
            for attempt in attempts
        ]

        for response in responses:
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(response.data, {'detail': 'Invalid login credentials.'})

    def test_inactive_account_uses_generic_login_failure(self):
        self.employee_user.is_active = False
        self.employee_user.save(update_fields=['is_active'])

        response = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'emp1', 'password': 'pass12345', 'role': 'employee'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data, {'detail': 'Invalid login credentials.'})

    def test_superuser_with_stale_employee_role_can_login_as_admin(self):
        stale_admin = User.objects.create_user(
            username='stale-admin',
            password='pass12345',
            role_type=RoleChoices.EMPLOYEE,
            email='stale-admin@example.com',
            is_staff=True,
            is_superuser=True,
        )
        User.objects.filter(pk=stale_admin.pk).update(role_type=RoleChoices.EMPLOYEE)

        response = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'stale-admin', 'password': 'pass12345', 'role': 'admin'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data.get('role_type'), RoleChoices.SUPER_ADMIN)

    def test_request_otp_rejects_admin_role_param(self):
        response = self.client.post(
            '/api/v1/auth/otp/request/',
            {'login_id': 'admin1', 'role': 'admin'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_request_otp_rejects_non_employee_user(self):
        response = self.client.post(
            '/api/v1/auth/otp/request/',
            {'login_id': 'admin1', 'role': 'employee'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_verify_otp_rejects_admin_role_param(self):
        response = self.client.post(
            '/api/v1/auth/otp/verify/',
            {'login_id': 'admin1', 'otp': '123456', 'role': 'admin'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_verify_otp_rejects_non_employee_user(self):
        response = self.client.post(
            '/api/v1/auth/otp/verify/',
            {'login_id': 'admin1', 'otp': '123456', 'role': 'employee'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_verify_otp_rejects_non_digit_code(self):
        response = self.client.post(
            '/api/v1/auth/otp/verify/',
            {'login_id': 'E001', 'otp': '12AB56', 'role': 'employee'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @patch('apps.accounts.views._generate_otp', return_value='123456')
    def test_employee_can_verify_otp_after_login_challenge(self, _mock_otp):
        self.employee_user.require_otp_after_password_change = True
        self.employee_user.must_change_password = False
        self.employee_user.save(update_fields=['require_otp_after_password_change', 'must_change_password'])

        login_response = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'E001', 'password': 'pass12345', 'role': 'employee'},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(login_response.data['action_required'], 'otp_verification')
        otp_reference = login_response.data['otp_reference']

        # Simulate verification reaching another Gunicorn worker with an empty
        # local-memory cache. The signed reference must carry the challenge.
        cache.clear()

        verify_response = self.client.post(
            '/api/v1/auth/otp/verify/',
            {
                'login_id': 'E001',
                'otp': '123456',
                'otp_reference': otp_reference,
                'role': 'employee',
            },
            format='json',
        )
        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        self.assertIn('access', verify_response.data)
        self.assertIn('refresh', verify_response.data)
        self.assertEqual(verify_response.data.get('role_type'), RoleChoices.EMPLOYEE)

        self.employee_user.refresh_from_db()
        self.assertFalse(self.employee_user.require_otp_after_password_change)

        replay_response = self.client.post(
            '/api/v1/auth/otp/verify/',
            {
                'login_id': 'E001',
                'otp': '123456',
                'otp_reference': otp_reference,
                'role': 'employee',
            },
            format='json',
        )
        self.assertEqual(replay_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_request_otp_requires_login_challenge(self):
        response = self.client.post(
            '/api/v1/auth/otp/request/',
            {'login_id': 'E001', 'role': 'employee'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_login_with_must_change_password_returns_reset_token(self):
        self.employee_user.must_change_password = True
        self.employee_user.save(update_fields=['must_change_password'])

        response = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'E001', 'password': 'pass12345', 'role': 'employee'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['action_required'], 'password_reset')
        self.assertTrue(response.data.get('reset_token'))

    def test_password_reset_confirm_requires_valid_reset_token(self):
        response = self.client.post(
            '/api/v1/auth/password-reset/confirm/',
            {'reset_token': 'invalid-token', 'password': 'newpass123'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_password_reset_confirm_sets_otp_requirement(self):
        self.employee_user.must_change_password = True
        self.employee_user.save(update_fields=['must_change_password'])

        login_response = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'E001', 'password': 'pass12345', 'role': 'employee'},
            format='json',
        )
        reset_token = login_response.data['reset_token']

        response = self.client.post(
            '/api/v1/auth/password-reset/confirm/',
            {'reset_token': reset_token, 'password': 'newpass123'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.employee_user.refresh_from_db()
        self.assertFalse(self.employee_user.must_change_password)
        self.assertTrue(self.employee_user.require_otp_after_password_change)

    @patch('apps.accounts.views._generate_otp', return_value='654321')
    def test_first_login_reset_then_direct_otp_verification(self, _mock_otp):
        self.employee_user.must_change_password = True
        self.employee_user.save(update_fields=['must_change_password'])

        temporary_login = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'E001', 'password': 'pass12345', 'role': 'employee'},
            format='json',
        )
        reset_response = self.client.post(
            '/api/v1/auth/password-reset/confirm/',
            {
                'reset_token': temporary_login.data['reset_token'],
                'password': 'newpass123',
            },
            format='json',
        )
        self.assertEqual(reset_response.status_code, status.HTTP_200_OK)

        new_password_login = self.client.post(
            '/api/v1/auth/login/',
            {'login_id': 'E001', 'password': 'newpass123', 'role': 'employee'},
            format='json',
        )
        self.assertEqual(new_password_login.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(new_password_login.data['action_required'], 'otp_verification')
        self.assertTrue(new_password_login.data['otp_reference'])

        cache.clear()
        verify_response = self.client.post(
            '/api/v1/auth/otp/verify/',
            {
                'login_id': 'E001',
                'otp': '654321',
                'otp_reference': new_password_login.data['otp_reference'],
                'role': 'employee',
            },
            format='json',
        )

        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        self.assertIn('access', verify_response.data)
        self.assertIn('refresh', verify_response.data)

    @override_settings(FRONTEND_URL='http://localhost:5173', DEBUG=True)
    def test_password_reset_request_sends_email_and_returns_debug_token(self):
        response = self.client.post(
            '/api/v1/auth/password-reset/request/',
            {'login_id': 'E001'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('debug_reset_token', response.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('/reset-password?token=', mail.outbox[0].body)


class ServerPathDisclosureTests(APITestCase):
    @override_settings(DEBUG=True)
    def test_media_root_is_not_served_or_disclosed(self):
        response = self.client.get('/media/')
        body = response.content.decode(errors='replace')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertNotIn(str(settings.MEDIA_ROOT), body)
        self.assertNotIn('/opt/cms-api', body)
        self.assertNotIn('Traceback', body)

    def test_malformed_password_reset_does_not_disclose_server_path(self):
        response = self.client.post(
            '/api/v1/auth/password-reset/confirm/',
            {
                'uid': '00000000-0000-0000-0000-000000000000',
                'token': 'test',
                'password': 'Test1234!',
            },
            format='json',
        )
        body = response.content.decode(errors='replace')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data, {'detail': 'reset_token and password are required.'})
        self.assertNotIn(str(settings.BASE_DIR), body)
        self.assertNotIn('/opt/cms-api', body)
        self.assertNotIn('Traceback', body)

    @override_settings(DEBUG=False)
    def test_forgot_password_alias_does_not_disclose_internal_architecture(self):
        response = self.client.post(
            '/api/v1/auth/forgot-password/',
            {'login_id': 'yacit33018@aspensif.com', 'role': 'employee'},
            format='json',
        )
        body = response.content.decode(errors='replace')
        disclosed_values = [
            '172.22.1.33',
            '172.22.1.19',
            '172.22.1.34',
            '5432',
            '8012',
            '0.0.0.0',
            'gunicorn',
            'nginx',
            'postgresql',
            'Traceback',
            str(settings.BASE_DIR),
        ]

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {'detail': 'If a matching account exists, password reset instructions have been sent to the registered email.'},
        )
        for value in disclosed_values:
            self.assertNotIn(value.lower(), body.lower())
        self.assertNotIn('Server', response.headers)
        self.assertNotIn('X-Powered-By', response.headers)

    @override_settings(DEBUG=False)
    @patch('apps.accounts.views.resolve_employee_identity', side_effect=RuntimeError('database 172.22.1.34:5432'))
    def test_forgot_password_hides_identity_service_errors(self, _mock_resolve):
        response = self.client.post(
            '/api/v1/auth/forgot-password/',
            {'login_id': 'employee@example.com', 'role': 'employee'},
            format='json',
        )
        body = response.content.decode(errors='replace')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('172.22.1.34', body)
        self.assertNotIn('5432', body)
        self.assertNotIn('RuntimeError', body)

    @override_settings(DEBUG=False)
    @patch('apps.accounts.views.send_employee_password_reset_email', side_effect=RuntimeError('smtp via 172.22.1.19'))
    def test_forgot_password_hides_email_delivery_errors(self, _mock_send):
        company = Company.objects.create(name='Reset Security Co', code='RSC')
        department = Department.objects.create(company=company, name='Ops')
        user = User.objects.create_user(
            username='reset-security-user',
            password='pass12345',
            role_type=RoleChoices.EMPLOYEE,
            email='reset-security@example.com',
        )
        Employee.objects.create(
            user=user,
            company=company,
            department=department,
            employee_code='RESET-SEC',
            first_name='Reset',
            last_name='Security',
            email='reset-security@example.com',
            is_active=True,
        )

        response = self.client.post(
            '/api/v1/auth/forgot-password/',
            {'login_id': 'RESET-SEC', 'role': 'employee'},
            format='json',
        )
        body = response.content.decode(errors='replace')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('172.22.1.19', body)
        self.assertNotIn('smtp', body.lower())
        self.assertNotIn('RuntimeError', body)

    @override_settings(DEBUG=False)
    def test_uncaught_api_errors_use_generic_json_and_strip_implementation_headers(self):
        request = RequestFactory().post('/api/v1/example/')
        middleware = SecureApiErrorMiddleware(lambda _request: HttpResponse())

        error_response = middleware.process_exception(
            request,
            RuntimeError('gunicorn 172.22.1.33 database 172.22.1.34:5432'),
        )
        header_response = HttpResponse(headers={
            'Server': 'gunicorn/26.0.0',
            'X-Powered-By': 'internal-app',
        })
        scrubbed_response = SecureApiErrorMiddleware(lambda _request: header_response)(request)

        self.assertEqual(error_response.status_code, 500)
        self.assertJSONEqual(error_response.content, {'detail': 'An internal error occurred.'})
        self.assertNotIn('Server', scrubbed_response.headers)
        self.assertNotIn('X-Powered-By', scrubbed_response.headers)


class EmployeeSerializerValidationTests(APITestCase):
    def setUp(self):
        self.company = Company.objects.create(name='Acme', code='ACM2')
        self.department = Department.objects.create(company=self.company, name='Ops')
        self.user = User.objects.create_user(
            username='E100',
            password='pass12345',
            role_type=RoleChoices.EMPLOYEE,
            email='dup@example.com',
        )
        self.employee = Employee.objects.create(
            user=self.user,
            company=self.company,
            employee_code='E100',
            first_name='Dup',
            last_name='User',
            email='dup@example.com',
            department=self.department,
            is_active=True,
        )
        self.canteen = CanteenLocation.objects.create(
            company=self.company,
            name='Main Canteen',
            is_active=True,
        )

    def test_employee_code_conflict_is_rejected(self):
        serializer = EmployeeDetailSerializer(data={
            'employee_code': 'E100',
            'firstName': 'New',
            'lastName': 'User',
            'email': 'new@example.com',
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn('employee_code', serializer.errors)

    def test_email_conflict_is_rejected(self):
        serializer = EmployeeDetailSerializer(data={
            'employee_code': 'E101',
            'firstName': 'New',
            'lastName': 'User',
            'email': 'dup@example.com',
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn('email', serializer.errors)

    def test_role_type_is_saved_on_create(self):
        serializer = EmployeeDetailSerializer(data={
            'employee_code': 'E102',
            'firstName': 'Admin',
            'lastName': 'User',
            'email': 'admin.user@example.com',
            'roleType': RoleChoices.LIMITED_ADMIN,
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        employee = serializer.save()

        self.assertEqual(employee.user.role_type, RoleChoices.LIMITED_ADMIN)

    def test_blank_last_name_is_allowed_on_create(self):
        serializer = EmployeeDetailSerializer(data={
            'employee_code': 'E105',
            'firstName': 'Nikita',
            'lastName': '',
            'email': 'nikita@example.com',
            'roleType': RoleChoices.EMPLOYEE,
            'departmentId': str(self.department.id),
            'canteenId': str(self.canteen.id),
            'designation': 'AI Developer',
            'phone': '2365478965',
            'joiningDate': '2026-06-17',
            'gender': 'Female',
            'address': 'pathardi phata\npathardi phata',
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        employee = serializer.save(company=self.company)

        self.assertEqual(employee.last_name, '')
        self.assertEqual(employee.user.last_name, '')

    def test_canteen_is_saved_on_create_when_provided(self):
        serializer = EmployeeDetailSerializer(data={
            'employee_code': 'E103',
            'firstName': 'Canteen',
            'lastName': 'Mapped',
            'email': 'canteen.mapped@example.com',
            'canteenId': str(self.canteen.id),
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        employee = serializer.save(company=self.company)

        self.assertEqual(employee.canteen_id, self.canteen.id)

    def test_default_canteen_is_assigned_when_not_provided(self):
        serializer = EmployeeDetailSerializer(data={
            'employee_code': 'E104',
            'firstName': 'Auto',
            'lastName': 'Default',
            'email': 'auto.default@example.com',
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
        employee = serializer.save(company=self.company)

        self.assertIsNotNone(employee.canteen_id)
