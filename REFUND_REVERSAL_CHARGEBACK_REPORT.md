# Refund / Reversal / Chargeback Domain Report

## Mevcut durum özeti

Repo içinde ters finansal akışlar için sadece parçalı altyapı vardı:

- `wallets/services.py` içinde yalnızca genel amaçlı `refund()` ve `adjustment()` vardı.
- `orders` domaininde order refund state'i yoktu.
- `payments` domaininde refund / reversal / chargeback için ayrı kayıt modeli yoktu.
- `payouts` domaininde earning tersleme veya next-cycle adjustment modeli yoktu.
- Settlement / payout / earning zinciri tek yönlü tasarlanmıştı; ters finansal olaylar için resmi domain objesi eksikti.

## Ana riskler

1. **Yanlış consume / fulfillment başarısızlığı** durumunda müşteri wallet iadesi yapılabilse bile business earning tarafında resmi ters kayıt oluşmuyordu.
2. **Payout öncesi** earning düşümü ile **payout sonrası** next-cycle mahsuplaşma birbirinden ayrılmamıştı.
3. **Topup reversal / chargeback** için pending balance ve available balance ayrımı domain seviyesinde tanımlı değildi.
4. Audit / reconciliation tarafında refund kaynaklı finansal farkları taşıyacak kalıcı model yoktu.

## Bu pakette eklenen temel yapı

### 1) Order refund state alanları
- `orders.models.Order`
  - `refund_status`
  - `refunded_amount`
  - `refunded_at`
  - `chargeback_amount`
  - `chargeback_at`
  - `register_refund()` helper

### 2) Wallet reversal tipleri
- `wallets.models.WalletTransaction.Type`
  - `REVERSAL`
  - `CHARGEBACK`
- `wallets.models.PendingWalletTransaction.Type`
  - `REVERSAL_OUT`
- `wallets.services.WalletService`
  - `_apply_pending()`
  - `reverse_available_funds()`
  - `reverse_topup_payment_intent()`

### 3) Payment reversal kayıt modeli
- `payments.models.PaymentReversal`
  - `ORDER_REFUND`
  - `TOPUP_REVERSAL`
  - `CHARGEBACK`
- `payments/services_reversals.py`
  - `PaymentReversalService.apply_order_refund()`
  - `PaymentReversalService.apply_topup_reversal()`
  - `PaymentReversalService.apply_chargeback()`

### 4) Business earning ve payout adjustment
- `payouts.models.BusinessEarning`
  - `reversed_amount`
  - `reversed_at`
  - `REVERSED` status
- `payouts.models.PayoutAdjustment`
- `payouts.services`
  - `get_earning_outstanding_amount()`
  - `BusinessReversalService.reverse_order_earning()`
  - payout batch toplamı artık `net_amount - reversed_amount` üzerinden hesaplanıyor
  - pending `PayoutAdjustment` kayıtları yeni payout batch total'ına mahsup ediliyor

## Finansal karar matrisi

### Payout öncesi düzeltilebilir
- yanlış consume
- fulfillment başarısızlığı
- order iptali / order refund
- kısmi order refund

Bu durumda:
- müşteri wallet'a refund yazılır
- earning `reversed_amount` artar
- earning henüz payout'a girmediyse doğrudan yerinde terslenir

### Next-cycle adjustment gerektirenler
- payout item oluşmuş earning
- payout gönderilmiş earning
- payout confirmed earning
- chargeback sonrası business alacağından geri alma

Bu durumda:
- müşteri tarafı reversal/chargeback uygulanır
- business için negatif `PayoutAdjustment` açılır
- ilk uygun sonraki payout batch'inde mahsup edilir

## Hâlâ açık olan konular

1. Provider tarafı gerçek refund / chargeback webhook mapping'i henüz bağlanmadı.
2. Admin/Ops API yüzeyi eklenmedi; servis katmanı hazırlandı.
3. Reconciliation ve anomaly reporting tarafında yeni reversal modelleri henüz taranmıyor.
4. Kullanıcı wallet'ında yetersiz bakiye varsa topup chargeback için daha sert tahsilat/borç mantığı ayrıca tasarlanmalı.
5. Repo genelinde mevcut migration zincirinde önceden gelen teknik sorunlar var; bu paket yeni migration dosyalarını ekliyor ama mevcut proje migration sağlığı ayrıca toparlanmalı.

## Önerilen sonraki adım

Bir sonraki iterasyonda şu 3 alan birlikte tamamlanmalı:
- ops/admin refund endpoints
- reconciliation/anomaly entegrasyonu
- provider webhook -> `PaymentReversalService` köprüsü


## Bu iterasyonda finalize edilen ek kararlar

- Admin/Ops API yüzeyi tamamlandı: refund, topup reversal, chargeback, reversal listesi ve manual-review resolve endpointi mevcut.
- Provider webhook mapping aktif: mock ve iyzico reversal/chargeback event'leri resmi `PaymentReversalService` akışına bağlandı.
- Topup chargeback insufficient-balance kararı kodlandı:
  - pending funds önce çekilir
  - sonra mevcut available balance kadar tahsil edilir
  - kalan kısım `outstanding_exposure_amount` olarak açık tutulur
  - wallet bloklanır
  - kullanıcı yeni bakiye yüklediğinde ops `resolve` endpointi ile tahsilatı tamamlar
- `PaymentReversal` artık partial wallet effect alanlarını taşır:
  - `pending_reversed_amount`
  - `available_reversed_amount`
  - `outstanding_exposure_amount`
  - `review_status`
  - `blocked_wallet`
- Integrity ve anomaly komutları artık partial reversal toplamı, outstanding exposure ve wallet block tutarlılığını da tarar.
