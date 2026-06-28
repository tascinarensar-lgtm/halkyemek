import Image from "next/image";

const footerLinks = [
  "Yardım Merkezi",
  "Kullanım Koşulları",
  "S.S.S. ve İşlem Rehberi",
  "Çerez Politikası",
  "İletişim",
  "İş Ortağımız Olun",
  "Kurumsal Site",
  "Aydınlatma Metni",
  "Kişisel Verilerin Korunması ve İşlenmesi ve Gizlilik Politikası",
  "Bilgi Toplumu Hizmetleri",
];

export function CustomerBottomSection() {
  return (
    <section className="overflow-hidden rounded-[30px] border border-zinc-100 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
      <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="bg-zinc-950 p-6 text-white sm:p-8 lg:p-10">
          <Image src="/logo-halkyemek.png" alt="HalkYemek" width={1100} height={254} className="h-12 w-auto rounded-xl bg-white px-3 py-2 object-contain" />
          <h2 className="mt-8 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
            Daha Uygun Fiyat, Daha Akıllı Sistem
          </h2>
          <p className="mt-4 text-sm leading-7 text-zinc-300">
            Gereksiz maliyetleri azaltıyoruz, yemeği herkes için daha ulaşılabilir hale getiriyoruz.
          </p>
        </div>
        <div className="space-y-6 p-6 sm:p-8 lg:p-10">
          <div className="space-y-4 text-sm leading-7 text-zinc-600">
            <p>
              HalkYemek, işletmelerle özel anlaşmalar yaparak kullanıcılara daha avantajlı fiyatlar sunmayı hedefler.
              Belirli ürünlerde özel kampanyalar, sınırlı stok fırsatları ve daha ulaşılabilir yemek seçenekleri sunar.
            </p>
            <p>
              Siparişini oluşturduktan sonra sana özel QR kodun hazırlanır. İşletmeye gittiğinde QR kodunu kasada okutarak
              siparişini hızlıca teslim alabilirsin.
            </p>
            <p>
              Dijital cüzdan altyapısıyla bakiyeni yükler, siparişini oluşturur, QR kodunu gösterir ve yemeğini teslim alırsın.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-5">
            {footerLinks.map((link) => (
              <button
                key={link}
                type="button"
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:-translate-y-0.5 hover:border-[#ff1f63]/30 hover:bg-rose-50 hover:text-[#ff1f63]"
              >
                {link}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
