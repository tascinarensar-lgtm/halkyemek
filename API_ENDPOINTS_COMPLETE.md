# Django + DRF API Endpoints - Tam Listesi

## İçindekiler
1. [Authentication APIs](#authentication-apis)
2. [Schema & Documentation](#schema--documentation)
3. [Orders & Cart APIs](#orders--cart-apis)
4. [Menu & Business APIs](#menu--business-apis)
5. [Payment APIs](#payment-apis)
6. [Wallet APIs](#wallet-apis)
7. [Notification APIs](#notification-apis)
8. [Payout APIs](#payout-apis)
9. [Health APIs](#health-apis)

---

## Authentication APIs

### 1. Google Login
- **Endpoint**: `/api/v1/auth/google/`
- **HTTP Method**: `POST`
- **Açıklama**: Google ID token ile giriş yapar, JWT access/refresh token döndürür
- **Authentication**: AllowAny (throttled)
- **File**: [accounts/views_google.py](accounts/views_google.py#L51) - `GoogleLoginAPIView.post()`
- **Class**: `GoogleLoginAPIView` (line 51)

### 2. Auth Me (Current User Info)
- **Endpoint**: `/api/v1/auth/me/`
- **HTTP Method**: `GET`
- **Açıklama**: Authenticated kullanıcının bilgilerini ve işletme üyeliklerini döndürür
- **Authentication**: IsAuthenticated
- **File**: [accounts/api/views.py](accounts/api/views.py#L41) - `AuthMeView.get()`
- **Class**: `AuthMeView` (line 41)

### 3. Token Refresh
- **Endpoint**: `/api/v1/auth/refresh/`
- **HTTP Method**: `POST`
- **Açıklama**: Refresh token kullanarak yeni access token üretir (DRF SimpleJWT)
- **Authentication**: AllowAny
- **File**: [halkyemekproject/urls.py](halkyemekproject/urls.py#L19)
- **Class**: `TokenRefreshView` (simplejwt)

### 4. Login (Debug Mode)
- **Endpoint**: `/api/v1/auth/login/` (DEBUG mode only)
- **HTTP Method**: `POST`
- **Açıklama**: Username/password ile giriş yapar, access/refresh token döndürür (throttled)
- **Authentication**: AllowAny
- **File**: [accounts/api/views.py](accounts/api/views.py#L20) - `LoginView`
- **Class**: `LoginView` (inherits TokenObtainPairView)

---

## Schema & Documentation

### 1. OpenAPI Schema
- **Endpoint**: `/api/schema/`
- **HTTP Method**: `GET`
- **Açıklama**: OpenAPI/Swagger schema dosyası
- **Authentication**: AllowAny
- **File**: [halkyemekproject/urls.py](halkyemekproject/urls.py#L18)
- **Class**: `SpectacularAPIView`

### 2. Swagger UI Docs
- **Endpoint**: `/api/docs/`
- **HTTP Method**: `GET`
- **Açıklama**: Interactive Swagger documentation UI
- **Authentication**: AllowAny
- **File**: [halkyemekproject/urls.py](halkyemekproject/urls.py#L19)
- **Class**: `SpectacularSwaggerView`

### 3. ReDoc Documentation
- **Endpoint**: `/api/redoc/`
- **HTTP Method**: `GET`
- **Açıklama**: ReDoc API documentation
- **Authentication**: AllowAny
- **File**: [halkyemekproject/urls.py](halkyemekproject/urls.py#L20)
- **Class**: `SpectacularRedocView`

---

## Orders & Cart APIs

### Order Management

#### 1. Order List
- **Endpoint**: `/api/v1/orders/`
- **HTTP Method**: `GET`
- **Açıklama**: Authenticated kullanıcının orders'ını listeler (filterable, searchable, orderable)
- **Authentication**: IsAuthenticated
- **Filterler**: status, business, user, checkout_session, order_items__menu_item
- **Arama**: id, order_items__menu_item_name, business__business_name, user__username, checkout_session__token
- **Sıralama**: created_at, amount, status, paid_at, used_at
- **File**: [orders/api/viewsets.py](orders/api/viewsets.py#L25) - `OrderViewSet.list()`
- **Class**: `OrderViewSet` (line 25, mixins.ListModelMixin)

#### 2. Order Detail
- **Endpoint**: `/api/v1/orders/{id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir order'ın detaylarını döndürür
- **Authentication**: IsAuthenticated
- **Permissions**: Kullanıcı/işletme/admin
- **File**: [orders/api/viewsets.py](orders/api/viewsets.py#L25) - `OrderViewSet.retrieve()`
- **Class**: `OrderViewSet` (line 25, mixins.RetrieveModelMixin)

### Cart Management

#### 3. Get Cart
- **Endpoint**: `/api/v1/cart/`
- **HTTP Method**: `GET`
- **Açıklama**: Authenticated kullanıcının aktif cart'ını döndürür
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_cart.py](orders/api/views_cart.py#L29) - `CartDetailAPIView.get()`
- **Class**: `CartDetailAPIView` (line 29)

#### 4. Add Item to Cart
- **Endpoint**: `/api/v1/cart/items/`
- **HTTP Method**: `POST`
- **Açıklama**: Cart'a yeni ürün ekler veya miktarını artırır
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_cart.py](orders/api/views_cart.py#L42) - `CartItemAddAPIView.post()`
- **Class**: `CartItemAddAPIView` (line 42)

#### 5. Update Cart Item Quantity
- **Endpoint**: `/api/v1/cart/items/{item_id}/`
- **HTTP Method**: `PATCH`
- **Açıklama**: Cart item'ının miktarını günceller
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_cart.py](orders/api/views_cart.py#L68) - `CartItemQuantityUpdateAPIView.patch()`
- **Class**: `CartItemQuantityUpdateAPIView` (line 68)

#### 6. Delete Cart Item
- **Endpoint**: `/api/v1/cart/items/{item_id}/`
- **HTTP Method**: `DELETE`
- **Açıklama**: Cart'tan belirli bir item'ı siler
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_cart.py](orders/api/views_cart.py#L68) - `CartItemQuantityUpdateAPIView.delete()`
- **Class**: `CartItemQuantityUpdateAPIView` (line 90)

#### 7. Clear Cart
- **Endpoint**: `/api/v1/cart/clear/`
- **HTTP Method**: `DELETE`
- **Açıklama**: Cart'ın tüm item'larını temizler
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_cart.py](orders/api/views_cart.py#L100) - `CartClearAPIView.delete()`
- **Class**: `CartClearAPIView` (line 100)

#### 8. Cart Checkout Preview
- **Endpoint**: `/api/v1/cart/checkout-preview/`
- **HTTP Method**: `GET`
- **Açıklama**: Cart'ın checkout öncesi ücret hesaplaması ve özeti
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_cart.py](orders/api/views_cart.py#L115) - `CartCheckoutPreviewAPIView.get()`
- **Class**: `CartCheckoutPreviewAPIView` (line 115)

### Checkout Sessions

#### 9. Create Checkout Session
- **Endpoint**: `/api/v1/checkout-sessions/`
- **HTTP Method**: `POST`
- **Açıklama**: Cart'tan checkout session oluşturur (reusable token ile)
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_checkout.py](orders/api/views_checkout.py#L100) - `CheckoutSessionCreateAPIView.post()`
- **Class**: `CheckoutSessionCreateAPIView` (line 100)

#### 10. Get Checkout Session
- **Endpoint**: `/api/v1/checkout-sessions/{token}/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir checkout session'ın detaylarını döndürür
- **Authentication**: AllowAny
- **File**: [orders/api/views_checkout.py](orders/api/views_checkout.py#L276) - `CheckoutSessionDetailAPIView.get()`
- **Class**: `CheckoutSessionDetailAPIView` (line 276)

#### 11. Cancel Checkout Session
- **Endpoint**: `/api/v1/checkout-sessions/{token}/cancel/`
- **HTTP Method**: `POST`
- **Açıklama**: Checkout session'ı iptal eder
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_checkout.py](orders/api/views_checkout.py#L292) - `CheckoutSessionCancelAPIView.post()`
- **Class**: `CheckoutSessionCancelAPIView` (line 292)

#### 12. Latest Reusable Checkout Session
- **Endpoint**: `/api/v1/checkout-sessions/latest/`
- **HTTP Method**: `GET`
- **Açıklama**: Kullanıcının en son reusable checkout session'ını döndürür
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_checkout.py](orders/api/views_checkout.py#L335) - `LatestReusableCheckoutSessionAPIView.get()`
- **Class**: `LatestReusableCheckoutSessionAPIView` (line 335)

#### 13. Consume Checkout Session (QR Order)
- **Endpoint**: `/api/v1/businesses/{business_id}/checkout-sessions/{token}/consume/`
- **HTTP Method**: `POST`
- **Açıklama**: İşletme tarafından QR code checkout session'ı consume eder (order oluşturur)
- **Authentication**: IsAuthenticated
- **Permissions**: IsOrderBusiness
- **File**: [orders/api/views_checkout.py](orders/api/views_checkout.py#L356) - `CheckoutSessionConsumeAPIView.post()`
- **Class**: `CheckoutSessionConsumeAPIView` (line 356)

#### 14. Consume Checkout Session Preview
- **Endpoint**: `/api/v1/businesses/{business_id}/checkout-sessions/{token}/preview/`
- **HTTP Method**: `GET`
- **Açıklama**: QR order consume öncesi preview (sipariş detayı)
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_checkout.py](orders/api/views_checkout.py#L399) - `CheckoutSessionConsumePreviewAPIView.get()`
- **Class**: `CheckoutSessionConsumePreviewAPIView` (line 399)

#### 15. Checkout Session Consume Lookup
- **Endpoint**: `/api/v1/businesses/{business_id}/checkout-sessions/lookup/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir işletme için pending checkout sessions'ını arar
- **Authentication**: IsAuthenticated
- **File**: [orders/api/views_checkout.py](orders/api/views_checkout.py#L424) - `CheckoutSessionConsumeLookupAPIView.get()`
- **Class**: `CheckoutSessionConsumeLookupAPIView` (line 424)

---

## Menu & Business APIs

### Public Discovery APIs

#### 1. Discovery Home
- **Endpoint**: `/api/v1/discovery/home/`
- **HTTP Method**: `GET`
- **Açıklama**: Ana discovery sayfası (kategoriler, featured işletmeler, aktif offers, wallet/cart/notification summary)
- **Authentication**: AllowAny
- **Query Parameters**: district (optional, default: BEYLIKDUZU)
- **File**: [menus/api/views_public.py](menus/api/views_public.py#L202) - `DiscoveryHomeAPIView.get()`
- **Class**: `DiscoveryHomeAPIView` (line 202)

#### 2. Discovery Categories List
- **Endpoint**: `/api/v1/discovery/categories/`
- **HTTP Method**: `GET`
- **Açıklama**: Tüm marketplace kategorilerini listeler
- **Authentication**: AllowAny
- **Query Parameters**: district (optional, default: BEYLIKDUZU)
- **File**: [menus/api/views_public.py](menus/api/views_public.py#L291) - `DiscoveryCategoryListAPIView.get()`
- **Class**: `DiscoveryCategoryListAPIView` (line 291)

#### 3. Discovery Category Businesses
- **Endpoint**: `/api/v1/discovery/categories/{category_slug}/businesses/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli kategorideki işletmeleri listeler
- **Authentication**: AllowAny
- **Query Parameters**: district, listing_type, featured_first
- **File**: [menus/api/views_public.py](menus/api/views_public.py#L322) - `DiscoveryCategoryBusinessListAPIView.get()`
- **Class**: `DiscoveryCategoryBusinessListAPIView` (line 322)

#### 4. Catalog Businesses List
- **Endpoint**: `/api/v1/catalog/businesses/`
- **HTTP Method**: `GET`
- **Açıklama**: Tüm işletmeleri katalog olarak listeler (pagination)
- **Authentication**: AllowAny
- **Query Parameters**: district (optional)
- **File**: [menus/api/views_public.py](menus/api/views_public.py#L184) - `PublicBusinessListAPIView.get()`
- **Class**: `PublicBusinessListAPIView` (line 184)

#### 5. Catalog Business Detail
- **Endpoint**: `/api/v1/catalog/businesses/{business_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir işletmenin detaylarını döndürür
- **Authentication**: AllowAny
- **File**: [menus/api/views_public.py](menus/api/views_public.py#L366) - `PublicBusinessDetailAPIView.get()`
- **Class**: `PublicBusinessDetailAPIView` (line 366)

#### 6. Catalog Business Menu
- **Endpoint**: `/api/v1/catalog/businesses/{business_id}/menu/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir işletmenin menu'sünü (ürünleri) kategoriye göre gruplandırarak döndürür
- **Authentication**: AllowAny
- **File**: [menus/api/views_public.py](menus/api/views_public.py#L405) - `PublicBusinessMenuAPIView.get()`
- **Class**: `PublicBusinessMenuAPIView` (line 405)

### Business Management APIs

#### 7. Business Categories List/Create
- **Endpoint**: `/api/v1/businesses/{business_id}/categories/`
- **HTTP Method**: `GET, POST`
- **Açıklama**: İşletmenin marketplace kategorilerini listeler veya yeni kategori atar
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **GET**: Kategorileri listeler
- **POST**: Kategori ekler veya günceller
- **File**: [menus/api/views_business.py](menus/api/views_business.py#L108) - `BusinessCategoryListCreateAPIView`
- **Class**: `BusinessCategoryListCreateAPIView` (line 108)

#### 8. Business Category Detail
- **Endpoint**: `/api/v1/businesses/{business_id}/categories/{category_id}/`
- **HTTP Method**: `GET, PATCH, DELETE`
- **Açıklama**: Belirli bir kategori atamasını görüntüler, günceller veya siler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **GET**: Kategori atama detayları
- **PATCH**: Kategori atama özelliklerini günceller
- **DELETE**: Kategori atamasını siler
- **File**: [menus/api/views_business.py](menus/api/views_business.py#L163) - `BusinessCategoryDetailAPIView`
- **Class**: `BusinessCategoryDetailAPIView` (line 163)

#### 9. Business Menu Items List/Create
- **Endpoint**: `/api/v1/businesses/{business_id}/menu-items/`
- **HTTP Method**: `GET, POST`
- **Açıklama**: İşletmenin menu item'larını listeler veya yeni ürün ekler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [menus/api/views_business.py](menus/api/views_business.py#L245) - `BusinessMenuItemListCreateAPIView`
- **Class**: `BusinessMenuItemListCreateAPIView` (line 245)

#### 10. Business Menu Item Detail
- **Endpoint**: `/api/v1/businesses/{business_id}/menu-items/{menu_item_id}/`
- **HTTP Method**: `GET, PUT, PATCH, DELETE`
- **Açıklama**: Belirli bir ürünü görüntüler, günceller veya siler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [menus/api/views_business.py](menus/api/views_business.py#L280) - `BusinessMenuItemDetailAPIView`
- **Class**: `BusinessMenuItemDetailAPIView` (line 280)

#### 11. Business Offers List/Create
- **Endpoint**: `/api/v1/businesses/{business_id}/offers/`
- **HTTP Method**: `GET, POST`
- **Açıklama**: İşletmenin promosyon/indirim tekliflerini listeler veya yeni offer ekler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [menus/api/views_business.py](menus/api/views_business.py#L321) - `BusinessOfferListCreateAPIView`
- **Class**: `BusinessOfferListCreateAPIView` (line 321)

#### 12. Business Offer Detail
- **Endpoint**: `/api/v1/businesses/{business_id}/offers/{offer_id}/`
- **HTTP Method**: `GET, PUT, PATCH, DELETE`
- **Açıklama**: Belirli bir offer'ı görüntüler, günceller veya siler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [menus/api/views_business.py](menus/api/views_business.py#L349) - `BusinessOfferDetailAPIView`
- **Class**: `BusinessOfferDetailAPIView` (line 349)

#### 13. Business Media Assets List/Create
- **Endpoint**: `/api/v1/businesses/{business_id}/media/`
- **HTTP Method**: `GET, POST`
- **Açıklama**: İşletmenin medya dosyalarını (resimler) listeler veya yeni dosya yükler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [menus/api/views_media.py](menus/api/views_media.py#L34) - `BusinessMediaAssetListCreateAPIView`
- **Class**: `BusinessMediaAssetListCreateAPIView` (line 34)

#### 14. Business Media Asset Detail
- **Endpoint**: `/api/v1/businesses/{business_id}/media/{media_asset_id}/`
- **HTTP Method**: `GET, PUT, PATCH, DELETE`
- **Açıklama**: Belirli bir medya dosyasını görüntüler, günceller veya siler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [menus/api/views_media.py](menus/api/views_media.py#L83) - `BusinessMediaAssetDetailAPIView`
- **Class**: `BusinessMediaAssetDetailAPIView` (line 83)

### Business Operations APIs

#### 15. Business Dashboard Summary
- **Endpoint**: `/api/v1/businesses/{business_id}/operations/dashboard-summary/`
- **HTTP Method**: `GET`
- **Açıklama**: İşletme işletmecisinin dashboard özetini döndürür (anlık istatistikler)
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [businesses/api/views_business.py](businesses/api/views_business.py#L48) - `BusinessDashboardSummaryAPIView.get()`
- **Class**: `BusinessDashboardSummaryAPIView` (line 48)

#### 16. Business Consume History
- **Endpoint**: `/api/v1/businesses/{business_id}/operations/consume-history/`
- **HTTP Method**: `GET`
- **Açıklama**: İşletmenin QR code consume geçmişini döndürür (kullanılan checkout session'ları)
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [businesses/api/views_business.py](businesses/api/views_business.py#L191) - `BusinessConsumeHistoryAPIView.get()`
- **Class**: `BusinessConsumeHistoryAPIView` (line 191)

#### 17. Business Order Detail
- **Endpoint**: `/api/v1/businesses/{business_id}/operations/orders/{order_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: İşletme tarafından belirli bir siparişi görüntüler
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **File**: [businesses/api/views_business.py](businesses/api/views_business.py#L269) - `BusinessOrderDetailAPIView.get()`
- **Class**: `BusinessOrderDetailAPIView` (line 269)

#### 18. Business Profile Operations
- **Endpoint**: `/api/v1/businesses/{business_id}/operations/profile/`
- **HTTP Method**: `GET, PATCH`
- **Açıklama**: İşletme profil bilgilerini görüntüler veya günceller
- **Authentication**: IsAuthenticated
- **Permissions**: BusinessOwner/Manager
- **GET**: Profil bilgilerini döndürür
- **PATCH**: Profil bilgilerini günceller
- **File**: [businesses/api/views_business.py](businesses/api/views_business.py#L338) - `BusinessProfileOperationsAPIView`
- **Class**: `BusinessProfileOperationsAPIView` (line 338)

### Operations (Admin) APIs

#### 19. Ops Business List
- **Endpoint**: `/api/v1/ops/businesses/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü tüm işletmeleri listeler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [businesses/api/views_ops.py](businesses/api/views_ops.py#L61) - `OpsBusinessListAPIView.get()`
- **Class**: `OpsBusinessListAPIView` (line 61)

#### 20. Ops Business Detail
- **Endpoint**: `/api/v1/ops/businesses/{business_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü belirli bir işletmenin detaylarını görüntüler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [businesses/api/views_ops.py](businesses/api/views_ops.py#L126) - `OpsBusinessDetailAPIView.get()`
- **Class**: `OpsBusinessDetailAPIView` (line 126)

#### 21. Ops Business Status Update
- **Endpoint**: `/api/v1/ops/businesses/{business_id}/status/`
- **HTTP Method**: `PATCH`
- **Açıklama**: Sistem operatörü işletme status'ünü günceller (approved, active, listed vb.)
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [businesses/api/views_ops.py](businesses/api/views_ops.py#L189) - `OpsBusinessStatusUpdateAPIView.patch()`
- **Class**: `OpsBusinessStatusUpdateAPIView` (line 189)

#### 22. Ops Business Membership List/Create
- **Endpoint**: `/api/v1/ops/businesses/{business_id}/memberships/`
- **HTTP Method**: `GET, POST`
- **Açıklama**: Sistem operatörü işletme üyeliklerini listeler veya yeni üye ekler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [businesses/api/views_ops.py](businesses/api/views_ops.py#L248) - `OpsBusinessMembershipListCreateAPIView`
- **Class**: `OpsBusinessMembershipListCreateAPIView` (line 248)

#### 23. Ops Business Membership Deactivate
- **Endpoint**: `/api/v1/ops/businesses/{business_id}/memberships/deactivate/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü işletme üyeliğini deaktif eder
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [businesses/api/views_ops.py](businesses/api/views_ops.py#L341) - `OpsBusinessMembershipDeactivateAPIView.post()`
- **Class**: `OpsBusinessMembershipDeactivateAPIView` (line 341)

#### 24. Ops Create Submerchant
- **Endpoint**: `/api/v1/ops/businesses/{business_id}/iyzico/submerchant/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü işletme için Iyzico submerchant oluşturur
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [businesses/api/views_ops.py](businesses/api/views_ops.py#L395) - `OpsCreateSubmerchantAPIView.post()`
- **Class**: `OpsCreateSubmerchantAPIView` (line 395)

---

## Payment APIs

### Customer Payment APIs

#### 1. Create Topup Payment Intent
- **Endpoint**: `/api/v1/payments/topup/intents/`
- **HTTP Method**: `POST`
- **Açıklama**: Cüzdan yükleme için payment intent oluşturur (idempotent)
- **Authentication**: IsAuthenticated
- **Permissions**: HasActivePushDevice
- **Throttle**: PaymentCreateThrottle
- **File**: [payments/api/views.py](payments/api/views.py#L138) - `TopupPaymentIntentCreateAPIView.post()`
- **Class**: `TopupPaymentIntentCreateAPIView` (line 138)

#### 2. Iyzico Topup Callback
- **Endpoint**: `/api/v1/payments/topup/callback/iyzico/`
- **HTTP Method**: `POST`
- **Açıklama**: Iyzico cüzdan yükleme webhook callback'i
- **Authentication**: AllowAny (signature verified)
- **File**: [payments/api/views.py](payments/api/views.py#L260) - `IyzicoTopupCallbackAPIView.post()`
- **Class**: `IyzicoTopupCallbackAPIView` (line 260)

#### 3. My Payment Intent Detail
- **Endpoint**: `/api/v1/payments/intents/{intent_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Kendi payment intent'inin detaylarını döndürür
- **Authentication**: IsAuthenticated
- **File**: [payments/api/views.py](payments/api/views.py#L247) - `MyPaymentIntentDetailAPIView.get()`
- **Class**: `MyPaymentIntentDetailAPIView` (line 247)

### Operations (Admin) Payment APIs

#### 4. Ops Payment Reversals List
- **Endpoint**: `/api/v1/payments/ops/reversals/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü para iadesi işlemlerini listeler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L289) - `OpsPaymentReversalListAPIView.get()`
- **Class**: `OpsPaymentReversalListAPIView` (line 289)

#### 5. Ops Payment Reversal Resolve
- **Endpoint**: `/api/v1/payments/ops/reversals/{reversal_id}/resolve/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü para iadesi işlemini çözer (mühürler)
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L310) - `OpsPaymentReversalResolveAPIView.post()`
- **Class**: `OpsPaymentReversalResolveAPIView` (line 310)

#### 6. Ops Order Refund
- **Endpoint**: `/api/v1/payments/ops/orders/{order_id}/refund/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü bir siparişi geri öder
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L345) - `OpsOrderRefundAPIView.post()`
- **Class**: `OpsOrderRefundAPIView` (line 345)

#### 7. Ops Topup Reversal
- **Endpoint**: `/api/v1/payments/ops/intents/{intent_id}/topup-reversal/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü cüzdan yükleme işlemini tersine çevirir
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L396) - `OpsTopupReversalAPIView.post()`
- **Class**: `OpsTopupReversalAPIView` (line 396)

#### 8. Ops Chargeback
- **Endpoint**: `/api/v1/payments/ops/chargebacks/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü chargeback kaydı oluşturur (disputable transaction)
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L437) - `OpsChargebackAPIView.post()`
- **Class**: `OpsChargebackAPIView` (line 437)

#### 9. Ops Settlement Dashboard
- **Endpoint**: `/api/v1/payments/ops/settlement/dashboard/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü settlement işlemlerinin dashboard'unu görüntüler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L760) - `OpsSettlementDashboardAPIView.get()`
- **Class**: `OpsSettlementDashboardAPIView` (line 760)

#### 10. Ops Settlement Import Upload
- **Endpoint**: `/api/v1/payments/ops/settlement/imports/upload/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü settlement dosyası yükler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L501) - `OpsSettlementImportUploadAPIView.post()`
- **Class**: `OpsSettlementImportUploadAPIView` (line 501)

#### 11. Ops Settlement Imports List
- **Endpoint**: `/api/v1/payments/ops/settlement/imports/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü settlement import'larını listeler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L579) - `OpsSettlementImportListAPIView.get()`
- **Class**: `OpsSettlementImportListAPIView` (line 579)

#### 12. Ops Settlement Import Detail
- **Endpoint**: `/api/v1/payments/ops/settlement/imports/{import_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir settlement import'ının detaylarını görüntüler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L608) - `OpsSettlementImportDetailAPIView.get()`
- **Class**: `OpsSettlementImportDetailAPIView` (line 608)

#### 13. Ops Settlement Import Retry
- **Endpoint**: `/api/v1/payments/ops/settlement/imports/{import_id}/retry/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü başarısız settlement import'unu tekrar işler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L629) - `OpsSettlementImportRetryAPIView.post()`
- **Class**: `OpsSettlementImportRetryAPIView` (line 629)

#### 14. Ops Settlement Records List
- **Endpoint**: `/api/v1/payments/ops/settlement/records/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü settlement kayıtlarını listeler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L655) - `OpsSettlementRecordListAPIView.get()`
- **Class**: `OpsSettlementRecordListAPIView` (line 655)

#### 15. Ops Settlement Record Detail
- **Endpoint**: `/api/v1/payments/ops/settlement/records/{record_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir settlement kaydının detaylarını görüntüler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L681) - `OpsSettlementRecordDetailAPIView.get()`
- **Class**: `OpsSettlementRecordDetailAPIView` (line 681)

#### 16. Ops Settlement Record Reprocess
- **Endpoint**: `/api/v1/payments/ops/settlement/records/{record_id}/reprocess/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü settlement kaydını yeniden işler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L691) - `OpsSettlementRecordReprocessAPIView.post()`
- **Class**: `OpsSettlementRecordReprocessAPIView` (line 691)

#### 17. Ops Settlement Record Review
- **Endpoint**: `/api/v1/payments/ops/settlement/records/{record_id}/review/`
- **HTTP Method**: `PATCH`
- **Açıklama**: Sistem operatörü settlement kaydını gözden geçirir (manual review)
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payments/api/views.py](payments/api/views.py#L733) - `OpsSettlementRecordReviewAPIView.patch()`
- **Class**: `OpsSettlementRecordReviewAPIView` (line 733)

### Webhook APIs

#### 18. Payments Provider Webhook
- **Endpoint**: `/api/v1/payments/webhook/provider/`
- **HTTP Method**: `POST`
- **Açıklama**: Ödeme sağlayıcısından webhook (signature verified)
- **Authentication**: AllowAny
- **File**: [payments/views.py](payments/views.py)
- **Class**: `ProviderWebhookView`

#### 19. Iyzico Webhook
- **Endpoint**: `/api/v1/payments/webhooks/iyzico/`
- **HTTP Method**: `POST`
- **Açıklama**: Iyzico ödeme sağlayıcısı webhook'u
- **Authentication**: AllowAny (signature verified)
- **File**: [payments/views.py](payments/views.py)
- **Class**: `IyzicoWebhookView`

---

## Wallet APIs

#### 1. Get Wallet
- **Endpoint**: `/api/v1/wallet/`
- **HTTP Method**: `GET`
- **Açıklama**: Authenticated kullanıcının cüzdan bilgilerini döndürür
- **Authentication**: IsAuthenticated
- **File**: [wallets/api/views.py](wallets/api/views.py#L30) - `WalletDetailAPIView.get()`
- **Class**: `WalletDetailAPIView` (line 30)

#### 2. Wallet Transactions List
- **Endpoint**: `/api/v1/wallet/transactions/`
- **HTTP Method**: `GET`
- **Açıklama**: Cüzdan işlem geçmişini listeler
- **Authentication**: IsAuthenticated
- **File**: [wallets/api/views.py](wallets/api/views.py#L47) - `WalletTransactionListAPIView.get()`
- **Class**: `WalletTransactionListAPIView` (line 47)

#### 3. Pending Wallet Transactions List
- **Endpoint**: `/api/v1/wallet/pending-transactions/`
- **HTTP Method**: `GET`
- **Açıklama**: Cüzdanda bekleme halindeki işlemleri listeler (pending topup'lar)
- **Authentication**: IsAuthenticated
- **File**: [wallets/api/views.py](wallets/api/views.py#L82) - `PendingWalletTransactionListAPIView.get()`
- **Class**: `PendingWalletTransactionListAPIView` (line 82)

---

## Notification APIs

#### 1. Device Upsert
- **Endpoint**: `/api/v1/notifications/devices/`
- **HTTP Method**: `POST`
- **Açıklama**: Push notification cihazını kaydeder/günceller (FCM token)
- **Authentication**: IsAuthenticated
- **Throttle**: DeviceUpsertThrottle
- **File**: [notifications/views.py](notifications/views.py) - `DeviceUpsertAPIView.post()`
- **Class**: `DeviceUpsertAPIView`

#### 2. Notification List
- **Endpoint**: `/api/v1/notifications/`
- **HTTP Method**: `GET`
- **Açıklama**: Kullanıcının notification geçmişini listeler
- **Authentication**: IsAuthenticated
- **File**: [notifications/views.py](notifications/views.py) - `NotificationListAPIView.get()`
- **Class**: `NotificationListAPIView`

#### 3. Notification Readiness
- **Endpoint**: `/api/v1/notifications/readiness/`
- **HTTP Method**: `GET`
- **Açıklama**: Push notification hazırlık durumunu döndürür
- **Authentication**: IsAuthenticated
- **File**: [notifications/views.py](notifications/views.py) - `NotificationReadinessAPIView.get()`
- **Class**: `NotificationReadinessAPIView`

#### 4. Admin Broadcast Notification
- **Endpoint**: `/api/v1/notifications/admin/broadcast/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü genel/kategori/ilçe bazlı broadcast notification gönderir
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **Throttle**: AdminBroadcastThrottle
- **File**: [notifications/views.py](notifications/views.py) - `AdminBroadcastAPIView.post()`
- **Class**: `AdminBroadcastAPIView`

---

## Payout APIs

#### 1. Ops Dispatch Due Payouts
- **Endpoint**: `/api/v1/ops/payouts/dispatch-due/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü vadesi gelmiş ödemeleri gönderir
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **Throttle**: OpsActionThrottle
- **File**: [payouts/api/views.py](payouts/api/views.py#L44) - `DispatchDuePayoutsAPIView.post()`
- **Class**: `DispatchDuePayoutsAPIView` (line 44)

#### 2. Ops Payouts List
- **Endpoint**: `/api/v1/ops/payouts/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü tüm ödeme işlemlerini listeler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payouts/api/views.py](payouts/api/views.py#L64) - `PayoutListAPIView.get()`
- **Class**: `PayoutListAPIView` (line 64)

#### 3. Ops Payout Detail
- **Endpoint**: `/api/v1/ops/payouts/{payout_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir ödeme işleminin detaylarını görüntüler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payouts/api/views.py](payouts/api/views.py#L73) - `PayoutDetailAPIView.get()`
- **Class**: `PayoutDetailAPIView` (line 73)

#### 4. Ops Payout Confirm
- **Endpoint**: `/api/v1/ops/payouts/{payout_id}/confirm/`
- **HTTP Method**: `POST`
- **Açıklama**: Sistem operatörü ödeme işlemini onaylar
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payouts/api/views.py](payouts/api/views.py#L82) - `ConfirmPayoutAPIView.post()`
- **Class**: `ConfirmPayoutAPIView` (line 82)

#### 5. Ops Dashboard
- **Endpoint**: `/api/v1/ops/dashboard/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem operatörü ödeme/settlement dashboard'unu görüntüler
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payouts/api/views.py](payouts/api/views.py#L122) - `OpsDashboardAPIView.get()`
- **Class**: `OpsDashboardAPIView` (line 122)

#### 6. Ops Reconcile Business
- **Endpoint**: `/api/v1/ops/reconcile/business/{business_id}/`
- **HTTP Method**: `GET`
- **Açıklama**: Belirli bir işletme için finansal mutabakat raporunu döndürür
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payouts/api/views.py](payouts/api/views.py#L152) - `ReconcileBusinessAPIView.get()`
- **Class**: `ReconcileBusinessAPIView` (line 152)

#### 7. Ops Metrics
- **Endpoint**: `/api/v1/ops/metrics/`
- **HTTP Method**: `GET`
- **Açıklama**: Sistem metrikleri (finansal KPI'lar) döndürür
- **Authentication**: IsAuthenticated
- **Permissions**: AdminRole
- **File**: [payouts/api/views.py](payouts/api/views.py#L23) - `MetricsAPIView.get()`
- **Class**: `MetricsAPIView` (line 23)

---

## Health APIs

#### 1. Health Check
- **Endpoint**: `/health/`
- **HTTP Method**: `GET`
- **Açıklama**: Temel sağlık kontrolü (liveness probe)
- **Authentication**: AllowAny
- **File**: [health/views.py](health/views.py) - `healthz()`
- **Type**: Function-based view

#### 2. Readiness Check
- **Endpoint**: `/health/readiness/`
- **HTTP Method**: `GET`
- **Açıklama**: Detaylı readiness probe (database, cache, broker, migrations)
- **Authentication**: AllowAny
- **File**: [health/views.py](health/views.py) - `readyz()`
- **Type**: Function-based view

#### 3. Metrics (Prometheus)
- **Endpoint**: `/health/metrics/`
- **HTTP Method**: `GET`
- **Açıklama**: Prometheus formatı metrikleri döndürür
- **Authentication**: AllowAny
- **File**: [health/views.py](health/views.py) - `MetricsAPIView.get()`
- **Class**: `MetricsAPIView`

---

## Özet İstatistikler

**Toplam Endpoint Sayısı**: 73+

### Bölüne Göre Dağılım:
- **Authentication**: 4
- **Schema & Documentation**: 3
- **Orders & Cart**: 8
- **Checkout**: 7
- **Public Discovery & Catalog**: 6
- **Business Management**: 10
- **Business Operations**: 10
- **Payments**: 19
- **Wallets**: 3
- **Notifications**: 4
- **Payouts**: 7
- **Health**: 3

### HTTP Metod Dağılımı:
- **GET**: ~35
- **POST**: ~25
- **PATCH**: ~5
- **PUT**: ~3
- **DELETE**: ~5

---

## Son Notlar

- Tüm API endpoints Django REST Framework (DRF) üzerine kuruludur
- ViewSets, APIView ve generics.ListCreateAPIView kullanılıyor
- Tüm endpoints drf-spectacular ile dokumente edilmiştir
- Permissions: IsAuthenticated, IsAdminRole, HasActivePushDevice gibi custom permissions
- Throttling: LoginRateThrottle, GoogleLoginThrottle, PaymentCreateThrottle vb.
- Tüm POST/PATCH/PUT endpoints JSON content-type enforcement'a tabidir
- Iyzico ve provider webhook'ları signature verification ile korunur
