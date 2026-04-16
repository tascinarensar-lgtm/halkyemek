# Sprint 3 - Discovery and Media/Content API

Bu dokuman Sprint 3 kapsaminda eklenen discovery ve medya/icerik yuzeylerini ozetler.

## Discovery API

### 1) Home endpoint

- `GET /api/v1/discovery/home/?district=BEYLIKDUZU`
- Public + auth-aware bloklar tek response icinde doner.

Response bloklari:

- `district`: aktif district kodu ve label
- `categories`: marketplace kategori listesi (image dahil)
- `featured_businesses`: one cikan anlasmali isletmeler
- `other_businesses`: gonullu/other grubu
- `active_offers`: aktif kampanya/halk menuleri
- `wallet_summary`: loginli kullanici icin bakiye ozeti
- `active_cart_summary`: aktif sepet varsa kisa ozet
- `notification_readiness`: push readiness ozeti

### 2) Discovery kategori yuzeyi

- `GET /api/v1/discovery/categories/?district=BEYLIKDUZU`
  - Kategori listesi (image ile)

- `GET /api/v1/discovery/categories/<category_slug>/businesses/?district=BEYLIKDUZU&listing_type=CONTRACTED&page=1&page_size=20`
  - MarketplaceCategory bazli business listesi
  - district filtre
  - featured ordering (`featured_first=true` varsayilan)
  - volunteer/contracted ayrimi (`listing_type`)
  - DRF pagination

### 3) Public business detail/menu enrichment

- `GET /api/v1/catalog/businesses/<business_id>/`
  - business + medya + aktif offers + kategori ozeti

- `GET /api/v1/catalog/businesses/<business_id>/menu/`
  - mevcut menu akisini korur
  - `active_offers` ve menu item image alanlarini ekler

## Media and Content Management

### 1) Domain wiring

`menus.MediaAsset` artik asagidaki hedeflerden birine baglanir:

- `business`
- `menu_item`
- `marketplace_category`
- `offer`

Kurallar:

- Asset tam olarak **tek bir hedefe** bagli olmali
- `is_active` + `sort_order` ile secim/siralama
- `asset_role`: `GALLERY`, `COVER`, `LOGO`, `THUMBNAIL`

### 2) Medya yonetim endpointleri

- `GET/POST /api/v1/businesses/<business_id>/media/`
- `GET/PATCH/DELETE /api/v1/businesses/<business_id>/media/<media_asset_id>/`

Yetki:

- Business OWNER/MANAGER kendi isletmesine ait medya yonetebilir
- Admin role override ile tum isletmelerde yonetim yapabilir

Validasyonlar:

- `file_url` veya `file_path` zorunlu
- extension kontrolu (`jpg/jpeg/png/webp/gif/svg/mp4/pdf`)
- `http/https` URL semasi
- `metadata.file_size_bytes` (varsayilan max 8MB)
- `sort_order >= 0`
- hedef business tutarliligi (menu_item/offer/business uyumu, category district uyumu)

### 3) Icerik alanlari

Business:

- `short_description`
- `intro_text`
- `badge_text`

Offer/Campaign:

- `description`
- `label`
- `tag`

## Frontend response kullanimi

- Ana ekran: `GET /api/v1/discovery/home/`
- Kategori bolumu: `GET /api/v1/discovery/categories/`
- Kategori click business list: `GET /api/v1/discovery/categories/<slug>/businesses/`
- Isletme vitrini: `GET /api/v1/catalog/businesses/<id>/`
- Isletme menu: `GET /api/v1/catalog/businesses/<id>/menu/`

## Guard and Performance

Public discovery/menu yuzeyinde su guardlar korunur:

- business: `is_active`, `is_approved`, `is_listed`, `marketplace_is_visible`
- menu category: `is_active`, `is_visible`
- menu item: `is_active`, `is_visible`, `is_available`

N+1 azaltimi:

- `select_related`/`prefetch_related` ile business->assignment/media ve offer/media/menu-item-media iliskileri toplu yuklenir.
