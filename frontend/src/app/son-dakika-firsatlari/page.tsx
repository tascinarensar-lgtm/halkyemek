import { redirect } from "next/navigation";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SonDakikaFirsatlariRedirectPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const rawDistrict = params.district;
  const district = Array.isArray(rawDistrict) ? rawDistrict[0] : rawDistrict;
  const query = district ? `?district=${encodeURIComponent(district)}` : "";

  redirect(`/halktasarruf${query}`);
}
