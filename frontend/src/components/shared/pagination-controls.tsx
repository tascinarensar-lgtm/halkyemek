import { ButtonLink } from "@/components/ui/button-link";

export function PaginationControls({
  page,
  hasPrevious,
  hasNext,
  buildHref,
}: {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  buildHref: (page: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-zinc-500">Sayfa {page}</div>
      <div className="flex items-center gap-2">
        {hasPrevious ? (
          <ButtonLink href={buildHref(page - 1)} variant="secondary">
            Önceki
          </ButtonLink>
        ) : (
          <span className="rounded-xl bg-zinc-100 px-4 py-2 text-sm text-zinc-400">Önceki</span>
        )}
        {hasNext ? (
          <ButtonLink href={buildHref(page + 1)} variant="secondary">
            Sonraki
          </ButtonLink>
        ) : (
          <span className="rounded-xl bg-zinc-100 px-4 py-2 text-sm text-zinc-400">Sonraki</span>
        )}
      </div>
    </div>
  );
}
