"use client";

import { ImagePlus, Images, Sparkles, Star, Trash2, UploadCloud } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  appendGalleryFiles,
  type EntityImageState,
  promoteGalleryDraftToCover,
  removeCoverDraft,
  removeGalleryDraft,
  setCoverFromFile,
} from "@/features/business-operations/media-sync";

function readFiles(input: FileList | null) {
  if (!input) return [];
  return Array.from(input).filter((file) => file.type.startsWith("image/"));
}

export function EntityImageManager({
  value,
  onChange,
  disabled = false,
  title = "Görsel düzeni",
  description = "Kapak görselini ve galeri fotoğraflarını dosya seçerek yönet. Link yazmana gerek yok.",
}: {
  value: EntityImageState;
  onChange: (next: EntityImageState) => void;
  disabled?: boolean;
  title?: string;
  description?: string;
}) {
  return (
    <Card className="overflow-hidden border-stone-200 bg-[linear-gradient(180deg,_rgba(250,250,249,0.98),_rgba(255,255,255,1))]">
      <CardContent className="space-y-6 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-zinc-950 p-2.5 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
              <ImagePlus className="h-4 w-4" />
              {title}
            </div>
            <p className="text-sm leading-6 text-zinc-600">{description}</p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-950">Kapak görseli</p>
                <p className="text-xs leading-5 text-zinc-500">
                  Kartta, vitrin alanında ve ilk bakışta görünen ana fotoğraf.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300">
                <UploadCloud className="h-4 w-4" />
                Kapak seç
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={disabled}
                  onChange={(event) => {
                    const [file] = readFiles(event.target.files);
                    event.currentTarget.value = "";
                    if (!file) return;
                    onChange(setCoverFromFile(value, file));
                  }}
                />
              </label>
            </div>

            {value.cover ? (
              <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                <div className="aspect-[16/10] bg-zinc-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={value.cover.previewUrl}
                    alt="Kapak görseli"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    <Star className="h-4 w-4 text-amber-500" />
                    Kapak olarak kullanılacak
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(removeCoverDraft(value))}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                    Kaldır
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-zinc-300 bg-white px-6 py-12 text-center shadow-sm">
                <div className="rounded-2xl bg-zinc-100 p-3 text-zinc-700">
                  <ImagePlus className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900">Kapak görseli ekle</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    JPG, PNG, WEBP veya GIF dosyası seçebilirsin.
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={disabled}
                  onChange={(event) => {
                    const [file] = readFiles(event.target.files);
                    event.currentTarget.value = "";
                    if (!file) return;
                    onChange(setCoverFromFile(value, file));
                  }}
                />
              </label>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-950">Galeri fotoğrafları</p>
                <p className="text-xs leading-5 text-zinc-500">
                  Detay ekranında gösterilecek ek fotoğraflar. İstersen birden fazla dosyayı aynı anda seçebilirsin.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 ring-1 ring-zinc-200">
                <Images className="h-4 w-4" />
                Galeriye ekle
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={disabled}
                  onChange={(event) => {
                    const files = readFiles(event.target.files);
                    event.currentTarget.value = "";
                    if (!files.length) return;
                    onChange(appendGalleryFiles(value, files));
                  }}
                />
              </label>
            </div>

            {value.gallery.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {value.gallery.map((draft, index) => (
                  <div key={draft.key} className="overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-sm">
                    <div className="aspect-square bg-zinc-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={draft.previewUrl}
                        alt={`Galeri görseli ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="space-y-3 px-4 py-3">
                      <div className="text-sm font-medium text-zinc-900">Galeri görseli {index + 1}</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onChange(promoteGalleryDraftToCover(value, draft.key))}
                          disabled={disabled}
                          className="inline-flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900"
                        >
                          <Star className="h-3.5 w-3.5" />
                          Kapağa taşı
                        </button>
                        <button
                          type="button"
                          onClick={() => onChange(removeGalleryDraft(value, draft.key))}
                          disabled={disabled}
                          className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Sil
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white px-5 py-10 text-center shadow-sm">
                <p className="text-sm font-medium text-zinc-900">Galeride henüz fotoğraf yok</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Ürünü ya da teklifi daha güçlü göstermek için birkaç farklı açı ekleyebilirsin.
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
