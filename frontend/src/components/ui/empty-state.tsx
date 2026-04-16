export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-zinc-600">{description}</p>
    </div>
  );
}
