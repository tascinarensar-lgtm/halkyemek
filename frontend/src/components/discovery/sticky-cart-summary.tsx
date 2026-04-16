import Link from "next/link";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import type { CartDetail } from "@/features/cart/types";

export function StickyCartSummary({ cart, businessId, isAuthenticated }: { cart: CartDetail | undefined; businessId: number; isAuthenticated: boolean }) {
  const isSameBusiness = cart?.business === businessId;

  return (
    <div className="lg:sticky lg:top-24">
      <Card className="border-stone-200 bg-white">
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-950">Sepet özeti</h2>
            <p className="text-sm leading-6 text-zinc-500">
              Seçtiğiniz ürünler bu işletmeyle eşleştiğinde sepet özeti ve ödeme adımına geçiş burada görünür.
            </p>
          </div>

          {!isAuthenticated ? (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-zinc-600">Sepete ekleme ve ödeme işlemleri için güvenli giriş yapınız.</p>
              <Link href="/giris" className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
                Güvenli giriş yap
              </Link>
            </div>
          ) : !cart || cart.item_count === 0 ? (
            <p className="text-sm leading-6 text-zinc-600">Bu işletme için henüz ürün seçmediniz. Ürün eklediğinizde sepet özeti burada görünür.</p>
          ) : isSameBusiness ? (
            <>
              <div className="space-y-2 text-sm text-zinc-600">
                <p>Ürün sayısı: {cart.item_count}</p>
                <p>
                  Ara toplam: <AmountText amount={cart.subtotal_amount} />
                </p>
                <p>
                  Kullanıcı ücreti: <AmountText amount={cart.customer_fee_amount} />
                </p>
                <p>
                  Toplam: <AmountText amount={cart.total_amount} />
                </p>
              </div>
              <div className="grid gap-2">
                <Link href="/sepet" className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
                  Sepeti aç
                </Link>
                <Link href="/checkout" className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900">
                  Ödeme adımına geç
                </Link>
              </div>
            </>
          ) : (
            <div className="space-y-3 text-sm leading-6 text-zinc-600">
              <p>Başka bir işletmeye ait aktif sepetiniz var. Önce mevcut sepetinizi görüntüleyin.</p>
              <Link href="/sepet" className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
                Aktif sepeti aç
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
