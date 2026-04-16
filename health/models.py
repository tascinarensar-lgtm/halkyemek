from django.db import models


class JobHeartbeat(models.Model):
    class Status(models.TextChoices):
        SUCCESS = "SUCCESS", "Success"
        FAILED = "FAILED", "Failed"

    job_name = models.CharField(max_length=128, unique=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUCCESS)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True, default="")
    meta = models.JSONField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["job_name"]

    def __str__(self):
        return f"{self.job_name}:{self.status}"
