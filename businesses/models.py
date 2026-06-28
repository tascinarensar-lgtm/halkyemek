from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


User = settings.AUTH_USER_MODEL


class BusinessProfile(models.Model):
    class IyziSubmerchantStatus(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending"
        ACTIVE = "ACTIVE", "Active"
        REJECTED = "REJECTED", "Rejected"
        NEEDS_REVIEW = "NEEDS_REVIEW", "Needs review"

    class PayoutOnboardingStatus(models.TextChoices):
        NONE = "NONE", "None"
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        NEEDS_REVIEW = "NEEDS_REVIEW", "Needs review"

    class District(models.TextChoices):
        BEYLIKDUZU = "BEYLIKDUZU", "Beylikdüzü"

    class ListingType(models.TextChoices):
        CONTRACTED = "CONTRACTED", "Contracted"
        VOLUNTEER = "VOLUNTEER", "Volunteer"

    contact_user = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="contact_business_profiles",
        help_text=(
            "Metadata/KYC contact user only. Business authority is always derived from "
            "BusinessMember, not from this relation."
        ),
    )
    business_name = models.CharField(max_length=255)
    category = models.CharField(max_length=100)

    adress = models.TextField()
    address_line = models.CharField(max_length=255, null=True, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    google_maps_url = models.URLField(null=True, blank=True)
    district = models.CharField(
        max_length=32,
        choices=District.choices,
        default=District.BEYLIKDUZU,
    )

    is_approved = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_listed = models.BooleanField(default=True)
    listing_type = models.CharField(
        max_length=16,
        choices=ListingType.choices,
        default=ListingType.CONTRACTED,
    )
    is_featured = models.BooleanField(default=False)
    display_priority = models.PositiveIntegerField(default=0)
    marketplace_is_visible = models.BooleanField(default=True)
    supports_halkyemek = models.BooleanField(default=True)
    supports_halktasarruf = models.BooleanField(default=False)
    short_description = models.CharField(max_length=280, blank=True, default="")
    intro_text = models.TextField(blank=True, default="")
    badge_text = models.CharField(max_length=64, blank=True, default="")

    payout_onboarding_status = models.CharField(
        max_length=16,
        choices=PayoutOnboardingStatus.choices,
        default=PayoutOnboardingStatus.NONE,
    )
    payout_onboarding_note = models.CharField(max_length=255, blank=True, default="")

    iyzico_submerchant_key = models.CharField(max_length=64, blank=True, default="", db_index=True)
    iyzico_submerchant_status = models.CharField(
        max_length=16,
        choices=IyziSubmerchantStatus.choices,
        default=IyziSubmerchantStatus.DRAFT,
    )
    iyzico_submerchant_type = models.CharField(max_length=32, blank=True, default="PERSONAL")

    kyc_identity_number = models.CharField(max_length=32, blank=True, default="")
    kyc_tax_number = models.CharField(max_length=32, blank=True, default="")
    kyc_tax_office = models.CharField(max_length=255, blank=True, default="")
    kyc_legal_company_title = models.CharField(max_length=255, blank=True, default="")
    kyc_contact_name = models.CharField(max_length=120, blank=True, default="")
    kyc_contact_surname = models.CharField(max_length=120, blank=True, default="")
    kyc_email = models.EmailField(blank=True, default="")
    kyc_gsm_number = models.CharField(max_length=32, blank=True, default="")
    kyc_iban = models.CharField(max_length=64, blank=True, default="")
    kyc_address = models.TextField(blank=True, default="")
    kyc_city = models.CharField(max_length=64, blank=True, default="")
    kyc_country = models.CharField(max_length=64, blank=True, default="Turkey")
    kyc_zip_code = models.CharField(max_length=16, blank=True, default="")

    iyzico_last_error = models.TextField(blank=True, default="")
    iyzico_last_response = models.JSONField(blank=True, default=dict)
    iyzico_last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["district", "is_active"], name="idx_bp_district_active"),
            models.Index(fields=["is_approved", "is_active"], name="idx_bp_approved_active"),
            models.Index(
                fields=["district", "is_active", "is_approved", "is_listed"],
                name="idx_bp_public_list",
            ),
            models.Index(
                fields=["district", "is_active", "is_approved", "is_listed", "marketplace_is_visible"],
                name="idx_bp_marketplace_list",
            ),
            models.Index(
                fields=["is_featured", "display_priority"],
                name="idx_bp_featured_priority",
            ),
        ]

    def __str__(self):
        return self.business_name

    @property
    def is_publicly_visible(self) -> bool:
        return self.is_active and self.is_approved and self.is_listed

    @property
    def is_marketplace_listable(self) -> bool:
        return self.is_publicly_visible and self.marketplace_is_visible

    @property
    def contact_email(self) -> str:
        return str(self.kyc_email or "").strip()

    @property
    def contact_gsm_number(self) -> str:
        return str(self.kyc_gsm_number or "").strip()

    def contact_metadata(self) -> dict:
        """
        Final contact payload for ops/admin surfaces.

        `contact_user_id` is provenance/KYC metadata only. Deliverable contact
        channels come exclusively from explicit business-owned fields.
        """
        return {
            "contact_user_id": self.contact_user_id,
            "email": self.contact_email,
            "gsm_number": self.contact_gsm_number,
        }


class BusinessMember(models.Model):
    class Role(models.TextChoices):
        OWNER = "OWNER", "Owner"
        MANAGER = "MANAGER", "Manager"
        CASHIER = "CASHIER", "Cashier"

    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="business_memberships",
    )
    role = models.CharField(max_length=20, choices=Role.choices)
    is_active = models.BooleanField(default=True)
    access_halkyemek = models.BooleanField(default=True)
    access_halktasarruf = models.BooleanField(default=False)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="granted_business_memberships",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["business", "user"],
                name="uq_business_member_business_user",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "is_active"], name="idx_bm_user_active"),
            models.Index(fields=["business", "is_active"], name="idx_bm_business_active"),
        ]

    def __str__(self):
        return f"{self.user_id} -> {self.business_id} ({self.role})"  # type: ignore


class MarketplaceCategory(models.Model):
    district = models.CharField(
        max_length=32,
        choices=BusinessProfile.District.choices,
        default=BusinessProfile.District.BEYLIKDUZU,
    )
    slug = models.SlugField(max_length=80)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_other = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["district", "sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["district", "slug"],
                name="uq_marketplace_category_district_slug",
            ),
            models.UniqueConstraint(
                fields=["district"],
                condition=models.Q(is_other=True),
                name="uq_marketplace_category_other_per_district",
            ),
        ]
        indexes = [
            models.Index(
                fields=["district", "is_active", "sort_order"],
                name="idx_marketplace_category_list",
            ),
        ]

    def clean(self):
        self.name = (self.name or "").strip()
        self.slug = (self.slug or "").strip().lower()

        errors: dict[str, str] = {}
        if not self.name:
            errors["name"] = "name cannot be blank."
        if not self.slug:
            errors["slug"] = "slug cannot be blank."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class BusinessCategoryAssignment(models.Model):
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="marketplace_categories",
    )
    marketplace_category = models.ForeignKey(
        "businesses.MarketplaceCategory",
        on_delete=models.CASCADE,
        related_name="business_assignments",
    )
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["business", "marketplace_category"],
                name="uq_business_marketplace_category_assignment",
            ),
            models.UniqueConstraint(
                fields=["business"],
                condition=models.Q(is_primary=True, is_active=True),
                name="uq_business_single_active_primary_marketplace_category",
            ),
        ]
        indexes = [
            models.Index(
                fields=["business", "is_active", "sort_order"],
                name="idx_bca_business",
            ),
            models.Index(
                fields=["marketplace_category", "is_active"],
                name="idx_bca_category",
            ),
        ]

    def clean(self):
        errors: dict[str, str] = {}

        if self.is_primary and not self.is_active:
            errors["is_primary"] = "Primary assignment must be active."

        if self.business_id and self.marketplace_category_id:
            if self.business.district != self.marketplace_category.district:
                errors["marketplace_category"] = "Category district must match business district."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
