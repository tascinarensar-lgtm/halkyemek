# Development demo bootstrap + smoke test

Bu doküman local/development ayağa kaldırma sırasında public/customer/business/ops yüzeylerinin anlamsız boş kalmaması için kullanılacak resmi demo bootstrap akışını tarif eder.

## 1. Komutlar

### Resmi marketplace category bootstrap
```bash
python manage.py bootstrap_marketplace --district BEYLIKDUZU
python manage.py verify_bootstrap_marketplace --district BEYLIKDUZU
```

### Yeni demo bootstrap komutu
```bash
python manage.py bootstrap_demo_data --district BEYLIKDUZU
```

İstersen kendi gerçek Google hesabını mevcut demo kullanıcısına bağlayabilmek için email’leri override edebilirsin:

```bash
python manage.py bootstrap_demo_data \
  --district BEYLIKDUZU \
  --customer-email senin.google@gmail.com \
  --business-email senin.business.google@gmail.com \
  --ops-email senin.ops.google@gmail.com \
  --bind-google-emails
```

## 2. Ne oluşturur?

Komut idempotenttir; aynı komutu ikinci kez çalıştırmak mevcut demo kayıtlarını günceller, duplicate veri üretmez.

Oluşturulan kapsam:

- resmi Beylikdüzü marketplace kategorileri
- 3 demo kullanıcı
  - `demo_customer`
  - `demo_business`
  - `demo_ops`
- 3 demo işletme
  - herkese açık featured işletme
  - herkese açık volunteer işletme
  - ops ekranlarında review bekleyen işletme
- business membership kayıtları
- kategori + menü + medya + aktif offer kayıtları
- customer için aktif cart
- pending ve consumed checkout session örnekleri
- paid/used order geçmişi
- wallet bakiyesi
- topup payment intent örneği
- payout + confirmed payout örneği
- settlement import + matched/unmatched settlement record örnekleri
- notification + delivery attempt örnekleri
- bazı scheduler heartbeat kayıtları

## 3. Demo kullanıcı stratejisi

Varsayılan kullanıcılar:

- customer: `demo.customer@example.com`
- business: `demo.business@example.com`
- ops: `demo.ops@example.com`
- local parola: `Demo12345!`

Notlar:

- Ürün akışı hâlâ resmi olarak Google login üzerindedir.
- Bu parolalar local admin/debug kolaylığı içindir; ürün login akışını değiştirmez.
- Frontend’de resmi role bazlı akışı gerçekten denemek istiyorsan komutu kendi gerçek Google email’lerinle tekrar çalıştırıp `--bind-google-emails` kullan.
- `google_sub` boş bırakılır; ilk başarılı Google login sırasında mevcut email ile eşleşen kullanıcı claim edilir ve resmi auth akışı korunur.

## 4. Önerilen smoke sırası

### Backend bootstrap
```bash
python manage.py migrate
python manage.py bootstrap_marketplace --district BEYLIKDUZU
python manage.py verify_bootstrap_marketplace --district BEYLIKDUZU
python manage.py bootstrap_demo_data --district BEYLIKDUZU
python manage.py check
```

### Frontend / backend run
- backend: `python manage.py runserver`
- frontend: `npm install && npm run dev`

## 5. Smoke URL checklist

### Public
- `/`
- `/kategoriler`
- `/kategoriler/ev-yemegi`
- `/isletmeler`
- `/isletmeler/{featured_business_id}`
- `/isletmeler/{featured_business_id}/menu`

Beklenen:
- discovery categories boş değil
- featured business kartları dolu
- diğer işletmeler alanı boş değil
- business detail içinde menu / medya / offer görünür

### Customer
Gerçek customer Google login sonrası:
- `/sepet`
- `/checkout`
- `/siparislerim`
- `/siparislerim/{order_id}`
- `/cuzdan`
- `/bildirimler`

Beklenen:
- aktif cart hazır gelir
- sipariş geçmişi boş değildir
- wallet balance görünür
- notification readiness en az 1 aktif cihaz gösterir

### Business
Gerçek business Google login sonrası:
- `/isletme`
- `/isletme/{business_id}`
- `/isletme/{business_id}/profil`
- `/isletme/{business_id}/yonetim/teklifler`

Beklenen:
- business switcher boş gelmez
- dashboard summary pending/latest consumed session gösterir
- profile / category / menu / offers alanları veriyle açılır

### Ops
Gerçek ops/admin Google login sonrası:
- `/ops`
- `/ops/isletmeler`
- `/ops/payoutlar`
- `/ops/settlement`
- `/ops/settlement/importlar`
- `/ops/settlement/kayitlar`
- `/ops/bildirimler/yayinla`

Beklenen:
- businesses listesi boş değil
- payout listesi boş değil
- settlement import ve unmatched kayıt örneği görünüyor
- broadcast ekranı submit’e hazır

## 6. İlk bozulmada nereye bakılır?

1. `python manage.py bootstrap_demo_data` çıktı verdi mi?
2. `python manage.py verify_bootstrap_marketplace --district BEYLIKDUZU` geçiyor mu?
3. `python manage.py shell` içinde şu sayılar anlamlı mı?
   - `BusinessProfile.objects.count()`
   - `MenuItem.objects.count()`
   - `Order.objects.count()`
   - `Payout.objects.count()`
   - `SettlementImport.objects.count()`
4. frontend `.env` içinde `NEXT_PUBLIC_API_BASE_URL` doğru mu?
5. Google login deniyorsa, kullanılan email bootstrap sırasında seed edilen email ile eşleşiyor mu?

## 7. Hâlâ gerçek entegrasyon bağımlılığı olan alanlar

Aşağıdakiler demo veriyle görünür hâle gelir ama tam gerçek dünyayı temsil etmez:

- gerçek Google OAuth popup + ID token alma
- gerçek Iyzico ödeme başlatma / callback / settlement dosyası
- gerçek FCM push gönderimi
- gerçek payout provider dispatch/status sync

Demo bootstrap bunları taklit eden görünür kayıtlar üretir; production entegrasyon mantığını değiştirmez.
