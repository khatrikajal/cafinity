"""
Reusable email helpers for accounts app.
"""

import logging
import threading

from apps.common.email_utils import send_templated_email

logger = logging.getLogger(__name__)


def _send_email_sync(to_email, employee_name, username, raw_password, login_url, employee_id=None):
    """Send the employee account setup message synchronously."""
    subject = "Your Cafinity account is ready"
    emp_id_str = f"\nEmployee ID: {employee_id}" if employee_id else ""
    text_body = (
        f"Hello {employee_name},\n\n"
        "Your Cafinity employee account is ready.\n\n"
        f"Login URL: {login_url}\n"
        f"Username: {username}{emp_id_str}\n"
        f"One-time password: {raw_password}\n\n"
        "You will be asked to choose a new password when you first sign in.\n"
        "If you were not expecting this account, contact your administrator.\n\n"
        "Regards,\n"
        "Cafinity Support"
    )

    try:
        send_templated_email(
            subject=subject,
            to_email=to_email,
            template="accounts/emails/employee_credentials.html",
            context={
                "email_title": "Your Cafinity account is ready",
                "recipient_name": employee_name,
                "login_url": login_url,
                "cta_url": login_url,
                "cta_label": "Log In",
                "username": username,
                "employee_id": employee_id,
                "raw_password": raw_password,
            },
            text_body=text_body,
        )
        logger.info("Successfully sent employee credentials email to %s", to_email)
    except Exception:
        logger.exception("Failed sending employee credentials email to %s", to_email)


def send_employee_credentials_email(*, to_email, employee_name, username, raw_password, login_url, employee_id=None):
    """
    Send employee login credentials asynchronously in a background thread.
    Includes employee ID and temporary password with forced reset instruction.
    Returns immediately without waiting for the email to be sent.
    """
    thread = threading.Thread(
        target=_send_email_sync,
        args=(to_email, employee_name, username, raw_password, login_url, employee_id),
        daemon=True,
    )
    thread.start()


def _send_password_reset_email_sync(to_email, employee_name, reset_url):
    subject = "Reset your Cafinity password"

    text_body = (
        f"Hello {employee_name},\n\n"
        "We received a request to reset your Cafinity password.\n\n"
        f"Reset your password here: {reset_url}\n\n"
        "This link will expire soon. If you did not request this, you can ignore this email.\n\n"
        "Regards,\n"
        "Cafinity Support"
    )

    try:
        send_templated_email(
            subject=subject,
            to_email=to_email,
            template="accounts/emails/password_reset.html",
            context={
                "email_title": "Password Reset Request",
                "recipient_name": employee_name,
                "cta_url": reset_url,
                "cta_label": "Reset Password",
            },
            text_body=text_body,
        )
        logger.info("Successfully sent password reset email to %s", to_email)
    except Exception:
        logger.exception("Failed sending password reset email to %s", to_email)
        raise


def send_employee_password_reset_email(*, to_email, employee_name, reset_url):
    _send_password_reset_email_sync(to_email, employee_name, reset_url)


def _send_employee_otp_email_sync(to_email, employee_name, otp_code, otp_ttl_seconds):
    subject = "Your Cafinity verification code"
    otp_valid_minutes = max(1, otp_ttl_seconds // 60)
    text_body = (
        f"Hello {employee_name},\n\n"
        f"Your OTP is: {otp_code}\n"
        f"It expires in {otp_valid_minutes} minute(s).\n\n"
        "If you did not request this, ignore this email."
    )

    try:
        send_templated_email(
            subject=subject,
            to_email=to_email,
            template="accounts/emails/employee_otp.html",
            context={
                "email_title": "Employee OTP Verification",
                "recipient_name": employee_name,
                "otp_code": otp_code,
                "otp_valid_minutes": otp_valid_minutes,
            },
            text_body=text_body,
        )
        logger.info("Successfully sent OTP email to %s", to_email)
    except Exception:
        logger.exception("Failed sending OTP email to %s", to_email)
        raise


def send_employee_otp_email(*, to_email, employee_name, otp_code, otp_ttl_seconds):
    thread = threading.Thread(
        target=_send_employee_otp_email_sync,
        args=(to_email, employee_name, otp_code, otp_ttl_seconds),
        daemon=True,
    )
    thread.start()


def _send_set_password_otp_email_sync(to_email, employee_name, otp_code):
    subject = "Verify your new Cafinity password"
    text_body = (
        f"Your OTP to confirm password change: {otp_code}\n"
        "Valid for 10 minutes."
    )

    try:
        send_templated_email(
            subject=subject,
            to_email=to_email,
            template="accounts/emails/employee_otp.html",
            context={
                "email_title": "Verify Your New Password",
                "recipient_name": employee_name,
                "otp_code": otp_code,
                "otp_valid_minutes": 10,
            },
            text_body=text_body,
        )
        logger.info("Successfully sent set-password OTP email to %s", to_email)
    except Exception:
        logger.exception("Failed sending set-password OTP email to %s", to_email)
        raise


def send_set_password_otp_email(*, to_email, employee_name, otp_code):
    thread = threading.Thread(
        target=_send_set_password_otp_email_sync,
        args=(to_email, employee_name, otp_code),
        daemon=True,
    )
    thread.start()
