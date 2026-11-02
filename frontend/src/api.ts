import { t } from "@/src/i18n";
import { storage } from "@/src/utils/storage";
import { uploadForm } from "@/src/utils/upload";
import type { RecordType } from "@/src/records";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
let deviceId = "";

function makeId() {
  const c = "abcdef0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * 16)];
  return s;
}

// Anonymous per-device identity: the tutor's data is tied to this phone.
export async function initDevice(): Promise<string> {
  if (deviceId) return deviceId;
  const saved = await storage.secureGet("device_id", "");
  if (saved) {
    deviceId = saved;
    return saved;
  }
  const id = makeId();
  await storage.secureSet("device_id", id);
  deviceId = id;
  return id;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const id = await initDevice();
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", "X-Device-Id": id },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(res.status === 404 ? t("notFound") : t("genericError"));
  return res.json();
}

export function fileUrl(path: string) {
  return `${BASE}/api/files/${path}?d=${deviceId}`;
}

export async function uploadFile(file: { uri: string; name?: string | null; mimeType?: string | null }) {
  const id = await initDevice();
  const res = await uploadForm(`${BASE}/api/upload`, {
    headers: { "X-Device-Id": id },
    files: { file: { uri: file.uri, name: file.name ?? "photo.jpg", mimeType: file.mimeType ?? "image/jpeg" } },
  });
  if (!res.ok)
    throw new Error(res.status === 402 ? t("upload.noCredits") : res.status === 413 ? t("upload.tooLarge") : t("upload.failed"));
  const j = await res.json();
  return j.path as string;
}

export type Pet = {
  id: string;
  name: string;
  species: string;
  breed: string;
  sex: string;
  birth_date: string | null;
  color: string;
  microchip: string;
  notes: string;
  photo: string | null;
  last_weight?: number | null;
  counts?: Record<RecordType, number>;
  next_vaccine?: string | null;
  overdue_vaccines?: number;
};

export type PetRecord = {
  id: string;
  pet_id: string;
  type: RecordType;
  date: string;
  data: Record<string, any>;
  photos: string[];
  docs: { path: string; name: string }[];
};

export type Upcoming = { record_id: string; pet_id: string; pet_name: string; name: string; next_date: string };
