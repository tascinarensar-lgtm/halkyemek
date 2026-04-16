"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { buildUpdatedSearchParams, resolveDistrict } from "@/features/discovery/params";
import { cn } from "@/lib/utils/cn";

const districts = [{ code: "BEYLIKDUZU", label: "İstanbul/Beylikdüzü" }];

export function DistrictPicker({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeDistrict = resolveDistrict(searchParams.get("district"));

  function updateDistrict(code: string) {
    const next = buildUpdatedSearchParams(searchParams, { district: code });
    const serialized = next.toString();
    router.push(serialized ? `${pathname}?${serialized}` : pathname);
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-sm font-medium text-zinc-600">Aktif Bölge:</span>
      {districts.map((district) => (
        <button
          key={district.code}
          type="button"
          onClick={() => updateDistrict(district.code)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition",
            district.code === activeDistrict
              ? "border-zinc-950 bg-zinc-950 text-white"
              : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
          )}
        >
          {district.label}
        </button>
      ))}
    </div>
  );
}
