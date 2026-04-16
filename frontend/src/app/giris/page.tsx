import { BadgePercent, QrCode, ShieldCheck, Store } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { LoginForm } from "@/components/auth/login-form";

const heroHighlights = [
  {
    title: "Özel menülere eriş",
    description: "Anlaşmalı işletmelerde HalkYemek'e özel hazırlanan avantajlı menüleri görüntüle.",
    icon: BadgePercent,
  },
  {
    title: "Daha uygun fiyatları gör",
    description: "Aynı yemeği daha uygun koşullarda sipariş etme imkanını doğrudan karşılaştır.",
    icon: Store,
  },
  {
    title: "QR ile hızlı teslim al",
    description: "Ödemeni tamamla, kasada QR kodunu göster ve beklemeden teslim al.",
    icon: QrCode,
  },
  {
    title: "Güvenli giriş yap",
    description: "Google hesabınla hızlı ve güvenli şekilde giriş yaparak sipariş sürecine devam et.",
    icon: ShieldCheck,
  },
];

const supportBlocks = [
  {
    title: "Neden giriş yapmalıyım?",
    description: "Giriş yaptıktan sonra sana özel fiyatları görür, siparişini tamamlar ve teslim adımlarını kolayca takip edersin.",
  },
  {
    title: "Sipariş süreci nasıl ilerler?",
    description: "Menünü seç, ödemeni yap, QR kodunu al ve kasada göstererek yemeğini hızlıca teslim al.",
  },
  {
    title: "HalkYemek ne sağlar?",
    description: "Amaç, vatandaşın gereksiz maliyetler olmadan daha uygun fiyatla doyabildiği pratik bir sistem sunmaktır.",
  },
];

export default function LoginPage() {
  return (
    <PageContainer className="space-y-10">
      <SectionHeader
        title="Giriş yap"
        description="Google hesabınla giriş yaparak özel menülere, avantajlı fiyatlara ve QR ile hızlı teslim akışına devam edebilirsin."
      />

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.14),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.94))]">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="space-y-2">
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                HalkYemek giriş alanı
              </span>
              <h2 className="max-w-2xl text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">
                Giriş yaptıktan sonra avantajlı menülere daha hızlı ulaşırsın.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-zinc-600">
                Bu ekrandan giriş yaptıktan sonra anlaşmalı işletmelerdeki özel menüleri görebilir, siparişini tamamlayabilir
                ve QR ile teslim sürecine doğrudan geçebilirsin.
              </p>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {heroHighlights.map((item) => {
                const Icon = item.icon;

                return (
                  <div key={item.title} className="rounded-2xl border border-white/80 bg-white/85 p-3 backdrop-blur">
                    <div className="inline-flex rounded-full bg-zinc-100 p-2 text-zinc-900">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <h3 className="mt-2.5 text-sm font-semibold text-zinc-950">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">{item.description}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <LoginForm />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {supportBlocks.map((block) => (
          <Card key={block.title}>
            <CardContent className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-950">{block.title}</h2>
              <p className="text-sm leading-6 text-zinc-600">{block.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
