import { t } from "@/src/i18n";
import { storage } from "@/src/utils/storage";
import { uploadForm } from "@/src/utils/upload";
import type { RecordType } from "@/src/records";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "auth_token";
let deviceId = "";
let authToken: string | null = null;
let onUnauthorized: () => void = () => {};

function makeId() {
  const c = "abcdef0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * 16)];
  return s;
}

// Anonymous device id: only used to move data created before login into the account.
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

export async function loadToken() {
  authToken = (await storage.secureGet(TOKEN_KEY, "")) || null;
  return authToken;
}

export async function saveToken(token: string | null) {
  authToken = token;
  if (token) await storage.secureSet(TOKEN_KEY, token);
  else await storage.secureRemove(TOKEN_KEY);
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(public status: number, public detail: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") detail = j.detail;
    } catch {}
    if (res.status === 401 && opts.auth !== false) onUnauthorized();
    throw new ApiError(res.status, detail, res.status === 404 ? t("notFound") : t("genericError"));
  }
  return res.json();
}

export function fileUrl(path: string) {
  return `${BASE}/api/files/${path}?t=${encodeURIComponent(authToken ?? "")}`;
}

export async function uploadFile(file: { uri: string; name?: string | null; mimeType?: string | null }) {
  const res = await uploadForm(`${BASE}/api/upload`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    files: { file: { uri: file.uri, name: file.name ?? "photo.jpg", mimeType: file.mimeType ?? "image/jpeg" } },
  });
  if (!res.ok)
    throw new Error(res.status === 402 ? t("upload.noCredits") : res.status === 413 ? t("upload.tooLarge") : t("upload.failed"));
  const j = await res.json();
  return j.path as string;
}

export type User = { id: string; email: string; name: string; picture?: string | null; auth_methods: string[] };

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
