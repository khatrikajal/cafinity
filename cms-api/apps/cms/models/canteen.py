import uuid
from django.db import models


class CanteenLocation(models.Model):
    """
    cms_canteen_locations

    One record per physical canteen.
    A company can have multiple canteens.
    Tenant root for all cms_ queries — every queryset filters by company_id.

    Phase 2 note: company and location FK constraints activate against
    live HRMS tables. No column changes required.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Schema: company_id UUID FK companies(id) NOT NULL
    company = models.ForeignKey(
        'accounts.Company',
        on_delete=models.PROTECT,
        related_name='canteen_locations',
    )

    # Schema: location_id UUID FK mst_location(id)  NULLABLE
    location = models.ForeignKey(
        'accounts.Location',
        on_delete=models.PROTECT,
        related_name='canteen_locations',
       null=True,blank=True
    )

    name = models.CharField(max_length=150)

  
    address_floor = models.TextField(blank=True, default='')

  
    capacity = models.PositiveIntegerField(null=True, blank=True)

 
    contact_person = models.CharField(max_length=200, blank=True, default='')

   
    contact_mobile = models.CharField(max_length=20, blank=True, default='')


    operating_hours_start = models.TimeField(null=True, blank=True)
    operating_hours_end   = models.TimeField(null=True, blank=True)

   
    is_active = models.BooleanField(default=True)


    created_by = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_canteen_locations',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)   

    class Meta:
        db_table = 'cms_canteen_locations'
        ordering = ['name']

    def __str__(self):
        return self.name

    @property
    def is_deleted(self):
        return self.deleted_at is not None


