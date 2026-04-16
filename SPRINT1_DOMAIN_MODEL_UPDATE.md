# Sprint 1 - Domain Model Update

Bu dokuman Sprint 1 (Faz 0 + Faz 1) kapsaminda veri modelinde yapilan genisletmeleri ozetler.

## Uygulanan Ana Degisiklikler

### 1) Cart-Backed Checkout Altyapisi (Orders)

- `orders.Cart` modeli eklendi.
  - Her kullanici icin tek aktif sepet kisiti: `uq_cart_user_single_active`
  - Sepet durumlari: `ACTIVE`, `CHECKED_OUT`, `ABANDONED`, `CONVERTED`
  - Toplam alanlari: `subtotal_amount`, `customer_fee_amount`, `total_amount`
  - Gelecekte checkout donusumu icin alanlar: `checked_out_at`, `abandoned_at`, `converted_order`

- `orders.CartItem` modeli eklendi.
  - Sepet urunu ayni business kisiti: model validation
  - `quantity`, `unit_price_amount`, `line_total_amount`
  - Snapshot alanlari: `menu_item_name`, `menu_item_snapshot`
  - Duplicate item kisiti: `uq_cartitem_cart_menu_item`

### 2) Order Coklu Urun Altyapisi

- `orders.Order` genisletildi:
  - `subtotal_amount`, `customer_fee_amount`, `business_fee_amount`
  - `total_charged_amount`, `business_net_amount`, `item_count`
  - `pricing_snapshot`, `order_snapshot`

- `orders.OrderItem` modeli eklendi:
  - Siparis satir seviyesinde adet/fiyat/toplam ve snapshot saklar
  - Siparis anindaki urun adi/fiyat degisse bile kayit bozulmaz

- Mevcut tek urun checkout akisi korunarak consume adiminda otomatik `OrderItem` olusumu eklendi.
- Geriye donuk uyumluluk icin `orders.0009_backfill_order_accounting_snapshot` migration'i eklendi.

### 3) Marketplace Vitrin Domain Ayrimi (Businesses)

- `businesses.MarketplaceCategory` modeli eklendi.
  - Menu kategorilerinden bagimsiz vitrini temsil eder
  - District bazli (`district`) ve genisletilebilir tasarim
  - `is_other` ile "Diger" kategorisi desteklenir

- `businesses.BusinessCategoryAssignment` modeli eklendi.
  - Business ile marketplace kategorisi eslestirmesi
  - `is_primary`, `is_active`, `sort_order`
  - Bir business icin tek aktif primary atama kisiti

### 4) BusinessProfile Genisletme

- `listing_type` (`CONTRACTED` / `VOLUNTEER`)
- `is_featured`, `display_priority`
- `marketplace_is_visible`

Not: `contact_user` authority kaynagi yapilmadi, sadece metadata amaciyla korunmaya devam ediyor.

### 5) Medya Katmani (Menus)

- `menus.MediaAsset` modeli eklendi.
  - Business ve/veya menu item baglantisi
  - `file_url` / `file_path`, `media_type`, `alt_text`, `sort_order`, `is_active`, `uploaded_by`
  - Snapshot/discovery icin genisletilebilir `metadata`

### 6) Kampanya / Halk Menusu (Menus)

- `menus.BusinessOffer` modeli eklendi.
  - Isletmenin normal menu disinda kampanya menusu yayinlamasi icin
  - `starts_at`, `ends_at`, `is_active`, `is_featured`, `daily_limit`
  - `offer_price_amount` ve aciklama alanlari ile discovery API'lerine uygun altyapi

## Admin ve Serializer Wiring

- Yeni modeller admin'e eklendi:
  - `Cart`, `CartItem`, `OrderItem`
  - `MarketplaceCategory`, `BusinessCategoryAssignment`
  - `MediaAsset`, `BusinessOffer`

- Base serializer katmani genisletildi:
  - Order satirlarini tasiyan `OrderItemSerializer`
  - `MediaAssetSerializer`, `BusinessOfferSerializer`
  - `MarketplaceCategorySerializer`, `BusinessCategoryAssignmentSerializer`

## Test Kapsami

Yeni testler eklendi:

- Cart/CartItem validation
  - quantity guard
  - inactive/unavailable item guard
  - farkli business urununun ayni sepete girememesi

- OrderItem snapshot dogrulugu

- MarketplaceCategory / BusinessCategoryAssignment constraint testleri

- BusinessProfile listing/feature alanlari default davranisi

- MediaAsset temel dogrulamalari

- BusinessOffer tarih ve limit dogrulamalari

- Checkout regresyonu
  - consume sonrasi pricing alanlari + `OrderItem` olusumu

## Sonraki Sprint Icin Hazirlanan Zemin

Bu sprint ile birlikte sistem, bir sonraki sprintte:

1. Sabit customer/business fee (10 TL + 10 TL) kuralini merkezi pricing katmanina tasimaya,
2. Checkout'i cart-backed hale cevirmeye,
3. Marketplace discovery API'lerini category/offer/media domaini uzerinden olusturmaya

hazir hale getirildi.

Mevcut calisan tek menu item tabanli checkout/order/earning akisi korunmustur.
