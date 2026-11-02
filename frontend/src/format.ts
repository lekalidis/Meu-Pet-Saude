import { getLocales } from "expo-localization";

import { dateOrder, decimalSep, getLang, t } from "@/src/i18n";

export const pad = (n: number) => String(n).padStart(2, "0");

// ISO (YYYY-MM-DD[THH:MM]) -> localized "DD/MM/YYYY" (or MM/DD/YYYY in English) [+ " HH:MM"]
export function isoToLocal(iso?: string | null) {
  if (!iso) return "";
  const [d, tm] = iso.split("T");
  const [y, m, dd] = d.split("-");
  const s = dateOrder() === "MDY" ? `${m}/${dd}/${y}` : `${dd}/${m}/${y}`;
  return tm ? `${s} ${tm.slice(0, 5)}` : s;
}

export function localToIso(v: string): string | null {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, a, b, y] = m;
  const [d, mo] = dateOrder() === "MDY" ? [b, a] : [a, b];
  const dt = new Date(+y, +mo - 1, +d);
  if (dt.getMonth() !== +mo - 1 || dt.getDate() !== +d) return null;
  return `${y}-${mo}-${d}`;
}

export const shortDate = (iso: string) => isoToLocal(iso).slice(0, 5);

export const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());

export function maskDate(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function maskTime(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

export function todayIso() {
  const x = new Date();
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export const todayLocal = () => isoToLocal(todayIso());

export function nowTime() {
  const x = new Date();
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function ageText(birth?: string | null) {
  if (!birth) return t("age.unknown");
  const [y, m, d] = birth.split("-").map(Number);
  const x = new Date();
  const months = Math.max((x.getFullYear() - y) * 12 + (x.getMonth() + 1 - m) - (x.getDate() < d ? 1 : 0), 0);
  const yy = Math.floor(months / 12);
  const mm = months % 12;
  if (yy === 0) return t("age.month", { n: mm });
  return mm ? `${t("age.year", { n: yy })} ${t("age.and")} ${t("age.month", { n: mm })}` : t("age.year", { n: yy });
}

export function daysUntil(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - x.getTime()) / 86400000);
}

export function dueLabel(iso: string) {
  const n = daysUntil(iso);
  if (n < 0) return t("due.late", { n: -n });
  if (n === 0) return t("due.today");
  if (n === 1) return t("due.tomorrow");
  return t("due.in", { n });
}

export function fmtNum(v: unknown) {
  if (v === null || v === undefined || v === "") return "";
  return String(v).replace(".", decimalSep());
}

export function parseNum(v: string): number | null {
  const n = parseFloat(v.replace(",", ".").trim());
  return isNaN(n) ? null : n;
}

export function addDays(iso: string, n: number) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export const currencyCode = () => getLocales()[0]?.currencyCode ?? "USD";

export function fmtMoney(v: number) {
  try {
    return new Intl.NumberFormat(getLang(), { style: "currency", currency: currencyCode() }).format(v);
  } catch {
    return `${currencyCode()} ${fmtNum(v.toFixed(2))}`;
  }
}

// "8:00, 20:00" -> "08:00, 20:00"; null when invalid
export function normalizeTimes(v: string): string | null {
  const parts = v.split(/[,;\s]+/).filter(Boolean).map((p) => (/^\d:\d{2}$/.test(p) ? `0${p}` : p));
  if (!parts.length || parts.some((p) => !validTime(p))) return null;
  return [...new Set(parts)].sort().join(", ");
}
