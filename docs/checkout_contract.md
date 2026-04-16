# Checkout Contract Cleanup

## Kaldırılan legacy davranış

- `POST /api/v1/checkout-sessions/` artık `menu_item_id` kabul etmez.
- Checkout create endpoint'i artık tek ürün ekle + anında checkout hibrit davranışı yapmaz.
- Resmi akış dışında kalan tek ürün odaklı compatibility contract'ı dış API yüzeyinden kaldırılmıştır.

## Resmi sözleşme

1. Kullanıcı ürünleri `POST /api/v1/cart/items/` ile aktif sepetine ekler.
2. İstemci gerekirse `GET /api/v1/cart/` veya `GET /api/v1/cart/checkout-preview/` ile sepeti doğrular.
3. Checkout oluşturmak için `POST /api/v1/checkout-sessions/` çağrılır. İstek gövdesi boş JSON nesnesi olmalıdır: `{}`.
4. Backend aktif cart snapshot'ını dondurur, `CheckoutSession` üretir ve QR token döner.
5. İşletme personeli `POST /api/v1/businesses/{business_id}/checkout-sessions/{token}/consume/` ile tüketir.
6. Consume sonrası order finalize olur, wallet düşer, earning oluşur ve payout lifecycle devam eder.

## Frontend notu

Frontend checkout create çağrısından önce mutlaka cart endpoint'lerini kullanmalıdır. `menu_item_id` ile doğrudan checkout başlatma artık desteklenmez ve 400 döner.

## İç model notu

- `OrderItem`, `CartItem` ve `CheckoutSession.cart_snapshot` artık resmi ürün satırı sözleşmesidir.
- `Order.menu` ve `CheckoutSession.menu_item` alanları sadece temsilî/backfill uyumluluğu için tutulur; yeni entegrasyonlar bu alanlara güvenmemelidir.
