"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Store,
  UsersRound,
} from "lucide-react";

import { BusinessSwitcher } from "@/components/business/business-switcher";
import { getRoleLabel, getRoleSummary, getRoleSurfaceLabel, isManagementRole } from "@/components/business/business-role";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { resolveBusinessContext } from "@/features/business-operations/session";
import { useSession } from "@/hooks/use-session";

export default function BusinessHubPage() {
  const router = useRouter();
  const session = useSession();
  const context = resolveBusinessContext(session.data);

  useEffect(() => {
    if (!session.isPending && context.businesses.length === 1 && context.resolvedBusinessId) {
      router.replace(`/isletme/${context.resolvedBusinessId}`);
    }
  }, [context.businesses.length, context.resolvedBusinessId, router, session.isPending]);

  if (session.isPending && !session.data) {
    return (
      <PageContainer>
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  if (!context.businesses.length) {
    return (
      <PageContainer className="space-y-6">
        <SectionHeader
          title="İşletme alanı"
          description="İşletme paneli yalnızca bu hesapta aktif işletme yetkisi bulunan kullanıcılar için görünür."
        />

        <EmptyState
          title="Bu hesapta görünür bir işletme yetkisi bulunmuyor"
          description="İşletme panelini kullanabilmek için hesabına aktif bir işletme üyeliği tanımlanmış olması gerekir. Yetki eklendiğinde bu ekran üzerinden ilgili işletme paneline geçebilirsin."
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-stone-200 shadow-sm">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-zinc-700" />
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Bu alan ne için kullanılır?</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    İşletme tarafı; kasadaki operasyon, menü yönetimi, profil düzenleme ve günlük iş akışlarını müşteri alanından ayrı bir yüzeyde toplar.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200 shadow-sm">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-start gap-3">
                <UsersRound className="mt-0.5 h-5 w-5 text-zinc-700" />
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Yetki nasıl görünür?</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    İşletme üyelikleri sistemde ayrı tanımlanır. Hesabına owner, manager veya kasiyer rolü eklendiğinde bu ekran otomatik olarak işletme giriş alanına dönüşür.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    );
  }

  const selectedBusiness =
    context.businesses.find((item) => item.id === context.resolvedBusinessId) ??
    context.businesses[0] ??
    null;
  const selectedRole = selectedBusiness?.member_role ?? null;
  const managementAccess = isManagementRole(selectedRole);

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="İşletme alanı"
        description="İşletmene bağlı operasyon ve yönetim yüzeylerini bu ekrandan açabilir, doğru rol görünümüyle çalışmaya başlayabilirsin."
      />

      <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                <Store className="h-3.5 w-3.5" />
                İşletme modu
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">İşletmeni seç, doğru çalışma yüzeyiyle devam et</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                  Bu ekran, hesabına bağlı işletmeler arasından doğru işletmeyi seçmeni sağlar. Kasiyer rolüyle daha sade operasyon ekranları, yönetici ve sahip rollerinde ise daha geniş yönetim alanları açılır.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:max-w-md lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam işletme</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">{context.businesses.length}</div>
                <p className="mt-1 text-sm text-zinc-600">Bu hesapta görüntülenebilen işletme sayısı.</p>
              </div>
              <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Aktif işletme</div>
                <div className="mt-2 text-base font-semibold text-zinc-950">{selectedBusiness?.name || "Seçim bekleniyor"}</div>
                <p className="mt-1 text-sm text-zinc-600">Panele geçişte kullanılacak çalışma alanı.</p>
              </div>
              <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Rol görünümü</div>
                <div className="mt-2 text-base font-semibold text-zinc-950">{getRoleSurfaceLabel(selectedRole)}</div>
                <p className="mt-1 text-sm text-zinc-600">{managementAccess ? "Yönetim alanları açık." : "Kasiyer odaklı operasyon yüzeyi açık."}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {context.businesses.length === 1 ? (
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Tek işletme erişimi bulundu</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Bu hesapta yalnızca bir işletme aktif olduğu için panel açılışı otomatik yapılır. İstersen aşağıdaki butonla ilgili alana hemen geçebilirsin.
              </p>
            </div>
            {context.resolvedBusinessId ? (
              <Link
                href={`/isletme/${context.resolvedBusinessId}`}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Panele git
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Aktif işletmeyi belirle</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Birden fazla işletme erişimin varsa, aşağıdaki seçim alanından çalışmak istediğin işletmeyi belirleyebilir ve rolüne uygun panele geçebilirsin.
              </p>
            </div>

            <BusinessSwitcher businesses={context.businesses} activeBusinessId={context.resolvedBusinessId} />

            {selectedRole ? (
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                <span className="font-medium text-zinc-950">{getRoleLabel(selectedRole)} görünümü:</span> {getRoleSummary(selectedRole)}
              </div>
            ) : null}

            {context.resolvedBusinessId ? (
              <Link
                href={`/isletme/${context.resolvedBusinessId}`}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Aktif paneli aç
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {context.businesses.map((business) => {
            const isActive = business.id === context.resolvedBusinessId;
            const canManage = isManagementRole(business.member_role);

            return (
              <Card key={business.id} className="border-stone-200 shadow-sm">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-base font-semibold text-zinc-950">{business.name}</p>
                      <p className="mt-1 text-sm text-zinc-600">Bu işletmedeki rolün: {getRoleLabel(business.member_role)}</p>
                    </div>
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Aktif seçim
                      </span>
                    ) : null}
                  </div>

                  <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                    {getRoleSummary(business.member_role)}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/isletme/${business.id}`}
                      className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                    >
                      {canManage ? "Yönetim paneline geç" : "Operasyon paneline geç"}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Ekip kullanımı nasıl işler?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Aynı işletmede birden fazla kişi kendi hesabıyla çalışabilir. Sahip ve yöneticiler içerik ile yönetim alanlarını kullanırken kasiyerler daha sade operasyon ekranlarıyla ilerler.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Bu yapı, ortak hesap kullanımına ihtiyaç duymadan kimin hangi paneli kullandığını ve hangi işlemi yaptığını daha net takip etmeyi sağlar.
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <UsersRound className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Rol ayrımı neden önemli?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  İşletme alanı müşteri deneyiminden ayrı tasarlanır. Böylece kasada duran ekip yalnızca gereken ekranları görür, yönetim tarafı ise menü ve içerik akışını daha kontrollü biçimde kullanır.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Sistem erişimi her zaman üyelik ve rol kaydı üzerinden doğrular; bu ekrandaki seçim ise doğru işletmeye daha hızlı ve güvenli geçiş yapmanı sağlar.
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
