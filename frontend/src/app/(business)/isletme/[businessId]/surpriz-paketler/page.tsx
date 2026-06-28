import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ businessId: string }>;
};

export default async function LegacyBusinessSurpriseDealsRedirectPage({ params }: PageProps) {
  const { businessId } = await params;

  redirect(`/halktasarruf/isletme/${encodeURIComponent(businessId)}/surpriz-paketler`);
}
