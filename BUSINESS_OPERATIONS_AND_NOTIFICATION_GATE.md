# Business Operations and Notification Gate (Sprint 4)

Bu dokuman Sprint 4 kapsaminda business operasyon yuzeyi ve notification gate urun kuralini ozetler.

## Business Operations API

### Dashboard summary

- `GET /api/v1/businesses/<business_id>/operations/dashboard-summary/`
- OWNER / MANAGER / CASHIER (ve ADMIN) erisebilir.
- Donen bloklar:
  - `consume_today`: bugun consume edilen adet + toplam tutar
  - `sessions.pending`: bekleyen oturumlar
  - `sessions.latest_consumed`: son consume edilenler
  - `offers`: aktif/canli/featured ozet
  - `media`: vitrin/medya gorunurluk ozetleri
  - `showcase`: listing/featured/visibility bayraklari
  - `finance`: earning + payout ozetleri (cashier icin role-aware kisitli)

### Consume history

- `GET /api/v1/businesses/<business_id>/operations/consume-history/`
- OWNER / MANAGER / CASHIER (ve ADMIN) erisebilir.
- Sadece yetkili business scope doner.
- Pagination: default DRF pagination.
- Opsiyonel filtreler:
  - `consumed_after`
  - `consumed_before`

### Order detail (business surface)

- `GET /api/v1/businesses/<business_id>/operations/orders/<order_id>/`
- OWNER / MANAGER / CASHIER (ve ADMIN) erisebilir.
- Object-level scope zorunlu: order mutlaka ilgili business'e ait olmalidir.

### Business profile operations

- `GET /api/v1/businesses/<business_id>/operations/profile/`
  - role + editable alan matrix'i doner.
- `PATCH /api/v1/businesses/<business_id>/operations/profile/`
  - OWNER / MANAGER (ve ADMIN) update edebilir.

#### Member tarafinda guncellenebilen alanlar

- `short_description`
- `intro_text`
- `badge_text`
- `marketplace_is_visible`

#### Sadece admin update edebilir

- `listing_type` (contracted/volunteer)
- `is_featured`
- `display_priority`

## Business Offer Operations

- `GET/POST /api/v1/businesses/<business_id>/offers/`
- `GET/PATCH/DELETE /api/v1/businesses/<business_id>/offers/<offer_id>/`
- OWNER / MANAGER (ve ops-admin yetkisi olanlar) hedef surface.
- CASHIER bu endpointlerde yonetim yapamaz.

## Consume Preview (Cashier Surface)

- `GET /api/v1/businesses/<business_id>/checkout-sessions/<token>/preview/`
- Consume oncesi operasyonel dogrulama payload'i doner:
  - `can_consume`
  - `failure_reason`
  - `existing_order_id`
- `failure_reason` ornekleri:
  - `already_consumed`
  - `expired`
  - `cancelled`
  - `invalid_status`
  - `empty_snapshot`
  - `business_unavailable`
  - `wallet_missing`
  - `insufficient_balance`

## Notification Gate Product Rule

### Kural

Kritik customer endpointleri icin aktif push cihaz zorunludur:

- Cart:
  - `GET /api/v1/cart/`
  - `POST /api/v1/cart/items/`
  - `PATCH/DELETE /api/v1/cart/items/<item_id>/`
  - `DELETE /api/v1/cart/clear/`
  - `GET /api/v1/cart/checkout-preview/`
- Checkout:
  - `POST /api/v1/checkout-sessions/`
  - `GET /api/v1/checkout-sessions/<token>/`
- Wallet:
  - `GET /api/v1/wallet/`
  - `GET /api/v1/wallet/transactions/`
  - `GET /api/v1/wallet/pending-transactions/`
- Topup:
  - `POST /api/v1/payments/topup/intents/`

### Readiness contract

- `GET /api/v1/notifications/readiness/`
- Donen alanlar:
  - `notification_ready`
  - `bypass_applied`
  - `code`
  - `message`
  - `active_device_count`
  - `active_permitted_device_count`
  - `inactive_device_count`
  - `denied_permission_device_count`

### Gate hata semantigi

- Gate bloklari `403` doner.
- Global error payload `error.code = NOTIFICATION_NOT_READY` olacak sekilde normalize edilir.
- `error.details` altinda readiness detaylari bulunur.

### Admin bypass

- `HasActivePushDevice` icinde admin bypass korunur.

### Device upsert operasyonel davranis

- `POST /api/v1/notifications/devices/`
- Token/device upsert sonrasinda readiness ozetini response icinde doner.
- Ayni `device_id + platform` icin yeni token gelirse eski aktif kayitlar pasife cekilir.
- Response alani: `token_rotated_deactivated_count`

## Role Matrix

- `OWNER`
  - dashboard/history/order-detail gorur
  - profile update yapar
  - offer/media operasyonlarini yonetir
- `MANAGER`
  - owner ile ayni operasyonel business yetkileri
- `CASHIER`
  - dashboard/history/order-detail gorur
  - consume preview + consume operasyonu yapar
  - offer/profile/media yonetimi yapamaz
- `ADMIN`
  - tum business ve ops surface'e erisir
  - admin-only alanlari update edebilir

## Security Notes

- Business authority sadece `BusinessMember` uzerinden kurulur.
- `BusinessProfile.contact_user` metadata/KYC amaclidir; auth kaynagi degildir.
