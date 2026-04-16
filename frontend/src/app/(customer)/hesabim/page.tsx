"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CreditCard,
  LogOut,
  ReceiptText,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { NotificationReadinessSummaryCard } from "@/components/notifications/readiness-summary-card";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { useSession } from "@/hooks/use-session";
import { getNotificationReadiness } from "@/features/notifications/api";
import { notifyAuthStateCleared } from "@/lib/auth/events";
import { getAnonymousSessionState } from "@/lib/auth/session-state";
import { describeApiError } from "@/lib/api/presentation";

function getUserRoleLabel(role: string | null | undefined) {
  switch (String(role || "").toUpperCase()) {
    case "ADMIN":
      return "Yönetici hesabı";
    case "CUSTOMER":
    default:
      return "Müşteri hesabı";
  }
}

function getMembershipRoleLabel(role: string | null | undefined) {
  switch (String(role || "").toUpperCase()) {
    case "OWNER":
      return "Kurucu yetkisi";
    case "MANAGER":
      return "Yönetici yetkisi";
    case "CASHIER":
      return "Kasiyer yetkisi";
    case "STAFF":
      return "Ekip yetkisi";
    default:
      return "İşletme erişimi";
  }
}

export default function AccountPage() {
  const session = useSession();
  const readinessQuery = useQuery({
    queryKey: ["notifications", "readiness"],
    queryFn: getNotificationReadiness,
    retry: 0,
  });
  const router = useRouter();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("Çıkış işlemi tamamlanamadı.");
      }
      return true;
    },
    onSuccess: async () => {
      notifyAuthStateCleared("logout");
      queryClient.setQueryData(["session"], getAnonymousSessionState());
      toast.success("Oturum güvenli şekilde kapatıldı.");
      router.push("/");
      router.refresh();
    },
    onError: (error) => {
      toast.error(describeApiError(error, "Çıkış işlemi tamamlanamadı."));
    },
  });

  const user = session.data?.user;
  const businesses = session.data?.businesses ?? [];

  const quickLinks = useMemo(() => {
    const items = [
      {
        href: "/cuzdan",
        title: "Cüzdan",
        description: "Bakiye, yükleme ve hareketlerini tek ekranda takip et.",
        icon: CreditCard,
      },
      {
        href: "/siparislerim",
        title: "Siparişlerim",
        description: "Geçmiş siparişlerini, ödeme adımlarını ve teslim durumunu görüntüle.",
        icon: ReceiptText,
      },
      {
        href: "/bildirimler",
        title: "Bildirimler",
        description: "Duyuru, sipariş ve bakiye bildirimlerini düzenli biçimde incele.",
        icon: Bell,
      },
    ];

    if (session.data?.hasBusinessMembership) {
      items.push({
        href: "/isletme",
        title: "İşletme Alanı",
        description: "Yetkin olan işletmeler için panel, operasyon ve yönetim ekranlarına geç.",
        icon: Store,
      });
    }

    return items;
  }, [session.data?.hasBusinessMembership]);

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Hesabım"
        description="Hesap bilgilerini, işletme yetkilerini, bildirim durumunu ve hızlı erişim alanlarını tek ekranda sade bir düzenle yönet."
      />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.10),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] shadow-sm">
          <CardContent className="space-y-6 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                  <UserRound className="h-3.5 w-3.5" />
                  Hesap özeti
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
                    {user?.username ? `${user.username} hesabını güvenle yönet` : "Hesabını güvenle yönet"}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                    Bu alanda bağlı hesap bilgilerini, sahip olduğun erişimleri ve HalkYemek içindeki temel işlemlere giden kısa yolları görebilirsin.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" />
                {logoutMutation.isPending ? "Çıkış yapılıyor..." : "Çıkış yap"}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Kullanıcı adı</div>
                <div className="mt-2 text-lg font-semibold text-zinc-950">{user?.username || "-"}</div>
                <p className="mt-1 text-sm text-zinc-600">Hesabında görünen temel kullanıcı adı.</p>
              </div>
              <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bağlı e-posta</div>
                <div className="mt-2 text-lg font-semibold text-zinc-950 break-all">{user?.google_email || "-"}</div>
                <p className="mt-1 text-sm text-zinc-600">Google ile girişte kullanılan doğrulanmış hesap.</p>
              </div>
              <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Hesap tipi</div>
                <div className="mt-2 text-lg font-semibold text-zinc-950">{getUserRoleLabel(user?.role)}</div>
                <p className="mt-1 text-sm text-zinc-600">Bu hesap için açık olan temel erişim seviyesi.</p>
              </div>
              <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">İşletme erişimi</div>
                <div className="mt-2 text-lg font-semibold text-zinc-950">{businesses.length}</div>
                <p className="mt-1 text-sm text-zinc-600">
                  {businesses.length > 0
                    ? "Yetkin olan işletme alanları burada özetlenir."
                    : "Şu an bu hesapta aktif işletme yetkisi görünmüyor."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {readinessQuery.isError ? (
          <ErrorState
            title="Bildirim özeti yüklenemedi"
            description={describeApiError(readinessQuery.error, "Bildirim durumu şu anda alınamıyor.")}
          />
        ) : (
          <NotificationReadinessSummaryCard readiness={readinessQuery.data} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Hızlı erişim</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Hesabında en sık kullanacağın ana alanlara buradan tek adımda geçebilirsin.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {quickLinks.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-zinc-950">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">{item.description}</p>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">İşletme yetkileri</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Eğer bu hesap bir işletme ile ilişkiliyse, sahip olduğun yetkiler burada sakin ve anlaşılır biçimde listelenir.
              </p>
            </div>

            {businesses.length > 0 ? (
              <div className="space-y-3">
                {businesses.map((business) => (
                  <div key={business.id} className="rounded-2xl bg-zinc-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-base font-semibold text-zinc-950">{business.name}</div>
                        <p className="mt-1 text-sm text-zinc-600">
                          Bu işletme için hesabında tanımlı erişim aktif görünüyor.
                        </p>
                      </div>
                      <div className="inline-flex rounded-full bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 ring-1 ring-zinc-200">
                        {getMembershipRoleLabel(business.member_role)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm leading-6 text-zinc-600">
                Bu hesapta şu an görünür bir işletme yetkisi bulunmuyor. İleride bir işletme hesabına dahil edildiğinde ilgili alanlar burada görünür hale gelir.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Bu sayfada neleri takip edebilirsin?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Hesap bilgileri, bildirim hazırlığı, işletme yetkileri ve temel işlem alanlarına geçişler burada birlikte sunulur.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Böylece hangi hesapla giriş yaptığını, hangi alanlara erişebildiğini ve günlük kullanımda en sık ihtiyaç duyacağın bağlantıları tek bakışta görebilirsin.
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <UserRound className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Güvenli kullanım notu</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Özellikle ortak cihazlarda işin bittiğinde çıkış yapman, hesap güvenliği ve bildirim düzeni açısından daha sağlıklı olur.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Buradaki çıkış işlemi oturumunu güvenli şekilde kapatır. Hesabını başka biriyle paylaşmıyorsan tekrar giriş yaptığında aynı akışa kaldığın yerden devam edebilirsin.
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
