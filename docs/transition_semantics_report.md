# Transition Semantics Final Report

## Resmi semantik

- Business yetkisi yalnızca `BusinessMember` üyeliğinden türetilir.
- `BusinessProfile.contact_user` artık yalnızca metadata/KYC provenance alanıdır.
- Business contact response yüzeylerinde resmi alan: `contact = {contact_user_id, email, gsm_number}`
- Checkout yüzeylerinde resmi toplam alan: `total_payable_amount`
- Consume response ve order yüzeylerinde resmi toplam alan: `total_charged_amount`
- Business earning semantiğinde resmi alan: `net_amount`

## Temizlenen transition/compatibility izleri

- Ops business list/detail yüzeylerinde `contact_user` tabanlı arama/semantik kaldırıldı.
- Admin yüzeyinde business contact görünümü KYC/contact semantiğine çekildi; raw user fallback araması kaldırıldı.
- Checkout preview/detail ve consume response alanlarında resmi toplam adları eklendi.
- Business operations order/session response yüzeyleri resmi toplam adlarıyla hizalandı.
- Order API serializer içinde `amount` deprecated mirror olarak işaretlendi.

## Bilerek bırakılan compatibility alanları

- `Order.amount`: veritabanı ve mevcut akış uyumu için korunur; dış API’de deprecated mirror kabul edilmelidir.
- Checkout/session response `amount`: `total_payable_amount` mirror’ıdır; yeni frontend kullanmamalıdır.
- Consume response `amount`: `total_charged_amount` mirror’ıdır; yeni frontend kullanmamalıdır.
- `BusinessProfile.contact_user`: destructive migration yapılmadan metadata/KYC provenance için tutulur; auth/permission/notification targeting buradan türetilmez.

## Frontend ve ops için resmi kullanım

- Frontend checkout toplamı: `total_payable_amount`
- Frontend order toplamı: `total_charged_amount`
- Frontend/ops business gelirleri: `business_net_amount` ve earning tarafında `net_amount`
- Ops business contact: `contact.email`, `contact.gsm_number`
- Yetki kontrolü: yalnızca business membership
