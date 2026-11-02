import type { PetRecord } from "@/src/api";
import type { ThemeColors } from "@/src/theme";
import { addDays, fmtNum, isoToLocal } from "@/src/format";
import { t } from "@/src/i18n";

export type RecordType = "vaccine" | "weight" | "illness" | "medication" | "visit" | "exam" | "grooming";
export const RECORD_TYPES: RecordType[] = ["vaccine", "weight", "illness", "medication", "visit", "grooming", "exam"];
export const PREMIUM_TYPES: RecordType[] = ["exam"];

export type FieldDef = {
  key: string;
  kind: "text" | "multiline" | "number" | "date" | "bool" | "choice";
  ph?: boolean; // has a translated placeholder at `${type}.${key}.ph`
  required?: boolean;
  options?: string[]; // codes, label at `opt.${code}`
  suffix?: string;
  suffixKey?: string; // translated suffix
  showIf?: (v: Record<string, any>) => boolean;
};

export type TypeConfig = {
  icon: string;
  tint: keyof ThemeColors;
  withTime: boolean;
  fields: FieldDef[];
  photos?: boolean;
  docs?: boolean;
  title: (r: PetRecord) => string;
  subtitle: (r: PetRecord) => string;
};

const join = (...p: (string | undefined | null | false)[]) => p.filter(Boolean).join(" · ");

export const TYPE_CONFIG: Record<RecordType, TypeConfig> = {
  vaccine: {
    icon: "needle",
    tint: "brandPrimary",
    withTime: false,
    fields: [
      { key: "name", kind: "text", ph: true, required: true },
      { key: "next_date", kind: "date" },
      { key: "batch", kind: "text" },
      { key: "vet", kind: "text" },
      { key: "notes", kind: "multiline", ph: true },
    ],
    title: (r) => r.data.name || t("type.vaccine"),
    subtitle: (r) =>
      join(t("sub.applied", { d: isoToLocal(r.date) }), r.data.next_date && t("sub.booster", { d: isoToLocal(r.data.next_date) })),
  },
  weight: {
    icon: "scale-bathroom",
    tint: "brandSecondary",
    withTime: false,
    fields: [
      { key: "weight", kind: "number", ph: true, suffix: "kg", required: true },
      { key: "notes", kind: "multiline" },
    ],
    title: (r) => `${fmtNum(r.data.weight)} kg`,
    subtitle: (r) => isoToLocal(r.date),
  },
  illness: {
    icon: "thermometer",
    tint: "error",
    withTime: true,
    fields: [
      { key: "symptoms", kind: "multiline", ph: true, required: true },
      { key: "fever", kind: "bool" },
      { key: "temperature", kind: "number", ph: true, suffix: "°C", showIf: (v) => !!v.fever },
      { key: "vomit", kind: "bool" },
      { key: "diarrhea", kind: "bool" },
      { key: "appetite", kind: "choice", options: ["normal", "reduced", "none"] },
      { key: "notes", kind: "multiline", ph: true },
    ],
    photos: true,
    title: (r) => r.data.symptoms || t("type.illness"),
    subtitle: (r) =>
      join(
        isoToLocal(r.date),
        r.data.fever ? `${t("list.fever")}${r.data.temperature ? ` ${fmtNum(r.data.temperature)}°C` : ""}` : t("sub.noFever"),
      ),
  },
  medication: {
    icon: "pill",
    tint: "success",
    withTime: false,
    fields: [
      { key: "name", kind: "text", ph: true, required: true },
      { key: "dose", kind: "text", ph: true },
      { key: "frequency", kind: "text", ph: true },
      { key: "end_date", kind: "date" },
      { key: "notes", kind: "multiline" },
    ],
    title: (r) => r.data.name || t("type.medication"),
    subtitle: (r) => join(r.data.dose, r.data.frequency, t("sub.since", { d: isoToLocal(r.date) })),
  },
  visit: {
    icon: "stethoscope",
    tint: "onSurface",
    withTime: false,
    fields: [
      { key: "reason", kind: "text", ph: true, required: true },
      { key: "clinic", kind: "text" },
      { key: "vet", kind: "text" },
      { key: "notes", kind: "multiline", ph: true },
    ],
    title: (r) => r.data.reason || t("type.visit"),
    subtitle: (r) => join(isoToLocal(r.date), r.data.clinic, r.data.vet),
  },
  grooming: {
    icon: "shower-head",
    tint: "brandSecondary",
    withTime: false,
    fields: [
      { key: "kind", kind: "choice", options: ["bath", "groom", "both"] },
      { key: "place", kind: "text" },
      { key: "remind_days", kind: "number", ph: true, suffixKey: "days" },
      { key: "notes", kind: "multiline" },
    ],
    title: (r) => (r.data.kind ? t(`opt.${r.data.kind}`) : t("type.grooming")),
    subtitle: (r) =>
      join(isoToLocal(r.date), r.data.place, r.data.remind_days && t("sub.nextBath", { d: isoToLocal(addDays(r.date, Number(r.data.remind_days))) })),
  },
  exam: {
    icon: "file-document-multiple",
    tint: "brandPrimary",
    withTime: false,
    fields: [
      { key: "kind", kind: "choice", options: ["ultrasound", "xray", "blood", "urine", "stool", "other"] },
      { key: "name", kind: "text", ph: true },
      { key: "clinic", kind: "text" },
      { key: "notes", kind: "multiline", ph: true },
    ],
    photos: true,
    docs: true,
    title: (r) => r.data.name || (r.data.kind ? t(`opt.${r.data.kind}`) : t("type.exam")),
    subtitle: (r) => join(isoToLocal(r.date), r.data.name && r.data.kind && t(`opt.${r.data.kind}`), r.data.clinic),
  },
};

export const fieldLabel = (type: RecordType, key: string) => t(`${type}.${key}`);
