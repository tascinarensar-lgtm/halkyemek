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
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Aktif bölge</span>
      {districts.map((district) => (
        <button
          key={district.code}
          type="button"
          onClick={() => updateDistrict(district.code)}
          className={cn(
            "rounded-full border px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20",
            district.code === activeDistrict
              ? "border-zinc-950 bg-zinc-950 text-white shadow-sm"
              : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50",
          )}
        >
          {district.label}
        </button>
      ))}
    </div>
  );
}
