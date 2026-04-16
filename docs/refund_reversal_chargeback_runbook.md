# Refund / Reversal / Chargeback Runbook

## Scope

Bu runbook şu ters finansal akışları kapsar:

- order refund
- topup reversal
- chargeback
- payout öncesi earning tersleme
- payout sonrası next-cycle payout adjustment
- provider webhook mapping
- integrity / anomaly operasyonları

Ana ürün akışı değişmez:

`Cart-backed checkout -> QR consume -> order finalize -> wallet ledger -> earning -> payout -> settlement`

Ters akışlar bu zincire kontrollü ve idempotent şekilde bağlanır.

## Domain davranışı

### 1. Order refund

Ops endpoint:

- `POST /api/v1/payments/ops/orders/<order_id>/refund/`

Beklenen davranış:

- `PaymentReversal(type=ORDER_REFUND)` oluşturulur.
- müşteri wallet'ına `REFUND` ledger satırı yazılır.
- `Order.refunded_amount` ve `refund_status` güncellenir.
- earning payout'a girmediyse `BusinessEarning.reversed_amount` yerinde artırılır.
- earning mutable payout içindeyse payout item / payout total azaltılır.
- payout gönderilmiş veya confirmed ise negatif `PayoutAdjustment` açılır.

### 2. Topup reversal

Ops endpoint:

- `POST /api/v1/payments/ops/intents/<intent_id>/topup-reversal/`

Beklenen davranış:

- `PaymentReversal(type=TOPUP_REVERSAL)` oluşturulur.
- önce `pending_balance` düşülür.
- kalan varsa `available balance` düşülür.
- toplam reversal, payment intent amount’unu geçemez.

### 3. Chargeback

Ops endpoint:

- `POST /api/v1/payments/ops/chargebacks/`

`source=payment_intent`:

- topup chargeback gibi çalışır
- wallet etkisi beklenir
- gerekirse manual review'ya düşebilir

`source=order`:

- order chargeback gibi çalışır
- müşteri wallet'ına yeni refund yazılmaz
- business earning etkisi zorunludur
- payout sonrası ise `PayoutAdjustment` açılır

## Provider event mapping

### Mock provider webhook

Endpoint:

- `POST /api/v1/payments/webhook/provider/`

Desteklenen event tipleri:

- `payment.paid`
- `payment.reversal`
- `payment.chargeback`
- `payment.order_refund`
- `payment.order_chargeback`

Davranış:

- event önce `ProviderEvent` olarak unique kaydedilir
- duplicate event aynı `provider + event_id` ile ikinci kez işlenmez
- reversal event’leri doğrudan `PaymentReversalService`’e köprülenir

### iyzico webhook

Endpoint:

- `POST /api/v1/payments/webhooks/iyzico/`

Desteklenen reversal/chargeback event tipleri:

- `PAYMENT_REVERSAL`
- `TOPUP_REVERSAL`
- `REFUND`
- `PAYMENT_CHARGEBACK`
- `CHARGEBACK`

Davranış:

- signature v3 doğrulanır
- `ProviderEvent(provider=IYZICO, event_id=iyziReferenceCode)` üzerinden duplicate güvenliği sağlanır
- topup reversal/chargeback event'leri `PaymentReversalService` ile resmi domain'e işlenir
- order chargeback için payload içinde `order_id` / `orderId` varsa order domain'ine map edilir

## Payout öncesi / payout sonrası farkı

### Payout öncesi

Şunlardan biri varsa yerinde tersleme yapılır:

- earning henüz `PENDING` / `ELIGIBLE`
- payout item mutable statüde (`CREATED`, `FAILED`, `CANCELLED`)

Sonuç:

- `BusinessEarning.reversed_amount` artar
- payout item ve payout batch total gerekirse düşer
- tam tersleme olduysa payout iptal edilebilir

### Payout sonrası

Şunlardan biri varsa next-cycle adjustment açılır:

- payout `SENT`
- payout `CONFIRMED`
- locked payout item artık mutable değil

Sonuç:

- earning yine terslenmiş sayılır
- business tahsilatı geçmiş cycle’da yapıldığı için negatif `PayoutAdjustment` açılır
- sonraki uygun payout batch’inde mahsup edilir

## Yetersiz bakiye kuralı

Topup reversal / chargeback sırasında sistem şu sırayı uygular:

1. pending balance düş
2. kalan varsa available balance düş
3. available balance yetmiyorsa reversal kaydı `REQUESTED` statüsünde bırak

Bu durumda:

- `failure_reason` alanı `INSUFFICIENT_AVAILABLE_BALANCE_MANUAL_REVIEW...` ile dolar
- event duplicate ise ikinci kez yeni kayıt oluşmaz
- bu kayıt ops kuyruğu / anomaly / integrity tarafında görünür
- sistem otomatik negatif wallet üretmez

Bu ürün kararıyla, sessiz veri bozulması veya kontrolsüz eksi bakiye yerine görünür operasyonel borç durumu yaratılır.

## Ops gözlem yüzeyi

Liste endpoint:

- `GET /api/v1/payments/ops/reversals/`

Filtreler:

- `status`
- `reversal_type`
- `payment_intent_id`
- `order_id`

Response içinde şu alanlar takip edilir:

- reversal type
- status
- amount
- reason_code
- note
- idempotency_key
- wallet_effect_applied
- business_effect_applied
- failure_reason
- payment_intent / order / provider_event ilişkileri
- bağlı payout adjustment id’leri

## Integrity ve anomaly

### verify_financial_integrity

Komut:

- `python manage.py verify_financial_integrity`

Yeni reversal kontrolleri:

- applied reversal ama beklenen wallet effect yok
- order refund ama business effect yok
- chargeback/topup reversal toplamı intent amount’u aşıyor
- `REQUESTED + failure_reason` durumundaki manual review kayıtları
- applied payout adjustment ama payout bağlı değil
- duplicate payout adjustment for same payment reversal

### report_financial_anomalies

Komut:

- `python manage.py report_financial_anomalies`

Yeni görünür riskler:

- `REVERSAL_MANUAL_REVIEW_REQUIRED`
- `REVERSAL_APPLIED_WITHOUT_WALLET_EFFECT`
- `ORDER_REVERSAL_WITHOUT_BUSINESS_EFFECT`
- `TOPUP_REVERSED_OVER_AMOUNT`
- `APPLIED_ADJUSTMENT_WITHOUT_PAYOUT`

## Operasyon akışı önerisi

### Order refund

1. order doğrulanır
2. ops refund endpoint’i çağırır
3. reversal kaydı oluşur
4. wallet, earning, payout etkileri tek transaction içinde uygulanır
5. reversal list endpoint’inden sonuç kontrol edilir

### Topup reversal / chargeback

1. provider event veya bank dispute gelir
2. ops intent/order kaynağını doğrular
3. reversal/chargeback endpoint’i veya provider webhook işlemi çalışır
4. sonuç `APPLIED` ise ledger tamamdır
5. sonuç `REQUESTED` ise manual review kuyruğuna alınır
6. anomaly ve integrity komutları ile açık risk izlenir

## Test kapsamı

Bu scope için testlenen ana senaryolar:

- partial refund
- full refund
- chargeback
- topup reversal
- duplicate provider event
- payout öncesi earning reversal
- payout sonrası payout adjustment
- webhook -> reversal mapping
- manual review / insufficient balance
- integrity / anomaly command görünürlüğü
- ops admin response contract
