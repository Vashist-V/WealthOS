import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** URL-safe path segment for symbols like M&M or ^NSEI. */
export function symbolPath(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol)}`;
}

export function downloadFile(name: string, content: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function randomId(length = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
