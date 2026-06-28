# HalkYemek Frontend

Next.js App Router tabanlı frontend yüzeyi; Django + DRF backend ile BFF/proxy modeli üzerinden konuşur. Bu repo sürümünde mevcut route, segment ve feature organizasyonu korunarak build/runtime sertleştirmesi hedeflenmiştir.

## Desteklenen yerel çalışma tabanı

- Node.js: 20.x veya 22.x
- npm: 10.x
- Backend varsayılan local adresi: `http://127.0.0.1:8000`
- Frontend varsayılan local adresi: `http://localhost:3000`

## Windows + PowerShell kurulum

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run typecheck
npm run build
npm run dev
```

## Kritik env alanları

- `NEXT_PUBLIC_API_BASE_URL`: backend base URL
- `NEXT_PUBLIC_APP_URL`: frontend public URL
- `NEXT_PUBLIC_DEFAULT_DISTRICT`: discovery fallback district
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: Google Identity Services client id
- `SESSION_COOKIE_PREFIX`: access/refresh/session cookie prefix
- `SESSION_COOKIE_SECURE`: local development için `false`, production için `true`

## Auth / session mantığı

- Browser login isteğini `/api/auth/login` route handler’ına gönderir.
- Backend `POST /api/v1/auth/google/` yanıtı normalize edilip httpOnly cookie set edilir.
- Üç ana cookie tutulur: `${SESSION_COOKIE_PREFIX}_access`, `${SESSION_COOKIE_PREFIX}_refresh`, `${SESSION_COOKIE_PREFIX}_session`.
- Browser session verisini yalnızca `/api/auth/session` üzerinden okur.
- Authenticated istekler doğrudan backend’e değil `/api/proxy/*` katmanına gider.
- Proxy access token süresi dolarsa kontrollü refresh + retry yapar.
- Refresh başarısızsa cookie temizlenir; client unauthorized state’e düşer.
- Logout `/api/auth/logout` ile cookie temizler; client query cache ayrıca resetlenir.

## Route yapısı

### Public

- `/`
- `/auth/callback`
- `/kategoriler`
- `/kategoriler/[slug]`
- `/isletmeler`
- `/isletmeler/[businessId]`

### Customer

- `/checkout`
- `/checkout/[token]`
- `/siparislerim`
- `/siparislerim/[orderId]`
- `/cuzdan`
- `/cuzdan/hareketler`
- `/cuzdan/bekleyen-islemler`
- `/cuzdan/yukle/sonuc`
- `/qrlarim`
- `/bildirimler`
- `/hesabim`

### Business

- `/isletme`
- `/isletme/[businessId]`
- `/isletme/[businessId]/tuket/[token]`
- `/isletme/[businessId]/gecmis`
- `/isletme/[businessId]/siparisler/[orderId]`
- `/isletme/[businessId]/profil`
- `/isletme/[businessId]?panel=menu`

### Ops

- `/ops`
- `/ops/isletmeler`
- `/ops/isletmeler/yeni`
- `/ops/isletmeler/[businessId]`
- `/ops/isletmeler/[businessId]/icerik`
- `/ops/isletmeler/[businessId]/uyelikler`
- `/ops/isletmeler/[businessId]/durum`
- `/ops/isletmeler/[businessId]/iyzico`
- `/ops/payoutlar`
- `/ops/payoutlar/[payoutId]`
- `/ops/payoutlar/[payoutId]/confirm`
- `/ops/payoutlar/dispatch`
- `/ops/reconcile/isletme/[businessId]`
- `/ops/settlement`
- `/ops/settlement/importlar`
- `/ops/settlement/importlar/[importId]`
- `/ops/settlement/kayitlar`
- `/ops/settlement/kayitlar/[recordId]`
- `/ops/bildirimler/yayinla`

### Redirect / drawer girişleri

- `/giris` -> `/?auth=login`
- `/sepet` -> `/?cart=open`
- `/cuzdan/yukle` -> `/cuzdan?topup=1`
- `/isletmeler/[businessId]/menu` -> `/isletmeler/[businessId]`
- `/isletme/[businessId]/yonetim/[section]` -> `/isletme/[businessId]?panel=[section]`

## Smoke test rotaları

1. Public discovery: `/` -> `/kategoriler` -> `/isletmeler` -> `/isletmeler/[businessId]`
2. Customer: `/?auth=login` -> `/?cart=open` -> `/checkout` -> `/checkout/[token]` -> `/siparislerim` -> `/qrlarim` -> `/cuzdan` -> `/bildirimler` -> `/hesabim`
3. Business: `/isletme` -> `/isletme/[businessId]` -> `/isletme/[businessId]?panel=menu` -> `/isletme/[businessId]/tuket/[token]` -> `/isletme/[businessId]/gecmis` -> `/isletme/[businessId]/profil`
4. Ops: `/ops` -> `/ops/isletmeler` -> `/ops/payoutlar` -> `/ops/settlement` -> `/ops/bildirimler/yayinla`

## Kritik akışlar

- login -> callback -> session restore -> protected route access
- menu -> cart -> checkout preview -> QR detail -> order
- wallet -> topup create -> topup detail
- business switch -> dashboard -> consume -> history -> order detail
- ops -> business detail/status/membership -> payout -> settlement -> broadcast

## Notlar

- Bu repoda deterministik npm kurulumu için canonical lockfile artık `package-lock.json` dosyasıdır.
- `DELIVERY_NOTE_FRONTEND.md` dosyasında bu kapanışta yapılan kritik düzeltmeler özetlenmiştir.
- Bağımlılıklar kurulduktan sonra `npm run typecheck` ve `npm run build` birlikte çalıştırılmalıdır.
