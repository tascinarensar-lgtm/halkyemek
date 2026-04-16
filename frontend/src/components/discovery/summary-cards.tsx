import Link from "next/link";
import { BellRing, CreditCard, ShoppingCart } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import type { ActiveCartSummary, NotificationReadinessSummary, WalletSummary } from "@/features/discovery/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

export function DiscoverySummaryCards({
  wallet,
  cart,
  notification,
}: {
  wallet: WalletSummary | null;
  cart: ActiveCartSummary | null;
  notification: NotificationReadinessSummary;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="border-stone-200 bg-white">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <CreditCard className="h-4 w-4" /> Cüzdan özeti
          </div>
          <div className="text-2xl font-semibold text-zinc-950">
            <AmountText amount={wallet?.balance ?? 0} />
          </div>
          <p className="text-sm text-zinc-500">
            Bekleyen bakiye: <AmountText amount={wallet?.pending_balance ?? 0} />
          </p>
          <Link href="/cuzdan" className="inline-flex text-sm font-medium text-zinc-900 hover:text-zinc-700">
            Cüzdanı aç
          </Link>
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <ShoppingCart className="h-4 w-4" /> Aktif sepet
          </div>
          {cart ? (
            <>
              <div className="text-lg font-semibold text-zinc-950">{repairPotentialMojibake(cart.business_name)}</div>
              <p className="text-sm text-zinc-500">
                {cart.item_count} ürün · <AmountText amount={cart.total_amount} />
              </p>
              <Link href="/sepet" className="text-sm font-medium text-zinc-900 hover:text-zinc-700">
                Sepete git
              </Link>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Şu anda aktif bir sepetiniz görünmüyor.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <BellRing className="h-4 w-4" /> Bildirim hazırlığı
          </div>
          <div className="text-lg font-semibold text-zinc-950">{notification.notification_ready ? "Hazır" : "Eksik"}</div>
          <p className="text-sm text-zinc-500">Aktif cihaz sayısı: {notification.active_device_count}</p>
          <Link href="/bildirimler" className="text-sm font-medium text-zinc-900 hover:text-zinc-700">
            Bildirimleri yönet
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
