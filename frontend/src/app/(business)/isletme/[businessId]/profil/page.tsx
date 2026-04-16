"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Eye, PenSquare, ShieldCheck, Store } from "lucide-react";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { getRoleLabel, isManagementRole } from "@/components/business/business-role";
import { Card, CardContent } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page-container";
import { QueryState } from "@/components/ui/query-state";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getBusinessProfileOperations, updateBusinessProfileOperations } from "@/features/business-operations/api";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";

const profileSchema = z.object({
  short_description: z.string().max(280, "Kısa tanıtım en fazla 280 karakter olabilir."),
  intro_text: z.string(),
  badge_text: z.string().max(64, "Rozet metni en fazla 64 karakter olabilir."),
  marketplace_is_visible: z.boolean(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

function getListingTypeLabel(listingType: string) {
  switch (listingType) {
    case "CONTRACTED":
      return "Anlaşmalı işletme";
    case "VOLUNTEER":
      return "Gönüllü işletme";
    default:
      return listingType;
  }
}

function getEditableFieldLabels(fields: string[]) {
  const labels: Record<string, string> = {
    short_description: "Kısa tanıtım",
    intro_text: "Detaylı tanıtım metni",
    badge_text: "Rozet metni",
    marketplace_is_visible: "Pazaryeri görünürlüğü",
    listing_type: "İşletme türü",
    is_featured: "Öne çıkarma durumu",
    display_priority: "Sıralama önceliği",
  };

  return fields.map((field) => labels[field] ?? field);
}

export default function BusinessProfilePage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["business-operations", businessId, "profile"],
    queryFn: () => getBusinessProfileOperations(businessId),
    enabled: Number.isFinite(businessId),
  });

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      short_description: "",
      intro_text: "",
      badge_text: "",
      marketplace_is_visible: false,
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      form.reset({
        short_description: profileQuery.data.short_description || "",
        intro_text: profileQuery.data.intro_text || "",
        badge_text: profileQuery.data.badge_text || "",
        marketplace_is_visible: profileQuery.data.marketplace_is_visible,
      });
    }
  }, [form, profileQuery.data]);

  const canEdit = isManagementRole(profileQuery.data?.member_role);

  const updateMutation = useMutation({
    mutationFn: (values: ProfileFormValues) => updateBusinessProfileOperations(businessId, values),
    onSuccess: async () => {
      toast.success("İşletme profili güncellendi.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "profile"] }),
        queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog", "business-detail", businessId] }),
        queryClient.invalidateQueries({ queryKey: ["catalog", "business-menu", businessId] }),
        queryClient.invalidateQueries({ queryKey: ["catalog", "businesses"] }),
        queryClient.invalidateQueries({ queryKey: ["discovery", "home"] }),
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Profil güncellenemedi.")),
  });

  return (
    <PageContainer>
      <BusinessPanelShell businessId={businessId}>
        <div className="space-y-6">
          <SectionHeader
            title="İşletme profili"
            description="İşletmenin pazaryerinde görünen temel tanıtım alanlarını bu ekrandan düzenleyebilir, görünürlük durumunu kontrol edebilirsin."
          />

          <QueryState
            isPending={profileQuery.isPending}
            isError={profileQuery.isError}
            error={profileQuery.error}
            data={profileQuery.data}
            errorTitle="Profil yüklenemedi"
            errorDescription={`${getApiErrorMessage(profileQuery.error)}${getApiRequestId(profileQuery.error) ? ` · request_id: ${getApiRequestId(profileQuery.error)}` : ""}`}
            emptyTitle="Profil verisi bulunamadı"
            emptyDescription="Bu işletme için gösterilebilir profil bilgisi dönmedi."
          >
            {(profile) => {
              const editableMemberFields = getEditableFieldLabels(profile.editable.member_fields);
              const editableAdminFields = getEditableFieldLabels(profile.editable.admin_fields);

              return (
                <>
                  <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] shadow-sm">
                    <CardContent className="space-y-6 p-6">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                            <Store className="h-3.5 w-3.5" />
                            İşletme profili
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">{profile.business_name}</h2>
                              <StatusChip label={getRoleLabel(profile.member_role)} tone={canEdit ? "success" : "default"} />
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                              Bu ekran, işletmenin kullanıcıya görünen kısa tanıtım metinlerini ve pazaryeri görünürlüğünü düzenlemek için kullanılır. Yapılan değişiklikler işletme detay ve keşif yüzeylerine yansır.
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-md lg:grid-cols-1 xl:grid-cols-3">
                          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Görünürlük</div>
                            <div className="mt-2 text-base font-semibold text-zinc-950">
                              {profile.marketplace_is_visible ? "Pazaryerinde açık" : "Pazaryerinde kapalı"}
                            </div>
                            <p className="mt-1 text-sm text-zinc-600">İşletmenin keşif ekranındaki görünümü.</p>
                          </div>
                          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">İşletme türü</div>
                            <div className="mt-2 text-base font-semibold text-zinc-950">{getListingTypeLabel(profile.listing_type)}</div>
                            <p className="mt-1 text-sm text-zinc-600">Platform tarafında tanımlı işletme yapısı.</p>
                          </div>
                          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Öne çıkarma</div>
                            <div className="mt-2 text-base font-semibold text-zinc-950">{profile.is_featured ? "Aktif" : "Kapalı"}</div>
                            <p className="mt-1 text-sm text-zinc-600">Platform tarafında vitrin desteği durumu.</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-6 lg:grid-cols-[1fr_0.82fr]">
                    <Card className="border-stone-200 shadow-sm">
                      <CardContent className="space-y-5 p-6">
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">Tanıtım alanlarını düzenle</h2>
                          <p className="mt-1 text-sm leading-6 text-zinc-600">
                            İşletmenin müşteriye görünen kısa açıklamasını, detaylı tanıtım metnini ve rozet yazısını bu formdan güncelleyebilirsin.
                          </p>
                        </div>

                        {!canEdit ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                            Bu hesapta <strong>kasiyer</strong> görünümü açık. Profil bilgilerini inceleyebilirsin ancak bu alanlarda değişiklik yapmak için yönetici veya sahip rolü gerekir.
                          </div>
                        ) : null}

                        <form onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))} className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-900">Kısa tanıtım</label>
                            <input
                              {...form.register("short_description")}
                              disabled={!canEdit || updateMutation.isPending}
                              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
                              placeholder="İşletmeni bir iki cümleyle anlat."
                            />
                            <p className="text-xs text-zinc-500">Keşif ve işletme detay ekranlarında ilk görünen kısa açıklamadır.</p>
                            <p className="text-xs text-red-600">{form.formState.errors.short_description?.message}</p>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-900">Detaylı tanıtım metni</label>
                            <textarea
                              {...form.register("intro_text")}
                              disabled={!canEdit || updateMutation.isPending}
                              rows={6}
                              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
                              placeholder="İşletmenin öne çıkan yönlerini daha detaylı anlat."
                            />
                            <p className="text-xs text-zinc-500">Kullanıcıya işletmenin sunduğu deneyimi ve farkını anlatan daha geniş açıklama alanıdır.</p>
                            <p className="text-xs text-red-600">{form.formState.errors.intro_text?.message}</p>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-900">Rozet metni</label>
                            <input
                              {...form.register("badge_text")}
                              disabled={!canEdit || updateMutation.isPending}
                              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
                              placeholder="Örnek: Hızlı servis"
                            />
                            <p className="text-xs text-zinc-500">Kart ve vitrin alanlarında kısa vurgu metni olarak kullanılabilir.</p>
                            <p className="text-xs text-red-600">{form.formState.errors.badge_text?.message}</p>
                          </div>

                          <label className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
                            <input
                              type="checkbox"
                              {...form.register("marketplace_is_visible")}
                              disabled={!canEdit || updateMutation.isPending}
                              className="mt-0.5 h-4 w-4"
                            />
                            <span>
                              <span className="font-medium text-zinc-950">Pazaryerinde görünür olsun</span>
                              <span className="mt-1 block text-zinc-600">
                                Bu alan açıksa işletme, uygun diğer koşullar da sağlandığında keşif ve liste ekranlarında görünmeye devam eder.
                              </span>
                            </span>
                          </label>

                          <div className="flex flex-wrap gap-3">
                            <button
                              type="submit"
                              disabled={!canEdit || updateMutation.isPending}
                              className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                            >
                              {updateMutation.isPending ? "Kaydediliyor..." : "Değişiklikleri kaydet"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                form.reset({
                                  short_description: profile.short_description || "",
                                  intro_text: profile.intro_text || "",
                                  badge_text: profile.badge_text || "",
                                  marketplace_is_visible: profile.marketplace_is_visible || false,
                                })
                              }
                              className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                            >
                              Değişiklikleri geri al
                            </button>
                          </div>
                        </form>
                      </CardContent>
                    </Card>

                    <div className="space-y-6">
                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6 text-sm text-zinc-600">
                          <div>
                            <h2 className="text-lg font-semibold text-zinc-950">Yetki ve düzenleme özeti</h2>
                            <p className="mt-1 leading-6">
                              Bu işletmedeki rolün hangi alanları değiştirebileceğini ve hangi bilgilerin platform yönetimi tarafında kaldığını burada toplu görebilirsin.
                            </p>
                          </div>

                          <div className={`rounded-2xl p-4 ${canEdit ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                            {canEdit
                              ? "Bu rolde profil alanlarını güncelleyebilirsin. Kaydedilen bilgiler işletmenin görünen metinlerini doğrudan etkiler."
                              : "Bu rolde profil alanlarını yalnızca görüntüleyebilirsin. Düzenleme için yönetici veya sahip rolü gerekir."}
                          </div>

                          <div className="rounded-2xl bg-zinc-50 p-4">
                            <p className="font-medium text-zinc-950">Bu rolde düzenlenebilen alanlar</p>
                            <p className="mt-1">{editableMemberFields.join(", ")}</p>
                          </div>

                          <div className="rounded-2xl bg-zinc-50 p-4">
                            <p className="font-medium text-zinc-950">Platform yönetiminde kalan alanlar</p>
                            <p className="mt-1">{editableAdminFields.join(", ")}</p>
                          </div>

                          <div className="rounded-2xl bg-zinc-50 p-4">
                            <p className="font-medium text-zinc-950">İşletme türü</p>
                            <p className="mt-1">{getListingTypeLabel(profile.listing_type)}</p>
                          </div>

                          <div className="rounded-2xl bg-zinc-50 p-4">
                            <p className="font-medium text-zinc-950">Sıralama önceliği</p>
                            <p className="mt-1">{profile.display_priority}</p>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6">
                          <div className="flex items-start gap-3">
                            <PenSquare className="mt-0.5 h-5 w-5 text-zinc-700" />
                            <div>
                              <h2 className="text-lg font-semibold text-zinc-950">İyi profil için kısa notlar</h2>
                              <p className="mt-1 text-sm leading-6 text-zinc-600">
                                Profil metinleri ne kadar net olursa, kullanıcı işletmenin ne sunduğunu o kadar hızlı anlar.
                              </p>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                              Kısa tanıtım alanında işletmenin temel vaadini tek cümlede anlatmak daha etkilidir.
                            </div>
                            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                              Detaylı tanıtım metninde servis tarzı, öne çıkan ürün grupları ve işletmenin farkı sade biçimde yazılabilir.
                            </div>
                            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                              Rozet metni kısa, vurucu ve anlaşılır olduğunda kart görünümünde daha güçlü bir etki bırakır.
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6">
                          <div className="flex items-start gap-3">
                            <Eye className="mt-0.5 h-5 w-5 text-zinc-700" />
                            <div>
                              <h2 className="text-lg font-semibold text-zinc-950">Bu ekran neyi etkiler?</h2>
                              <p className="mt-1 text-sm leading-6 text-zinc-600">
                                Burada güncellediğin bilgiler keşif akışında, işletme detay sayfasında ve pazaryeri görünümünde kullanıcıya yansıyan metin alanlarını etkiler.
                              </p>
                            </div>
                          </div>

                          <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                            İşletmenin menü ve teklif yönetimi ayrı ekranlarda kalır; bu sayfa yalnızca işletmenin kendini nasıl anlattığına ve görünürlük ayarına odaklanır.
                          </div>

                          <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                            Platform tarafından yönetilen vitrin, öne çıkarma ve sıralama gibi alanlar burada bilgi olarak görünür; düzenleme yetkisi bu sayfadan verilmez.
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </>
              );
            }}
          </QueryState>
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
