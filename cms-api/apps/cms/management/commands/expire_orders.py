from django.core.management.base import BaseCommand

from apps.cms.models.order import Order
from apps.cms.services.orders import expire_due_orders


class Command(BaseCommand):
    help = "Expire undelivered canteen orders two hours after their slot ends."

    def add_arguments(self, parser):
        parser.add_argument(
            "--canteen-id",
            dest="canteen_id",
            help="Limit expiry to one canteen UUID.",
        )

    def handle(self, *args, **options):
        queryset = Order.objects.all()
        if options.get("canteen_id"):
            queryset = queryset.filter(canteen_id=options["canteen_id"])

        expired_count = expire_due_orders(queryset)
        self.stdout.write(self.style.SUCCESS(f"Expired {expired_count} order(s)."))
