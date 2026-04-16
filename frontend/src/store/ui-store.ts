import { create } from "zustand";

interface UiState {
  isMobileNavOpen: boolean;
  isCartDrawerOpen: boolean;
  modalKey: string | null;
  setMobileNavOpen: (value: boolean) => void;
  setCartDrawerOpen: (value: boolean) => void;
  openModal: (key: string) => void;
  closeModal: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isMobileNavOpen: false,
  isCartDrawerOpen: false,
  modalKey: null,
  setMobileNavOpen: (value) => set({ isMobileNavOpen: value }),
  setCartDrawerOpen: (value) => set({ isCartDrawerOpen: value }),
  openModal: (key) => set({ modalKey: key }),
  closeModal: () => set({ modalKey: null }),
}));
