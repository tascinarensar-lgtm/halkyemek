"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

export function ManagementToolbar({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{description}</p>
        </div>
        {action ? <div>{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Sheet({ open, title, description, children, onClose }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
      <button type="button" aria-label="Kapat" className="flex-1" onClick={onClose} />
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between border-b border-zinc-200 bg-white px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700">Kapat</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-zinc-900">{label}</label>
      {children}
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950", props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950", props.className)} />;
}

export function ToggleRow({ label, description, checked, onChange, disabled }: { label: string; description: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="mt-0.5 h-4 w-4" />
      <span>
        <span className="block font-medium text-zinc-900">{label}</span>
        <span className="mt-1 block text-zinc-600">{description}</span>
      </span>
    </label>
  );
}

export function CrudCard({ title, subtitle, badge, children, actions }: { title: string; subtitle?: string; badge?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{title}</h3>
              {badge}
            </div>
            {subtitle ? <p className="mt-1 text-sm text-zinc-600">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={cn("rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300", props.className)} />;
}

export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={cn("rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100", props.className)} />;
}

export function DangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={cn("rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:bg-red-50/60", props.className)} />;
}
