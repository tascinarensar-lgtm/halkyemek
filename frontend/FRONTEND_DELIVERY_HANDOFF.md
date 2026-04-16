# Frontend Delivery Handoff

## Amaç
Bu doküman, mevcut frontend’in final entegrasyon kapanışı sonrası hangi alanlardan doğrulanması gerektiğini kısa biçimde özetler.

## Kritik rotalar
- Public: `/`, `/kategoriler`, `/isletmeler`, `/isletmeler/[businessId]`, `/isletmeler/[businessId]/menu`
- Customer: `/giris`, `/sepet`, `/checkout`, `/checkout/[token]`, `/siparislerim`, `/cuzdan`, `/cuzdan/yukle`, `/bildirimler`, `/hesabim`
- Business: `/isletme`, `/isletme/[businessId]`, `/isletme/[businessId]/gecmis`, `/isletme/[businessId]/tuket/[token]`, `/isletme/[businessId]/profil`, `/isletme/[businessId]/yonetim/*`
- Ops: `/ops`, `/ops/isletmeler`, `/ops/isletmeler/[businessId]`, `/ops/payoutlar`, `/ops/settlement`, `/ops/bildirimler/yayinla`

## Öncelikli akışlar
1. Home → business detail → menu → cart → checkout → QR → order
2. Login → hesabım → wallet → topup → notifications
3. Business hub → dashboard → consume → history → order detail → profile → management
4. Ops dashboard → business detail → membership/status → payout/settlement → broadcast

## Final kontrol başlıkları
- Route geçişlerinde kopuk href veya yanlış param kalmaması
- Mutation sonrası detail/list ekranlarının stale kalmaması
- Submit sırasında çift tetikleme riskinin sınırlanması
- Hata / boş / loading fallback’lerinin kullanıcıyı boş ekranda bırakmaması
- Kritik detail ekranlarında geri dönüş yolunun görünür olması
- Ops aksiyonlarında sonuç bilgisinin yalnız toast ile değil ekran üzerinde de görünür kalması
- Invalid route param veya partial response durumlarında kontrollü fallback verilmesi

## Çalıştırma
```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run typecheck
npm run build
npm run dev
```

## Not
- Canonical npm lockfile: `frontend/package-lock.json`
- Bu teslim, mevcut mimariyi koruyarak son kalite boşluklarını kapatmayı hedefler; yeni feature veya route mimarisi değişikliği içermez.

## Manual smoke test önerisi
- Önce auth/session/proxy hattını `giris -> protected route -> logout -> protected route` şeklinde doğrulayın.
- Sonra customer akışını sepetten checkout token oluşumuna kadar yürütün.
- Ardından business consume ve history ekranlarını deneyin.
- Son olarak ops tarafında business detail, memberships, status, iyzico, payout, settlement ve broadcast zincirini tek oturumda gezin.
