import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return score.toFixed(3);
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-[--color-text-muted]";
  if (score >= 0.9) return "text-[--color-success]";
  if (score >= 0.7) return "text-[--color-candidate]";
  return "text-[--color-danger]";
}

export function scoreRingColor(score: number | null | undefined): string {
  if (score == null) return "border-[--color-border]";
  if (score >= 0.9) return "border-[--color-success]/30";
  if (score >= 0.7) return "border-[--color-candidate]/30";
  return "border-[--color-danger]/30";
}
