from __future__ import annotations

from dataclasses import asdict, dataclass

from notifications.models import Device
from notifications.token_utils import is_demo_fcm_token


@dataclass(frozen=True)
class NotificationReadinessStatus:
    notification_ready: bool
    bypass_applied: bool
    code: str
    message: str
    active_device_count: int
    active_permitted_device_count: int
    inactive_device_count: int
    denied_permission_device_count: int

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def evaluate_notification_readiness(*, user) -> NotificationReadinessStatus:
    if not user or not getattr(user, "is_authenticated", False):
        return NotificationReadinessStatus(
            notification_ready=False,
            bypass_applied=False,
            code="auth_required",
            message="Bildirim ayarlarini gormek icin once giris yapmaniz gerekiyor.",
            active_device_count=0,
            active_permitted_device_count=0,
            inactive_device_count=0,
            denied_permission_device_count=0,
        )

    is_admin_fn = getattr(user, "is_admin", None)
    if callable(is_admin_fn) and bool(is_admin_fn()):
        return NotificationReadinessStatus(
            notification_ready=True,
            bypass_applied=True,
            code="admin_bypass",
            message="Yonetici yetkisi nedeniyle bildirim zorunlulugu asildi.",
            active_device_count=0,
            active_permitted_device_count=0,
            inactive_device_count=0,
            denied_permission_device_count=0,
        )

    user_devices = Device.objects.filter(user=user)
    real_user_devices = user_devices.exclude(fcm_token__startswith="demo-")
    active_device_count = real_user_devices.filter(is_active=True).count()
    active_permitted_device_count = real_user_devices.filter(is_active=True, permission_granted=True).count()
    inactive_device_count = real_user_devices.filter(is_active=False).count()
    denied_permission_device_count = real_user_devices.filter(is_active=True, permission_granted=False).count()

    if active_permitted_device_count > 0:
        return NotificationReadinessStatus(
            notification_ready=True,
            bypass_applied=False,
            code="ready",
            message="Bu hesap icin en az bir aktif ve izinli cihaz hazir gorunuyor.",
            active_device_count=active_device_count,
            active_permitted_device_count=active_permitted_device_count,
            inactive_device_count=inactive_device_count,
            denied_permission_device_count=denied_permission_device_count,
        )

    if not user_devices.exists():
        code = "no_registered_device"
        message = "Bu hesapta henuz kayitli bir bildirim cihazi gorunmuyor. Bu cihazi hazirlayarak bildirimleri acabilirsiniz."
    elif not real_user_devices.exists() and any(is_demo_fcm_token(device.fcm_token) for device in user_devices.only("fcm_token")):
        code = "demo_device_only"
        message = "Bu hesapta yalnizca eski demo cihaz kaydi gorunuyor. Canli bildirim almak icin bu tarayiciyi yeniden hazirlayin."
    elif active_device_count == 0:
        code = "no_active_device"
        message = "Kayitli cihazlar pasif gorunuyor. Bildirim akisina devam etmek icin bu cihazi yeniden etkinlestirin."
    else:
        code = "permission_not_granted"
        message = "Bildirim izni kapali gorunuyor. Siparis ve bakiye bildirimleri icin tarayici iznini acin."

    return NotificationReadinessStatus(
        notification_ready=False,
        bypass_applied=False,
        code=code,
        message=message,
        active_device_count=active_device_count,
        active_permitted_device_count=active_permitted_device_count,
        inactive_device_count=inactive_device_count,
        denied_permission_device_count=denied_permission_device_count,
    )
