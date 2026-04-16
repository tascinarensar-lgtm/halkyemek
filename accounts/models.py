from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q


class User(AbstractUser):
    class Role(models.TextChoices):
        CUSTOMER = "CUSTOMER", "Customer"
        ADMIN = "ADMIN", "Admin"

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.CUSTOMER,
    )

    google_sub = models.CharField(max_length=64, blank=True, default="", db_index=True)
    google_email = models.EmailField(blank=True, default="")
    google_email_verified = models.BooleanField(default=False)
    google_picture = models.URLField(blank=True, default="")

    def active_business_memberships(self):
        return self.business_memberships.filter(is_active=True)  # type: ignore[attr-defined]

    def has_business_membership(self) -> bool:
        if not self.is_authenticated:
            return False
        return self.active_business_memberships().exists()

    def business_membership_business_ids(self) -> list[int]:
        if not self.is_authenticated:
            return []
        return list(self.active_business_memberships().values_list("business_id", flat=True))


    def is_admin(self) -> bool:
        return bool(self.is_staff or self.is_superuser or self.role == self.Role.ADMIN)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["google_sub"],
                condition=~Q(google_sub=""),
                name="uq_user_google_sub_nonempty",
            ),
        ]
