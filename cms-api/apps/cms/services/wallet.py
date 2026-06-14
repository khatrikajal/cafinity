from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.cms.models.wallet import CanteenWallet, WalletTransaction, WalletTransactionType


class InsufficientWalletBalance(Exception):
    pass


def _current_month_spent(employee):
    month_start = timezone.localdate().replace(day=1)
    spent = (
        WalletTransaction.objects
        .filter(
            employee=employee,
            transaction_type=WalletTransactionType.DEBIT,
            created_at__date__gte=month_start,
        )
        .aggregate(total=Sum('amount'))
        .get('total')
    )
    return spent or Decimal('0')


def get_or_create_wallet(employee):
    wallet, _ = CanteenWallet.objects.get_or_create(employee=employee)
    return wallet


@transaction.atomic
def credit_wallet(employee, amount, description, reference='', order=None):
    amount = Decimal(str(amount))
    wallet = CanteenWallet.objects.select_for_update().get_or_create(employee=employee)[0]
    wallet.balance += amount
    if reference.startswith('TOPUP'):
        from django.utils import timezone
        wallet.last_recharged_at = timezone.now()
        wallet.save(update_fields=['balance', 'last_recharged_at', 'updated_at'])
    else:
        wallet.save(update_fields=['balance', 'updated_at'])

    return WalletTransaction.objects.create(
        wallet=wallet,
        employee=employee,
        order=order,
        transaction_type=WalletTransactionType.CREDIT,
        amount=amount,
        balance_after=wallet.balance,
        description=description,
        reference=reference,
    )


@transaction.atomic
def debit_wallet(employee, amount, description, reference='', order=None):
    amount = Decimal(str(amount))
    wallet = CanteenWallet.objects.select_for_update().get_or_create(employee=employee)[0]

    if wallet.monthly_spending_limit is not None:
        monthly_spent = _current_month_spent(employee)
        if monthly_spent + amount > wallet.monthly_spending_limit:
            raise InsufficientWalletBalance('Monthly spending limit exceeded.')

    if wallet.balance < amount:
        raise InsufficientWalletBalance('Insufficient wallet balance.')

    wallet.balance -= amount
    wallet.save(update_fields=['balance', 'updated_at'])

    return WalletTransaction.objects.create(
        wallet=wallet,
        employee=employee,
        order=order,
        transaction_type=WalletTransactionType.DEBIT,
        amount=amount,
        balance_after=wallet.balance,
        description=description,
        reference=reference,
    )
