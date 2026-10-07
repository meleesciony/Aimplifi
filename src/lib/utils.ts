import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// UI.1 (DECISIONS #793): `shadow-surface` / `shadow-surface-hover` are theme
// shadows (globals.css @theme), not shadow colours. Without this, tailwind-merge
// keeps both `shadow-surface` and a caller's `shadow-none` / `shadow-lg`, and the
// token wins in the cascade — a card could never drop or override its depth.
const twMerge = extendTailwindMerge({
  extend: { theme: { shadow: ["surface", "surface-hover"] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
