export function ErrorState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
      <h2 className="font-semibold text-red-700">{title}</h2>
      <p className="mt-2 text-sm text-red-600">{description}</p>
    </div>
  );
}
