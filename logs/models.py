from django.db import models
from django.conf import settings

class SystemLog(models.Model):
    class ActionType(models.TextChoices):
        CREATE = "CREATE", "Create" 
        UPDATE = "UPDATE", "Update"
        DELETE = "DELETE", "Delete"
        PAYMENT = "PAYMENT", "Payment"
        QR = "QR", "QR Action"
        LOGIN = "LOGIN", "Login"
        OTHER = "OTHER", "Other"
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )
    action = models.CharField(
        max_length=20,
        choices=ActionType.choices
    )
    description = models.TextField()

    created_at = models.DateTimeField(auto_now_add=True)

    request_id = models.CharField(max_length=64, blank=True, default="")
    ip_address = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.TextField(blank=True, default="")
    path = models.CharField(max_length=255, blank=True, default="")
    method = models.CharField(max_length=16, blank=True, default="")
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)

    # idempotency key gibi ekstra metaları JSON tut
    meta = models.JSONField(null=True, blank=True)

    def __str__(self):
        return f"{self.action} - {self.user}"