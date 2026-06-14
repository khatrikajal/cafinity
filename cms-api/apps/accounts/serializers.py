"""
apps/accounts/serializers.py

Employee API serializers with frontend ↔ backend field mapping.
"""
# Cafinity Security Fix — VAPT June 2026 — XSS sanitization on text inputs

from rest_framework import serializers
from django.conf import settings
from django.db import transaction
import secrets
import string

from .models import Company, Employee, Department, User, RoleChoices
from .email_service import send_employee_credentials_email
from apps.cms.models.canteen import CanteenLocation
from apps.core.mixins import SanitizeInputMixin


class CompanySerializer(SanitizeInputMixin, serializers.ModelSerializer):
    """Serializer for company management endpoints."""

    class Meta:
        model = Company
        fields = ['id', 'name', 'code', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Company name is required.')
        return value

    def validate_code(self, value):
        value = (value or '').strip().upper()
        if not value:
            raise serializers.ValidationError('Company code is required.')
        return value


class DepartmentSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    """Lightweight department info for nested serialization."""
    
    class Meta:
        model = Department
        fields = ['id', 'name']


class EmployeeListSerializer(serializers.ModelSerializer):
    """
    Reduced list serializer — excludes sensitive PII (email, phone, address).
    """

    employeeId = serializers.CharField(source='employee_code', read_only=True)
    firstName = serializers.CharField(source='first_name', read_only=True)
    fullName = serializers.CharField(source='full_name', read_only=True)
    roleType = serializers.CharField(source='user.role_type', read_only=True)
    canteenId = serializers.UUIDField(source='canteen_id', read_only=True)
    canteenName = serializers.CharField(source='canteen.name', allow_null=True, read_only=True)
    department = serializers.CharField(source='department.name', allow_null=True, read_only=True)
    isActive = serializers.BooleanField(source='is_active', read_only=True)

    class Meta:
        model = Employee
        fields = [
            'id', 'employeeId', 'firstName', 'fullName', 'roleType',
            'department', 'canteenId', 'canteenName', 'isActive',
        ]


class EmployeeDetailSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    
    """
    Detail view serializer for create/update/retrieve.
    Maps frontend input (firstName, lastName, employee_code) to backend (first_name, last_name, employee_code).
    """
    FIELDS_TO_SANITIZE = [
        'firstName', 'lastName', 'address', 'designation', 'email', 'phone', 'employee_code',
    ]
    FIELDS_TO_REJECT_HTML = [
        "firstName",
        "lastName",
        "address",
        "designation",
        "employee_code",
    ]
    
    # Read-only output fields
    employeeId = serializers.CharField(source='employee_code', read_only=True)
    fullName = serializers.CharField(source='full_name', read_only=True)
    isActive = serializers.BooleanField(source='is_active', read_only=True)
    roleType = serializers.CharField(required=False)
    
    # Write-only input fields
    employee_code = serializers.CharField(max_length=20, required=True, write_only=True)  
    firstName = serializers.CharField(write_only=True, max_length=100, required=True)
    lastName = serializers.CharField(write_only=True, max_length=100, required=False, allow_blank=True)
    
    # Email field with explicit validation
    email = serializers.EmailField(required=True, allow_blank=False)
    
    # FK field
    departmentId = serializers.PrimaryKeyRelatedField(
        source='department',
        queryset=Department.objects.all(),
        allow_null=True,
        required=False
    )
    canteenId = serializers.PrimaryKeyRelatedField(
        source='canteen',
        queryset=CanteenLocation.objects.none(),
        allow_null=True,
        required=False
    )
    
    # Validate gender choices
    gender = serializers.ChoiceField(
        choices=['Male', 'Female', 'Other', ''],
        required=False,
        allow_blank=True
    )
    
    # Nested read-only for response
    department = DepartmentSerializer(read_only=True)
    canteenName = serializers.CharField(source='canteen.name', allow_null=True, read_only=True)
    
    # Date field
    joiningDate = serializers.DateField(source='joining_date', required=False, allow_null=True)
    
    class Meta:
        model = Employee
        fields = [
            'id', 'employeeId', 'employee_code', 'firstName', 'lastName', 'fullName',
            'email', 'phone', 'designation', 'roleType', 'departmentId', 'department', 'canteenId', 'canteenName',
            'joiningDate', 'gender', 'address', 'created_at', 'updated_at', 'isActive'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'employeeId', 'fullName', 'department', 'isActive']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        canteen_qs = CanteenLocation.objects.filter(is_active=True, deleted_at__isnull=True).select_related('company')
        company_id = self._request_company_id()
        if company_id:
            canteen_qs = canteen_qs.filter(company_id=company_id)

        self.fields['canteenId'].queryset = canteen_qs.order_by('name')

    def _request_company_id(self):
        request = self.context.get('request')
        if request is None:
            return None

        company_id = getattr(request, 'tenant_company_id', None)
        if company_id:
            return company_id

        auth_payload = getattr(request, 'auth', None)
        if auth_payload is not None and hasattr(auth_payload, 'get'):
            company_id = auth_payload.get('company_id')
            if company_id:
                return company_id

        employee = getattr(request.user, 'employee_profile', None)
        return getattr(employee, 'company_id', None)

    def _resolve_company(self, validated_data, fallback_instance=None):
        company = validated_data.get('company')
        if company:
            return company

        if fallback_instance is not None and fallback_instance.company_id:
            return fallback_instance.company

        company_id = self._request_company_id()
        if not company_id:
            return None

        return Company.objects.filter(id=company_id, is_active=True).first()

    def _resolve_default_canteen(self, company):
        if company is None:
            return None

        existing_default = CanteenLocation.objects.filter(
            company=company,
            name='Default Canteen',
            deleted_at__isnull=True,
        ).order_by('-is_active', 'name', 'id').first()
        if existing_default:
            if not existing_default.is_active:
                existing_default.is_active = True
                existing_default.save(update_fields=['is_active', 'updated_at'])
            return existing_default

        active_canteen = CanteenLocation.objects.filter(
            company=company,
            is_active=True,
            deleted_at__isnull=True,
        ).order_by('name', 'id').first()
        if active_canteen:
            return active_canteen

        return CanteenLocation.objects.create(
            company=company,
            name='Default Canteen',
            is_active=True,
            address_floor='',
            contact_person='',
            contact_mobile='',
        )

    @staticmethod
    def _generate_secure_password(length=12):
        """
        Generate a secure random password with upper/lower/numeric/special chars.
        """
        if length < 12:
            length = 12

        uppercase = string.ascii_uppercase
        lowercase = string.ascii_lowercase
        digits = string.digits
        special = "!@#$%^&*()-_=+[]{}|;:,.<>?"

        required_chars = [
            secrets.choice(uppercase),
            secrets.choice(lowercase),
            secrets.choice(digits),
            secrets.choice(special),
        ]
        all_chars = uppercase + lowercase + digits + special
        remaining_chars = [secrets.choice(all_chars) for _ in range(length - len(required_chars))]

        password_chars = required_chars + remaining_chars
        secrets.SystemRandom().shuffle(password_chars)
        return "".join(password_chars)
    
    def create(self, validated_data):
        """Create Employee + linked User in one transaction."""
        role_type = validated_data.pop('roleType', RoleChoices.EMPLOYEE)
        canteen = validated_data.pop('canteen', None)
        first_name_raw = validated_data.pop('firstName', '')
        last_name_raw = validated_data.pop('lastName', '')
        first_name = first_name_raw.strip() if first_name_raw else ''
        last_name = last_name_raw.strip() if last_name_raw else ''
        email = (validated_data.get('email') or '').strip()
        employee_code = validated_data.get('employee_code', '').strip()
        company = self._resolve_company(validated_data)
        if company is None and canteen is not None:
            company = canteen.company

        validated_data['first_name'] = first_name
        validated_data['last_name'] = last_name
        validated_data['email'] = email
        validated_data['employee_code'] = employee_code
        if company is not None:
            validated_data['company'] = company

        if canteen is None:
            canteen = self._resolve_default_canteen(company)
        if canteen is not None:
            validated_data['canteen'] = canteen

        raw_password = self._generate_secure_password()
        self.temporary_password = raw_password

        with transaction.atomic():
            user = User(
                username=employee_code,
                email=email,
                first_name=first_name,
                last_name=last_name,
                role_type=role_type,
                is_active=True,
                must_change_password=True,  # Force password reset on first login
            )
            user.set_password(raw_password)
            user.save()

            employee = super().create(validated_data)
            employee.user = user
            employee.save(update_fields=['user'])

            login_url = getattr(settings, 'EMPLOYEE_LOGIN_URL', '').strip()

            transaction.on_commit(
                lambda: send_employee_credentials_email(
                    to_email=employee.email,
                    employee_name=employee.full_name,
                    username=user.username,
                    raw_password=raw_password,
                    login_url=login_url,
                    employee_id=employee.employee_code,
                )
            )

        return employee
    
    def update(self, instance, validated_data):
        """
        Handle field mapping during update.
        """
        role_type = validated_data.pop('roleType', None)
        
        canteen_in_payload = 'canteen' in validated_data
        canteen = validated_data.pop('canteen', None)
        if 'firstName' in validated_data:
            fn = validated_data.pop('firstName')
            validated_data['first_name'] = fn.strip() if fn else ''
        if 'lastName' in validated_data:
            ln = validated_data.pop('lastName')
            validated_data['last_name'] = ln.strip() if ln else ''

        company = self._resolve_company(validated_data, fallback_instance=instance)
        if company is None and canteen is not None:
            company = canteen.company
            validated_data['company'] = company
        if canteen_in_payload and canteen is not None:
            validated_data['canteen'] = canteen
        elif canteen_in_payload and canteen is None:
            default_canteen = self._resolve_default_canteen(company)
            if default_canteen is not None:
                validated_data['canteen'] = default_canteen

        # Capture incoming values before they are consumed by super().update
        incoming_emp_code = validated_data.get('employee_code') if 'employee_code' in validated_data else None
        incoming_email = validated_data.get('email') if 'email' in validated_data else None

        employee = super().update(instance, validated_data)

        # Synchronize changes to linked User where necessary so login continues to work
        try:
            user = employee.user
            user_changed = False

            # If employee_code was provided in payload, keep username in sync
            if incoming_emp_code and isinstance(incoming_emp_code, str) and incoming_emp_code.strip() and user.username != incoming_emp_code.strip():
                user.username = incoming_emp_code.strip()
                user_changed = True

            # If email provided in payload, update user's email too
            if incoming_email is not None and isinstance(incoming_email, str):
                new_email = incoming_email.strip()
                if user.email != new_email:
                    user.email = new_email
                    user_changed = True

            if role_type is not None and user.role_type != role_type:
                user.role_type = role_type
                user_changed = True

            if user_changed:
                user.save()
        except Exception:
            # Do not block employee update completion if user sync fails; log at higher level if needed
            pass

        return employee
    
    def validate(self, data):
        """Validate required fields and ensure they're not empty."""
        # Check if firstName is provided and not empty. The UI accepts single-word
        # names, so lastName is optional.
        first_name = str(data.get('firstName', '')).strip() if data.get('firstName') else ''
        last_name = str(data.get('lastName', '')).strip() if data.get('lastName') else ''
        
        if not first_name:
            raise serializers.ValidationError({'firstName': 'First name is required and cannot be empty.'})
        
        # Validate full name length (firstName + lastName combined)
        full_name = f"{first_name} {last_name}".strip()
        if len(full_name) > 50:
            raise serializers.ValidationError({
                'fullName': 'Full name (first name + last name) cannot exceed 50 characters.'
            })
        
        # Validate designation length
        designation = str(data.get('designation', '')).strip() if data.get('designation') else ''
        if designation and len(designation) > 50:
            raise serializers.ValidationError({
                'designation': 'Designation cannot exceed 50 characters.'
            })

        canteen = data.get('canteen')
        company = data.get('company') or self._resolve_company(data, fallback_instance=self.instance)
        if canteen and company and canteen.company_id != company.id:
            raise serializers.ValidationError({'canteenId': 'Selected canteen does not belong to this company.'})

        
        role_type = data.get("roleType")

        allowed_roles = {
            RoleChoices.EMPLOYEE,
            RoleChoices.LIMITED_ADMIN,
        }

        if role_type and role_type not in allowed_roles:
            raise serializers.ValidationError({
                "roleType": (
                    "Only Employee and Limited Admin roles can be assigned "
                    "when creating or updating employees."
                )
            })

        return super().validate(data)

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        representation['roleType'] = (
            instance.user.role_type
            if instance.user_id and instance.user
            else RoleChoices.EMPLOYEE
        )
        return representation
            
    
    def validate_email(self, value):
        """Check email uniqueness on create, allow existing on update."""
        if not value:
            raise serializers.ValidationError("Email is required.")
        
        value = value.strip().lower()
        instance = self.instance
        
        if instance is None:  # Create
            if Employee.objects.filter(email=value).exists():
                raise serializers.ValidationError("An employee with this email already exists.")
            if User.objects.filter(email=value).exists():
                raise serializers.ValidationError("A user account with this email already exists.")
        else:  # Update
            if Employee.objects.filter(email=value).exclude(id=instance.id).exists():
                raise serializers.ValidationError("Another employee with this email already exists.")
            if User.objects.filter(email=value).exclude(id=instance.user.id).exists():
                raise serializers.ValidationError("Another user with this email already exists.")
        
        return value
    
    def validate_phone(self, value):
        """Validate phone: must be exactly 10 digits, no special characters."""
        if not value:
            return value
        
        value = value.strip()
        
        # Check if it contains only digits (no spaces, hyphens, or any special chars)
        if not value.isdigit():
            raise serializers.ValidationError("Phone number must contain only digits. Special characters, letters, spaces, and hyphens are not allowed.")
        
        # Check if it's exactly 10 digits
        if len(value) != 10:
            raise serializers.ValidationError("Phone number must be exactly 10 digits.")
        
        return value
    
    def validate_employee_code(self, value):
        """Validate employee_code: max 10 characters, check uniqueness."""
        if not value:
            raise serializers.ValidationError("Employee ID is required.")
        
        value = value.strip()
        
        # Check max length
        if len(value) > 10:
            raise serializers.ValidationError("Employee ID cannot exceed 10 characters.")
        
        # Check uniqueness
        instance = self.instance
        if instance is None:  # Create
            if Employee.objects.filter(employee_code=value).exists():
                raise serializers.ValidationError("Employee with this ID already exists.")
            if User.objects.filter(username=value).exists():
                raise serializers.ValidationError("A user account with this employee ID already exists.")
        else:  # Update
            if Employee.objects.filter(employee_code=value).exclude(id=instance.id).exists():
                raise serializers.ValidationError("Employee with this ID already exists.")

            # Keep Employee.employee_code and linked User.username unique together.
            if User.objects.filter(username=value).exclude(id=instance.user_id).exists():
                raise serializers.ValidationError("A user account with this employee ID already exists.")
        
        return value

    
class EmployeeSearchSerializer(serializers.Serializer):
    """Query parameter serializer for filtering."""
    search = serializers.CharField(required=False, allow_blank=True)
    department = serializers.CharField(required=False, allow_blank=True)
    page = serializers.IntegerField(required=False, default=1, min_value=1)
    page_size = serializers.IntegerField(required=False, default=10, min_value=10, max_value=100)


class EmployeeBulkCreateSerializer(serializers.Serializer):
    """Bulk create serializer — accepts list of employees."""
    
    employees = EmployeeDetailSerializer(many=True)
    
    def create(self, validated_data):
        """Create multiple employees, skipping those that fail validation."""
        created = []
        failed = []
        
        for idx, emp_data in enumerate(validated_data.get('employees', [])):
            serializer = EmployeeDetailSerializer(data=emp_data)
            if serializer.is_valid():
                try:
                    created.append(serializer.save())
                except Exception as e:
                    failed.append({
                        'row': idx + 1,
                        'email': emp_data.get('email', 'unknown'),
                        'error': str(e)
                    })
            else:
                failed.append({
                    'row': idx + 1,
                    'email': emp_data.get('email', 'unknown'),
                    'errors': serializer.errors
                })
        
        # Store errors in instance for response
        self.created_employees = created
        self.failed_employees = failed
        
        return created
