"use client";

import {
  deleteBusinessMediaAsset,
  updateBusinessMediaAsset,
  uploadBusinessMediaAsset,
} from "@/features/business-operations/api";
import type {
  BusinessEntityMediaAsset,
  BusinessMediaRole,
} from "@/features/business-operations/types";

export type ExistingEntityImageDraft = {
  kind: "existing";
  key: string;
  asset: BusinessEntityMediaAsset;
  previewUrl: string;
};

export type NewEntityImageDraft = {
  kind: "new";
  key: string;
  file: File;
  previewUrl: string;
};

export type EntityImageDraft = ExistingEntityImageDraft | NewEntityImageDraft;

export interface EntityImageState {
  cover: EntityImageDraft | null;
  gallery: EntityImageDraft[];
}

function createDraftKey(prefix: string) {
  const randomPart =
    typeof globalThis !== "undefined" && "crypto" in globalThis && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function createNewDraft(file: File): NewEntityImageDraft {
  return {
    kind: "new",
    key: createDraftKey("new"),
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function createExistingDraft(asset: BusinessEntityMediaAsset): ExistingEntityImageDraft {
  return {
    kind: "existing",
    key: `existing-${asset.id}`,
    asset,
    previewUrl: asset.url,
  };
}

export function createEmptyEntityImageState(): EntityImageState {
  return {
    cover: null,
    gallery: [],
  };
}

export function createEntityImageState(images: BusinessEntityMediaAsset[]): EntityImageState {
  const coverAsset = images.find((image) => image.asset_role === "COVER" || image.asset_role === "THUMBNAIL") ?? null;
  const galleryAssets = images.filter((image) => image.id !== coverAsset?.id);

  return {
    cover: coverAsset ? createExistingDraft(coverAsset) : null,
    gallery: galleryAssets.map(createExistingDraft),
  };
}

export function disposeEntityImageDraft(draft: EntityImageDraft | null | undefined) {
  if (!draft) return;
  if (draft.kind === "new") {
    URL.revokeObjectURL(draft.previewUrl);
  }
}

export function disposeEntityImageState(state: EntityImageState) {
  disposeEntityImageDraft(state.cover);
  for (const draft of state.gallery) {
    disposeEntityImageDraft(draft);
  }
}

export function setCoverFromFile(state: EntityImageState, file: File): EntityImageState {
  disposeEntityImageDraft(state.cover);
  return {
    ...state,
    cover: createNewDraft(file),
  };
}

export function appendGalleryFiles(state: EntityImageState, files: File[]): EntityImageState {
  return {
    ...state,
    gallery: [...state.gallery, ...files.map(createNewDraft)],
  };
}

export function removeCoverDraft(state: EntityImageState): EntityImageState {
  disposeEntityImageDraft(state.cover);
  return {
    ...state,
    cover: null,
  };
}

export function removeGalleryDraft(state: EntityImageState, key: string): EntityImageState {
  const target = state.gallery.find((draft) => draft.key === key);
  disposeEntityImageDraft(target);
  return {
    ...state,
    gallery: state.gallery.filter((draft) => draft.key !== key),
  };
}

export function promoteGalleryDraftToCover(state: EntityImageState, key: string): EntityImageState {
  const target = state.gallery.find((draft) => draft.key === key);
  if (!target) return state;

  const remainingGallery = state.gallery.filter((draft) => draft.key !== key);
  return {
    cover: target,
    gallery: state.cover ? [state.cover, ...remainingGallery] : remainingGallery,
  };
}

function createUploadPayload(options: {
  target: { menu_item?: number | null; offer?: number | null };
  role: BusinessMediaRole;
  sortOrder: number;
  file: File;
  altText: string;
}) {
  const formData = new FormData();
  formData.set("file", options.file);
  formData.set("media_type", "IMAGE");
  formData.set("asset_role", options.role);
  formData.set("sort_order", String(options.sortOrder));
  formData.set("is_active", "true");
  if (options.altText.trim()) {
    formData.set("alt_text", options.altText.trim());
  }
  if (options.target.menu_item) {
    formData.set("menu_item", String(options.target.menu_item));
  }
  if (options.target.offer) {
    formData.set("offer", String(options.target.offer));
  }
  return formData;
}

async function syncExistingDraft(options: {
  businessId: number;
  draft: ExistingEntityImageDraft;
  target: { menu_item?: number | null; offer?: number | null };
  role: BusinessMediaRole;
  sortOrder: number;
  altText: string;
}) {
  const { asset } = options.draft;
  const nextAltText = options.altText.trim();
  const shouldUpdate =
    asset.asset_role !== options.role ||
    asset.sort_order !== options.sortOrder ||
    (asset.alt_text || "") !== nextAltText;

  if (!shouldUpdate) return;

  await updateBusinessMediaAsset(options.businessId, asset.id, {
    ...options.target,
    media_type: "IMAGE",
    asset_role: options.role,
    alt_text: nextAltText,
    sort_order: options.sortOrder,
    is_active: true,
  });
}

async function syncNewDraft(options: {
  businessId: number;
  draft: NewEntityImageDraft;
  target: { menu_item?: number | null; offer?: number | null };
  role: BusinessMediaRole;
  sortOrder: number;
  altText: string;
}) {
  const payload = createUploadPayload({
    target: options.target,
    role: options.role,
    sortOrder: options.sortOrder,
    file: options.draft.file,
    altText: options.altText,
  });
  await uploadBusinessMediaAsset(options.businessId, payload);
}

export async function syncEntityImages(options: {
  businessId: number;
  target: { menu_item?: number | null; offer?: number | null };
  currentImages: BusinessEntityMediaAsset[];
  nextState: EntityImageState;
  defaultAltText?: string;
}) {
  const defaultAltText = (options.defaultAltText || "").trim();
  const keepIds = new Set<number>();

  if (options.nextState.cover?.kind === "existing") {
    keepIds.add(options.nextState.cover.asset.id);
  }
  for (const draft of options.nextState.gallery) {
    if (draft.kind === "existing") {
      keepIds.add(draft.asset.id);
    }
  }

  for (const image of options.currentImages) {
    if (!keepIds.has(image.id)) {
      await deleteBusinessMediaAsset(options.businessId, image.id);
    }
  }

  if (options.nextState.cover) {
    if (options.nextState.cover.kind === "existing") {
      await syncExistingDraft({
        businessId: options.businessId,
        draft: options.nextState.cover,
        target: options.target,
        role: "COVER",
        sortOrder: 0,
        altText: options.nextState.cover.asset.alt_text || defaultAltText,
      });
    } else {
      await syncNewDraft({
        businessId: options.businessId,
        draft: options.nextState.cover,
        target: options.target,
        role: "COVER",
        sortOrder: 0,
        altText: defaultAltText,
      });
    }
  }

  for (const [index, draft] of options.nextState.gallery.entries()) {
    const sortOrder = index + 1;
    if (draft.kind === "existing") {
      await syncExistingDraft({
        businessId: options.businessId,
        draft,
        target: options.target,
        role: "GALLERY",
        sortOrder,
        altText: draft.asset.alt_text || defaultAltText,
      });
      continue;
    }

    await syncNewDraft({
      businessId: options.businessId,
      draft,
      target: options.target,
      role: "GALLERY",
      sortOrder,
      altText: defaultAltText,
    });
  }
}
