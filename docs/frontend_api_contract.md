# HalkYemek Frontend API Contract

Bu doküman frontend ekibine verilecek resmi API sözleşmesidir. Aktif ürün akışı dışındaki legacy davranışlar bu dokümanda referans kabul edilmez.

## 1. Ürün akışı özeti

Resmi akış:

1. `POST /api/v1/auth/google/`
2. `POST /api/v1/notifications/devices/`
3. `GET /api/v1/discovery/home/`
4. `POST /api/v1/cart/items/`
5. `GET /api/v1/cart/checkout-preview/`
6. `POST /api/v1/checkout-sessions/`
7. QR gösterimi
8. Business personel tarafında preview + consume
9. `GET /api/v1/orders/order/{id}/` veya order listesi
10. `GET /api/v1/wallet/` ve transaction ekranları

## 2. Endpoint sınıflandırması

### Public
- `POST /api/v1/auth/google/`
- `GET /api/v1/discovery/home/`
- `GET /api/v1/discovery/categories/`
- `GET /api/v1/discovery/categories/{category_slug}/businesses/`
- `GET /api/v1/catalog/businesses/`
- `GET /api/v1/catalog/businesses/{business_id}/`
- `GET /api/v1/catalog/businesses/{business_id}/menu/`

### Authenticated user
- `POST /api/v1/notifications/devices/`
- `GET /api/v1/notifications/readiness/`
- `GET /api/v1/cart/`
- `POST /api/v1/cart/items/`
- `PATCH /api/v1/cart/items/{item_id}/`
- `DELETE /api/v1/cart/items/{item_id}/`
- `DELETE /api/v1/cart/clear/`
- `GET /api/v1/cart/checkout-preview/`
- `POST /api/v1/checkout-sessions/`
- `GET /api/v1/checkout-sessions/{token}/`
- `GET /api/v1/orders/order/`
- `GET /api/v1/orders/order/{id}/`
- `GET /api/v1/wallet/`
- `GET /api/v1/wallet/transactions/`
- `GET /api/v1/wallet/pending-transactions/`
- `POST /api/v1/payments/topup/intents/`
- `GET /api/v1/payments/topup/intents/{intent_id}/`

### Business member
- `GET /api/v1/businesses/{business_id}/operations/dashboard-summary/`
- `GET /api/v1/businesses/{business_id}/operations/consume-history/`
- `GET /api/v1/businesses/{business_id}/operations/orders/{order_id}/`
- `GET /api/v1/businesses/{business_id}/operations/profile/`
- `PATCH /api/v1/businesses/{business_id}/operations/profile/`
- `GET /api/v1/businesses/{business_id}/checkout-sessions/{token}/preview/`
- `POST /api/v1/businesses/{business_id}/checkout-sessions/{token}/consume/`

### Admin / ops
- `/api/v1/ops/businesses/...`
- `/api/v1/ops/payouts/...`
- `/api/v1/payments/ops/...`
- `/api/v1/notifications/admin/broadcast/`

Notlar:
- `/api/v1/ops/payouts/...` ve `/api/v1/payments/ops/...` yüzeyleri frontend son kullanıcı akışında değil, yalnızca operator paneli / admin istemcileri içindir.
- Public katalog yüzeyleri bearer token gerektirmez. Authenticated yüzeyler JWT access token ister. Business/admin yüzeyleri ek olarak yetki kontrolü yapar.

## 3. Authentication

### Google login
`POST /api/v1/auth/google/`

Request:
```json
{
  "id_token": "google-id-token"
}
```

Success `200`:
```json
{
  "access": "jwt-access-token",
  "refresh": "jwt-refresh-token",
  "is_new": false,
  "user": {
    "id": 12,
    "username": "g_1133557799",
    "google_email": "user@example.com",
    "role": "CUSTOMER"
  },
  "has_business_membership": true,
  "business_membership_count": 1,
  "businesses": [
    {
      "id": 4,
      "name": "Halk Lokantası Beylikdüzü",
      "member_role": "MANAGER"
    }
  ]
}
```

Notlar:
- `role` request alanı artık kabul edilmez.
- Sonraki authenticated çağrılarda `Authorization: Bearer <access>` kullanılmalıdır.
- Refresh yenileme endpointi: `POST /api/v1/auth/refresh/`

## 4. Standart error formatı

Manuel veya DRF kaynaklı hatalar frontend tarafında aynı envelope ile ele alınmalıdır:

```json
{
  "ok": false,
  "error": {
    "code": "ValidationError",
    "message": {
      "amount": ["Ensure this value is greater than or equal to 1."]
    },
    "request_id": "9b6b2d4cc92f44a28e3a5d2c7d92b001"
  }
}
```

Kurallar:
- `error.code` makine tarafından işlenir.
- `error.message` string, liste veya field-error objesi olabilir.
- `error.request_id` log korelasyonu için saklanmalıdır.
- Bazı conflict cevaplarında `error.reason` veya `error.details` alanı gelebilir.
- Business detail / menu gibi public yüzeylerde `404` cevapları da aynı envelope ile döner.
- Checkout ve payment callback kaynaklı manuel cevaplar da aynı envelope standardına hizalanmıştır.

Örnekler:
- device readiness eksik: `403` + `NOTIFICATION_NOT_READY`
- idempotency conflict: `409` + `idempotency_conflict`
- checkout session expired: `410` + `checkout_session_expired`

## 5. Notification readiness contract

Finansal veya wallet etkili yüzeylerden önce cihaz kaydı zorunludur.

### Device upsert
`POST /api/v1/notifications/devices/`

Request:
```json
{
  "platform": "ANDROID",
  "fcm_token": "fcm-token",
  "device_id": "android-123",
  "app_version": "1.0.0",
  "permission_granted": true
}
```

Response `200`:
```json
{
  "id": 22,
  "platform": "ANDROID",
  "permission_granted": true,
  "is_active": true,
  "token_rotated_deactivated_count": 0,
  "notification_readiness": {
    "notification_ready": true,
    "active_device_count": 1,
    "message": "ready"
  }
}
```

### Readiness check
`GET /api/v1/notifications/readiness/`

Frontend bunu şu anlarda çağırmalıdır:
- login sonrası
- home açılışında
- topup öncesi
- checkout öncesi

## 6. Discovery surface

### Home
`GET /api/v1/discovery/home/?district=BEYLIKDUZU`

Dönen ana bloklar:
- `district`
- `categories`
- `featured_businesses`
- `other_businesses`
- `active_offers`
- authenticated user için: `wallet_summary`, `active_cart_summary`, `notification_readiness`

### Kategori listesi
`GET /api/v1/discovery/categories/?district=BEYLIKDUZU`

### Kategoriye göre işletmeler
`GET /api/v1/discovery/categories/{category_slug}/businesses/?district=BEYLIKDUZU&listing_type=CONTRACTED&featured_first=true`

### İşletme listesi
`GET /api/v1/catalog/businesses/?district=BEYLIKDUZU`

### İşletme detay
`GET /api/v1/catalog/businesses/{business_id}/`

### İşletme menüsü
`GET /api/v1/catalog/businesses/{business_id}/menu/`

## 7. Cart contract

Cart artık checkout için tek resmi kaynak kabul edilir.

### Aktif sepet
`GET /api/v1/cart/`

### Sepete ürün ekle
`POST /api/v1/cart/items/`
```json
{
  "menu_item_id": 55,
  "quantity": 2
}
```

### Satır quantity güncelle
`PATCH /api/v1/cart/items/{item_id}/`
```json
{
  "quantity": 3
}
```

### Satır sil
`DELETE /api/v1/cart/items/{item_id}/`

### Sepeti temizle
`DELETE /api/v1/cart/clear/`

### Checkout preview
`GET /api/v1/cart/checkout-preview/`

Beklenen ana response alanları:
- `id`
- `status`
- `business`
- `subtotal_amount`
- `customer_fee_amount`
- `total_amount`
- `currency`
- `item_count`
- `pricing`
- `items`

Not:
- `items[]` içinde frontend mutation akışı için `cart_item_id` da döner.

## 8. Checkout + QR contract

### Checkout create
`POST /api/v1/checkout-sessions/`

Request body boş JSON object olmalıdır:
```json
{}
```

`menu_item_id` gibi legacy alanlar artık gönderilmemelidir.

Success `201` örneği:
```json
{
  "id": 321,
  "token": "chk_live_token",
  "status": "PENDING",
  "amount": 215,
  "total_payable_amount": 215,
  "subtotal_amount": 200,
  "customer_fee_amount": 15,
  "business_fee_amount": 10,
  "business_net_amount": 190,
  "platform_total_fee_amount": 25,
  "item_count": 2,
  "currency": "TRY",
  "expires_at": "2026-04-02T13:00:00+03:00",
  "business": {
    "id": 8,
    "name": "Örnek İşletme"
  },
  "cart": {
    "id": 55
  },
  "pricing": {
    "fee_model": "customer_fee"
  },
  "items": [
    {
      "menu_item_id": 34,
      "menu_item_name": "Mercimek Çorbası",
      "quantity": 2,
      "unit_price_amount": 100,
      "line_total_amount": 200,
      "sort_order": 1
    }
  ]
}
```

Notlar:
- `Idempotency-Key` header zorunludur.
- Response header olarak `Idempotency-Replayed: true|false` gelebilir.

### Checkout detail
`GET /api/v1/checkout-sessions/{token}/`

### Business consume preview
`GET /api/v1/businesses/{business_id}/checkout-sessions/{token}/preview/`

### Business consume
`POST /api/v1/businesses/{business_id}/checkout-sessions/{token}/consume/`

Success `200`:
```json
{
  "status": "CONSUMED",
  "order_id": 987,
  "total_charged_amount": 215,
  "amount": 215,
  "checkout_session_id": 321
}
```

Not:
- `total_charged_amount` resmi alandır.
- `amount` yalnızca geçiş amaçlı compatibility mirror olarak kalır.

```json
```

## 9. Orders surface

### Order list
`GET /api/v1/orders/order/`

Filter/search/order alanları:
- `status`
- `business`
- `user`
- `checkout_session`
- `order_items__menu_item`
- `search`
- `ordering`

### Order detail
`GET /api/v1/orders/order/{id}/`

Ana response alanları:
- `id`
- `user`, `user_username`
- `business`, `business_name`
- `checkout_session_id`, `cart_id`
- `total_charged_amount`, `subtotal_amount`, `customer_fee_amount`, `business_fee_amount`
- `business_net_amount`
- `amount` sadece deprecated mirror; yeni frontend kullanmamalı
- `item_count`, `status`, `paid_at`, `used_at`, `expires_at`, `created_at`
- `pricing`
- `source.contract = cart_checkout_qr_order`
- `order_items[]`

## 10. Wallet + topup contract

### Wallet detail
`GET /api/v1/wallet/`

### Wallet transaction list
`GET /api/v1/wallet/transactions/?type=TOPUP&payment_intent_id=77&order_id=987`

### Pending transaction list
`GET /api/v1/wallet/pending-transactions/?type=TOPUP&payment_intent_id=77`

### Topup intent create
`POST /api/v1/payments/topup/intents/`

Headers:
- `Authorization: Bearer <token>`
- `Idempotency-Key: <client-generated-uuid>`

Request:
```json
{
  "amount": 500
}
```

Success `201` örneği:
```json
{
  "id": 77,
  "amount": 500,
  "status": "PENDING",
  "conversation_id": "HY-PI-77",
  "checkout_url": "https://sandbox-iyzico.example/checkout/abc",
  "provider": "iyzico",
  "created_at": "2026-04-02T12:00:00+03:00"
}
```

### Topup intent detail
`GET /api/v1/payments/topup/intents/{intent_id}/`

### Provider callback
`POST /api/v1/payments/topup/callback/iyzico/`

Bu endpoint frontend normal akışında doğrudan kullanılmaz; provider retrieval/callback yüzeyidir.

## 11. Frontend implementasyon notları

- Tüm authenticated isteklerde access token kullan.
- Wallet, cart, checkout ve payment yüzeylerinde readiness hatasını ayrı ele al.
- `request_id` alanını hata ekranı veya support loguna ekle.
- Checkout ve topup create için client tarafında idempotency key üret.
- Public discovery ekranı anonymous çalışmalı; login olmuş kullanıcıda aynı endpoint ek summary blokları döndürebilir.
- OpenAPI kaynağı: `GET /api/schema/`
- Swagger UI: `GET /api/docs/`
- ReDoc: `GET /api/redoc/`

## 13. OpenAPI ve dokümantasyon kaynakları

- Makine tarafından okunabilir schema: `GET /api/schema/`
- Swagger UI: `GET /api/docs/`
- ReDoc: `GET /api/redoc/`

Beklenti:
- Frontend ekibi yeni entegrasyonlarda önce schema üstünden request/response alanlarını doğrulamalıdır.
- `amount` gibi bazı alanlar compatibility mirror olarak tutulur; mümkünse `total_payable_amount` ve `total_charged_amount` gibi resmi alanlar kullanılmalıdır.
- Operator istemcileri `ops-businesses`, `ops-payments`, `ops-settlement`, `ops-payouts` tag’leri altındaki yüzeyleri baz almalıdır.
