from django.contrib import admin
from apps.cms.models.device import KitchenCounterUser
from apps.cms.models.canteen import CanteenLocation
from apps.cms.models.guest_order import MenuItem, GuestOrder, GuestOrderItem
from apps.cms.models.menu import CanteenMenuItem
from apps.cms.models.announcement import Announcement
from apps.cms.models.special_dish import SpecialDish


@admin.register(MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = ['name', 'price', 'category', 'slot', 'live']
    list_filter = ['category', 'slot', 'live']
    search_fields = ['name', 'description']


@admin.register(GuestOrder)
class GuestOrderAdmin(admin.ModelAdmin):
    list_display = ['id', 'guest_name', 'phone', 'status', 'total', 'created_at']
    list_filter = ['status', 'created_at']
    search_fields = ['id', 'guest_name', 'phone']
    readonly_fields = ['id', 'created_at']


@admin.register(GuestOrderItem)
class GuestOrderItemAdmin(admin.ModelAdmin):
    list_display = ['order', 'name', 'qty', 'price', 'is_custom']
    list_filter = ['is_custom']
    search_fields = ['name']


 
 
@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ('title', 'date', 'time_from', 'time_to', 'special_dish', 'status', 'created_at')
    list_filter = ('status', 'date')
    search_fields = ('title', 'message', 'special_dish')
    list_editable = ('status',)
    ordering = ('-date', '-time_from')
    readonly_fields = ('created_at', 'updated_at')
    fieldsets = (
        ('Content', {
            'fields': ('title', 'message', 'special_dish'),
        }),
        ('Schedule', {
            'fields': ('date', 'time_from', 'time_to'),
        }),
        ('Status', {
            'fields': ('status',),
        }),
        ('Metadata', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )


@admin.register(SpecialDish)
class SpecialDishAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)
    ordering = ('name',)
 

admin.site.register(KitchenCounterUser)
admin.site.register(CanteenLocation)


@admin.register(CanteenMenuItem)
class CanteenMenuItemAdmin(admin.ModelAdmin):
    list_display = ('name', 'base_price', 'discounted_price', 'category', 'is_available', 'is_active')
    list_filter = ('is_available', 'is_active', 'category')
    search_fields = ('name', 'description')
    readonly_fields = ('created_at', 'updated_at')
