import type { Pet, PetRecord } from "@/src/api";
import { ageText, fmtNum, isoToLocal } from "@/src/format";
import { t } from "@/src/i18n";
import { fieldLabel, RecordType, TYPE_CONFIG } from "@/src/records";

export type ReportData = { pet: Pet; records: PetRecord[]; images: Record<string, string> };

const esc = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "-"
    : String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cell(type: RecordType, r: PetRecord, key: string) {
  const f = TYPE_CONFIG[type].fields.find((x) => x.key === key);
  const v = r.data[key];
  if (!f) return esc(v);
  if (f.kind === "date") return v ? isoToLocal(v) : "-";
  if (f.kind === "bool") return v ? t("yes") : t("no");
  if (f.kind === "number") return v != null ? `${fmtNum(v)}${f.suffix ? ` ${f.suffix}` : ""}` : "-";
  if (f.kind === "choice") return v ? esc(t(`opt.${v}`)) : "-";
  return esc(v);
}

// Builds the vet report HTML in the current app language.
export function buildReportHtml({ pet, records, images }: ReportData, sections: RecordType[]) {
  const img = (path: string, cls: string) => (images[path] ? `<img class="${cls}" src="${images[path]}"/>` : "");
  const lastW = records.filter((r) => r.type === "weight").sort((a, b) => b.date.localeCompare(a.date))[0];
  const out: string[] = [];
  out.push(`<div class="header">${pet.photo ? img(pet.photo, "avatar") : ""}<div>
    <h1>${esc(pet.name)}</h1>
    <p>${[t(`species.${pet.species}`), pet.breed, pet.sex ? t(`sex.${pet.sex}`) : ""].filter(Boolean).map(esc).join(" · ")}</p>
    <p>${t("petForm.birth")}: <b>${pet.birth_date ? isoToLocal(pet.birth_date) : "-"}</b> (${esc(ageText(pet.birth_date))}) · ${t("pet.weight")}: <b>${lastW ? `${fmtNum(lastW.data.weight)} kg` : "-"}</b></p>
    <p>${t("petForm.color")}: ${esc(pet.color)} · ${t("petForm.microchip")}: ${esc(pet.microchip)}</p>
    ${pet.notes ? `<p>${t("petForm.notes")}: ${esc(pet.notes)}</p>` : ""}
  </div></div>`);

  for (const type of sections) {
    const cfg = TYPE_CONFIG[type];
    const items = records.filter((r) => r.type === type);
    out.push(`<h2>${t(`type.${type}`)}</h2>`);
    if (!items.length) {
      out.push(`<p class="empty">${t("report.none")}</p>`);
      continue;
    }
    if (!cfg.photos) {
      const keys = cfg.fields.map((f) => f.key);
      const th = [t(`date.${type}`), ...keys.map((k) => fieldLabel(type, k))].map((h) => `<th>${esc(h)}</th>`).join("");
      const rows = items
        .map((r) => `<tr><td>${isoToLocal(r.date)}</td>${keys.map((k) => `<td>${cell(type, r, k)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><tr>${th}</tr>${rows}</table>`);
    } else {
      for (const r of items) {
        const lines = cfg.fields
          .filter((f) => !f.showIf || f.showIf(r.data))
          .filter((f) => f.kind === "bool" || (r.data[f.key] !== undefined && r.data[f.key] !== ""))
          .map((f) => `<p><span class="k">${esc(fieldLabel(type, f.key))}:</span> <b>${cell(type, r, f.key)}</b></p>`)
          .join("");
        const pics = (r.photos ?? []).slice(0, 6).map((p) => img(p, "photo")).join("");
        const docs = (r.docs ?? []).map((d) => `<p class="doc">${esc(t("report.attachedPdf", { name: d.name }))}</p>`).join("");
        out.push(`<div class="card"><p class="when">${isoToLocal(r.date)}</p>${lines}${pics ? `<div class="photos">${pics}</div>` : ""}${docs}</div>`);
      }
    }
  }

  const css = `body{font-family:Helvetica,Arial,sans-serif;color:#2D2A26;padding:24px;font-size:12px}
  .brand{color:#FF7F6A;font-weight:bold;font-size:13px;letter-spacing:1px}
  .header{display:flex;gap:16px;align-items:center;background:#FFF1E8;border-radius:16px;padding:16px;margin:8px 0 16px}
  .avatar{width:96px;height:96px;border-radius:48px;object-fit:cover}
  h1{margin:0 0 4px;font-size:24px} h2{color:#FF7F6A;border-bottom:2px solid #FFEAE6;padding-bottom:4px;margin-top:22px;font-size:16px}
  p{margin:3px 0} table{width:100%;border-collapse:collapse} th{background:#FFEAE6;text-align:left;padding:6px}
  td{border-bottom:1px solid #EBE3D8;padding:6px;vertical-align:top} .k{color:#7A7571}
  .card{border:1px solid #EBE3D8;border-radius:12px;padding:10px;margin:8px 0;page-break-inside:avoid} .when{font-weight:bold;color:#FF7F6A}
  .photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px} .photo{width:150px;height:150px;object-fit:cover;border-radius:8px}
  .empty{color:#7A7571} .doc{color:#7A7571} .foot{margin-top:24px;color:#7A7571;font-size:10px}`;
  const now = new Date();
  const stamp = `${isoToLocal(now.toISOString().slice(0, 10))} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>${css}</style></head><body><div class="brand">${esc(t("appName")).toUpperCase()} · ${t("report.header")}</div>${out.join("")}
  <p class="foot">${t("report.generated", { d: stamp })} · ${esc(t("appName"))}</p></body></html>`;
}
