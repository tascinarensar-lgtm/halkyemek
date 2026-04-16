# Final Delivery Guide

Bu doküman local demo, final regression smoke ve teslim öncesi operasyonel beklentileri tek parçada toplar.

## 1. Kapsam

Bu repo için resmi ürün akışı değişmez:

`Google login -> discovery -> cart -> checkout preview -> checkout session -> QR -> business consume -> order -> wallet düşümü -> business earning -> payout -> settlement`

Bu rehber feature geliştirme rehberi değildir. Amaç, repo’yu ayağa kaldırmak, demo veriyi seed etmek, temel smoke sırasını uygulamak ve kalan gerçek entegrasyon bağımlılıklarını dürüstçe görünür kılmaktır.

## 2. Gereksinimler

### Backend
- Python 3.12+ önerilir
- pip
- SQLite local demo için yeterlidir
- Postgres + Redis staging/production için zorunludur

### Frontend
- Node 22+
- npm 10+

### Gerçek entegrasyonlar
- Google OAuth client
- FCM service account
- iyzico sandbox/prod credential’ları
- payout/settlement operasyon dosyaları ve provider geri bildirimleri

## 3. Hızlı kurulum

### Backend
```bash
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py check
```

### Frontend
```bash
cd frontend
npm install
npm run typecheck
npm run build
cd ..
```

## 4. Environment dosyaları

### Backend
- local başlangıç: `.env.example`
- staging başlangıç: `.env.staging.example`
- production başlangıç: `.env.prod.example`

### Frontend
- başlangıç: `frontend/.env.example`
- local kullanım: `frontend/.env.local` oluştur

Minimum local frontend değişkenleri:
- `NEXT_PUBLIC_API_BASE_URL`
- gerekiyorsa auth/proxy ile ilgili diğer örnek değişkenler

## 5. Demo bootstrap sırası

```bash
python manage.py bootstrap_marketplace --district BEYLIKDUZU
python manage.py verify_bootstrap_marketplace --district BEYLIKDUZU
python manage.py bootstrap_demo_data --district BEYLIKDUZU
```

Komutlar idempotent olacak şekilde tasarlanmıştır; aynı komutu tekrar çalıştırmak mevcut demo kayıtlarını günceller, duplicate veri üretmemelidir.

## 6. Demo kullanıcıları

Varsayılan demo hesapları:
- customer: `demo.customer@example.com`
- business: `demo.business@example.com`
- ops: `demo.ops@example.com`
- local parola: `Demo12345!`

Notlar:
- Resmi ürün login akışı Google OAuth’tur.
- Local parola destekli kullanıcılar demo/debug kolaylığı içindir.
- Gerçek Google hesabını seed edilen kullanıcıya bağlamak istenirse `bootstrap_demo_data` komutundaki email override parametreleri kullanılmalıdır.

Örnek:
```bash
python manage.py bootstrap_demo_data \
  --district BEYLIKDUZU \
  --customer-email senin.google@gmail.com \
  --business-email senin.business.google@gmail.com \
  --ops-email senin.ops.google@gmail.com \
  --bind-google-emails
```

## 7. Çalıştırma

### Backend
```bash
python manage.py runserver
```

### Frontend
```bash
cd frontend
npm run dev
```

## 8. Smoke test sırası

### A. Public yüzey
Kontrol et:
- `/`
- `/kategoriler`
- `/kategoriler/ev-yemegi`
- `/isletmeler`
- `/isletmeler/{featured_business_id}`
- `/isletmeler/{featured_business_id}/menu`

Beklenen:
- discovery boş gelmez
- business kartları ve medya görünür
- menu ve aktif offer alanları doludur

### B. Customer yüzey
Google login sonrası kontrol et:
- `/sepet`
- `/checkout`
- `/siparislerim`
- `/siparislerim/{order_id}`
- `/cuzdan`
- `/bildirimler`

Beklenen:
- aktif cart vardır
- geçmiş sipariş görünür
- wallet bakiyesi görünür
- bildirim alanı boş ekran vermez

### C. Business yüzey
Google login sonrası kontrol et:
- `/isletme`
- `/isletme/{business_id}`
- `/isletme/{business_id}/gecmis`
- `/isletme/{business_id}/profil`
- `/isletme/{business_id}/yonetim/teklifler`

Beklenen:
- business switcher boş gelmez
- consume/history zinciri veriyle açılır
- profile/menu/offer alanları okunabilir durumdadır

### D. Ops yüzey
Admin login sonrası kontrol et:
- `/ops`
- `/ops/isletmeler`
- `/ops/payoutlar`
- `/ops/settlement`
- `/ops/settlement/importlar`
- `/ops/settlement/kayitlar`
- `/ops/bildirimler/yayinla`

Beklenen:
- payout ve settlement yüzeyleri boş ekrana düşmez
- review bekleyen business kaydı görünür
- broadcast ekranı submit edilebilir durumda açılır

## 9. Doğrulama komutları

### Backend temel kontroller
```bash
python manage.py check
python manage.py check --deploy
python manage.py test common.tests.test_bootstrap_demo_data_command -v 2
```

Not:
- `check --deploy` local/dev ortamında güvenlik warning’leri üretir; bu beklenir.
- staging/prod için `final_preflight_check` ve release acceptance akışları ayrıca çalıştırılmalıdır.

### Frontend temel kontroller
```bash
cd frontend
npm run typecheck
npm run build
```

## 10. Test kullanıcıları ve demo veri kapsamı

Demo bootstrap şu alanlarda anlamlı başlangıç verisi üretir:
- marketplace kategorileri
- 3 demo kullanıcı
- 3 demo işletme
- business memberships
- kategori + menü + medya + offer kayıtları
- aktif cart
- pending ve consumed checkout session örnekleri
- order geçmişi
- wallet/topup örnekleri
- payout örnekleri
- settlement import + settlement record örnekleri
- notification örnekleri

## 11. Bilinen gerçek bağımlılıklar

Aşağıdaki alanlar demo veriyle görünür hale gelir ama tam gerçek dünya doğrulaması yine gerektirir:

### Google OAuth
- gerçek Google Cloud Console kurulumu gerekir
- redirect URI ve client id doğru tanımlanmalıdır
- ilk gerçek login için kullanıcı email eşleşmesi önemlidir

### FCM
- gerçek cihaz/token gerekir
- service account eksiksiz olmalıdır
- local demo verisi push teslim garantisi vermez

### iyzico
- sandbox/prod credential gerekir
- gerçek ödeme başlatma, callback ve settlement dosya akışı provider bağımlıdır
- local seed kayıtları entegrasyonun yerini tutmaz

### payout / settlement
- gerçek dispatch, status sync ve settlement doğrulaması operasyona ve provider kanıtına bağlıdır
- local demo verisi yalnızca ekranların boş kalmamasını sağlar

## 12. Production öncesi ek doğrulamalar

Staging/prod öncesinde ayrıca doğrulanmalı:
- `DEBUG=False`
- güçlü `SECRET_KEY`
- `ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- HTTPS ve HSTS politikaları
- Postgres/Redis/Celery/beat sağlığı
- Google OAuth / FCM / iyzico / webhook secret’ları
- strict readiness ve release acceptance çıktıları
- financial integrity ve anomaly komutları

## 13. Operasyonel gerçekçilik notu

Bu repo local demo ve final smoke açısından daha kullanılabilir hale getirilebilir; buna rağmen aşağıdaki ifadeler dikkatle kullanılmalıdır:
- “production-ready” ancak staging/prod doğrulamaları tamamlandığında söylenmelidir
- local build geçmesi, gerçek OAuth/FCM/iyzico operasyonunun doğrulandığı anlamına gelmez
- demo seed varlığı, finansal operasyon kanıtı yerine geçmez

## 14. İlgili ek dokümanlar
- `docs/development_demo_bootstrap_and_smoke.md`
- `FINAL_RELEASE_HANDOFF.md`
- `frontend/FRONTEND_DELIVERY_HANDOFF.md`
- `DEPLOYMENT_CHECKLIST.md`
- `ROLLBACK_PLAN.md`
