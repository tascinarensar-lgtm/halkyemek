from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils.text import slugify

from businesses.models import MarketplaceCategory


DEFAULT_INTERNAL_CATEGORY_NAME = "__SYSTEM_MENU_BUCKET__"


def get_or_create_internal_menu_category(*, business):
    category = Category.objects.filter(
        business=business,
        name=DEFAULT_INTERNAL_CATEGORY_NAME,
    ).first()
    if category is not None:
        return category

    return Category.objects.create(
        business=business,
        name=DEFAULT_INTERNAL_CATEGORY_NAME,
        description="System-managed internal bucket for menu items.",
        sort_order=9999,
        is_active=True,
        is_visible=True,
    )

class Category(models.Model):
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="categories",
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_visible = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["business", "name"],
                name="uq_category_business_name",
            ),
        ]

    def clean(self):
        self.name = (self.name or "").strip()
        if not self.name:
            raise ValidationError({"name": "Category name cannot be blank."})

        if not self.is_active and self.is_visible:
            raise ValidationError(
                {"is_visible": "Inactive category cannot stay visible."}
            )

    def save(self, *args, **kwargs):
        with transaction.atomic():
            previous = None
            if self.pk:
                previous = type(self).objects.filter(pk=self.pk).values(
                    "is_active",
                    "is_visible",
                ).first()

            self.full_clean()
            super().save(*args, **kwargs)

            should_sync_menu_items = False
            if previous is None:
                should_sync_menu_items = (not self.is_active) or (not self.is_visible)
            else:
                should_sync_menu_items = (
                    previous["is_active"] != self.is_active
                    or previous["is_visible"] != self.is_visible
                ) and ((not self.is_active) or (not self.is_visible))

            if should_sync_menu_items:
                updates = {}
                if not self.is_active:
                    updates["is_active"] = False
                if not self.is_visible:
                    updates["is_visible"] = False
                    updates["is_available"] = False

                if updates:
                    type(self).menu_items.rel.related_model.objects.filter(
                        category=self,
                    ).update(**updates)

    def __str__(self):
        return self.name


class MenuItem(models.Model):
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="menu_items",
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="menu_items",
    )
    name = models.CharField(max_length=160)
    slug = models.SlugField(max_length=180, blank=True)
    description = models.TextField(blank=True, default="")
    price_amount = models.PositiveIntegerField()  # kuruş
    image_url = models.URLField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_visible = models.BooleanField(default=True)
    is_available = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["business", "slug"],
                condition=~models.Q(slug=""),
                name="uq_menuitem_business_slug_nonempty",
            ),
        ]
        indexes = [
            models.Index(fields=["business", "is_active", "is_visible"], name="idx_menu_public"),
            models.Index(fields=["category", "is_active", "is_visible"], name="idx_menu_category_public"),
        ]

    def clean(self):
        self.name = (self.name or "").strip()
        if not self.name:
            raise ValidationError({"name": "Menu item name cannot be blank."})

        if self.price_amount <= 0:
            raise ValidationError({"price_amount": "price_amount must be positive."})

        if self.category_id and self.business_id and self.category.business_id != self.business_id:
            raise ValidationError({"category": "Category does not belong to this business."})

        if not self.slug:
            self.slug = slugify(self.name)
        else:
            self.slug = slugify(self.slug)

        if not self.slug:
            raise ValidationError({"slug": "A valid slug could not be generated."})

        if self.category_id:
            if not self.category.is_active and self.is_active:
                raise ValidationError(
                    {"is_active": "Cannot keep menu item active under an inactive category."}
                )
            if not self.category.is_visible and (self.is_visible or self.is_available):
                raise ValidationError(
                    {"is_visible": "Cannot keep menu item visible or available under a hidden category."}
                )
            if not self.category.is_active and (self.is_visible or self.is_available):
                raise ValidationError(
                    {"is_active": "Cannot keep menu item visible or available under an inactive category."}
                )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class MenuItemMarketplaceCategoryAssignment(models.Model):
    menu_item = models.ForeignKey(
        "menus.MenuItem",
        on_delete=models.CASCADE,
        related_name="marketplace_category_assignments",
    )
    marketplace_category = models.ForeignKey(
        "businesses.MarketplaceCategory",
        on_delete=models.CASCADE,
        related_name="menu_item_assignments",
    )
    is_primary = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["menu_item", "marketplace_category"],
                name="uq_menuitem_marketplace_category_assignment",
            ),
            models.UniqueConstraint(
                fields=["menu_item"],
                condition=models.Q(is_primary=True),
                name="uq_menuitem_single_primary_marketplace_category",
            ),
        ]
        indexes = [
            models.Index(
                fields=["menu_item", "sort_order"],
                name="idx_mimca_menu_item",
            ),
            models.Index(
                fields=["marketplace_category", "sort_order"],
                name="idx_mimca_marketplace_category",
            ),
        ]

    def clean(self):
        errors: dict[str, str] = {}

        if self.menu_item_id and self.marketplace_category_id:
            if self.menu_item.business.district != self.marketplace_category.district:
                errors["marketplace_category"] = "Category district must match menu item business district."

        if self.is_primary and self.sort_order != 0:
            self.sort_order = 0

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class MediaAsset(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "IMAGE", "Image"
        VIDEO = "VIDEO", "Video"
        DOCUMENT = "DOCUMENT", "Document"

    class AssetRole(models.TextChoices):
        GALLERY = "GALLERY", "Gallery"
        COVER = "COVER", "Cover"
        LOGO = "LOGO", "Logo"
        THUMBNAIL = "THUMBNAIL", "Thumbnail"

    business = models.ForeignKey(
        "businesses.BusinessProfile",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="media_assets",
    )
    menu_item = models.ForeignKey(
        "menus.MenuItem",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="media_assets",
    )
    marketplace_category = models.ForeignKey(
        "businesses.MarketplaceCategory",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="media_assets",
    )
    offer = models.ForeignKey(
        "menus.BusinessOffer",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="media_assets",
    )
    file_url = models.URLField(blank=True, default="")
    file_path = models.CharField(max_length=512, blank=True, default="")
    media_type = models.CharField(max_length=16, choices=MediaType.choices, default=MediaType.IMAGE)
    asset_role = models.CharField(max_length=16, choices=AssetRole.choices, default=AssetRole.GALLERY)
    alt_text = models.CharField(max_length=255, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    uploaded_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_media_assets",
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        indexes = [
            models.Index(fields=["business", "is_active", "sort_order"], name="idx_mediaasset_business_public"),
            models.Index(fields=["menu_item", "is_active", "sort_order"], name="idx_mediaasset_menu_public"),
            models.Index(fields=["marketplace_category", "is_active", "sort_order"], name="idx_mediaasset_category_public"),
            models.Index(fields=["offer", "is_active", "sort_order"], name="idx_mediaasset_offer_public"),
        ]

    def clean(self):
        errors: dict[str, str] = {}

        if not self.file_url and not self.file_path:
            errors["file_url"] = "Either file_url or file_path must be provided."

        effective_business_target = bool(self.business_id)
        if self.menu_item_id and self.business_id == self.menu_item.business_id:
            effective_business_target = False
        if self.offer_id and self.business_id == self.offer.business_id:
            effective_business_target = False

        target_count = sum(
            bool(target_id)
            for target_id in [
                self.menu_item_id,
                self.marketplace_category_id,
                self.offer_id,
            ]
        ) + int(effective_business_target)
        if target_count != 1:
            errors["business"] = "MediaAsset must be attached to exactly one target."

        if self.menu_item_id:
            if self.business_id and self.menu_item.business_id != self.business_id:
                errors["menu_item"] = "Menu item business mismatch."
            if not self.business_id:
                self.business = self.menu_item.business

        if self.offer_id:
            if self.business_id and self.offer.business_id != self.business_id:
                errors["offer"] = "Offer business mismatch."
            if not self.business_id:
                self.business = self.offer.business

        if self.marketplace_category_id and self.business_id:
            if self.business.district != self.marketplace_category.district:
                errors["marketplace_category"] = "Category district must match business district."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        file_path = str(self.file_path or "").strip()
        result = super().delete(*args, **kwargs)
        if file_path:
            from menus.media_storage import delete_stored_media_file_if_unused

            delete_stored_media_file_if_unused(file_path=file_path)
        return result


class BusinessOffer(models.Model):
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="offers",
    )
    menu_item = models.ForeignKey(
        "menus.MenuItem",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="offers",
    )
    title = models.CharField(max_length=160)
    short_description = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField(blank=True, default="")
    label = models.CharField(max_length=64, blank=True, default="")
    tag = models.CharField(max_length=64, blank=True, default="")
    offer_price_amount = models.PositiveIntegerField(help_text="Kuruş cinsinden kampanya fiyatı")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    daily_limit = models.PositiveIntegerField(null=True, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        indexes = [
            models.Index(fields=["business", "is_active", "starts_at", "ends_at"], name="idx_offer_business_window"),
            models.Index(fields=["is_active", "is_featured", "sort_order"], name="idx_offer_featured_list"),
        ]

    def clean(self):
        self.title = (self.title or "").strip()
        if not self.title:
            raise ValidationError({"title": "title cannot be blank."})

        errors: dict[str, str] = {}
        if self.offer_price_amount <= 0:
            errors["offer_price_amount"] = "offer_price_amount must be positive."

        if self.ends_at <= self.starts_at:
            errors["ends_at"] = "ends_at must be later than starts_at."

        if self.daily_limit is not None and int(self.daily_limit) <= 0:
            errors["daily_limit"] = "daily_limit must be positive when provided."

        if self.menu_item_id and self.menu_item.business_id != self.business_id:
            errors["menu_item"] = "Menu item does not belong to this business."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
