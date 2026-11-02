import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "@/src/api";
import { addDays, todayIso } from "@/src/format";
import { t } from "@/src/i18n";

export const remindersSupported = Platform.OS !== "web";

type Reminder = {
  id: string;
  type: "vaccine" | "grooming" | "parasite" | "medication";
  pet_name: string;
  name: string;
  date: string;
  dose?: string;
  times?: string;
  end?: string | null;
};

if (remindersSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type PermState = "granted" | "ask" | "blocked" | "unsupported";

export async function getPermState(): Promise<PermState> {
  if (!remindersSupported) return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return "granted";
  return p.canAskAgain ? "ask" : "blocked";
}

export async function requestPerm(): Promise<PermState> {
  if (!remindersSupported) return "unsupported";
  const p = await Notifications.requestPermissionsAsync();
  if (p.granted) {
    await syncReminders(true);
    return "granted";
  }
  return p.canAskAgain ? "ask" : "blocked";
}

const at = (iso: string, hhmm = "09:00") => {
  const [y, m, d] = iso.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi, 0);
};

const MED_DAYS_AHEAD = 7; // medication doses are scheduled one week ahead and refreshed on app open
const MAX_NOTIFS = 60; // iOS keeps at most 64 pending local notifications

// Premium only. Re-schedules all local reminders from the server list.
export async function syncReminders(isPremium: boolean) {
  if (!remindersSupported) return;
  try {
    if (!isPremium) {
      await Notifications.cancelAllScheduledNotificationsAsync();
      return;
    }
    if ((await getPermState()) !== "granted") return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", { name: "Reminders", importance: Notifications.AndroidImportance.HIGH });
    }
    const list = await api<Reminder[]>("/reminders");
    await Notifications.cancelAllScheduledNotificationsAsync();
    const today = todayIso();
    const jobs: { when: Date; title: string; body: string }[] = [];
    for (const r of list) {
      const body = `${r.pet_name}: ${r.name}${r.dose ? ` · ${r.dose}` : ""}`;
      if (r.type === "vaccine") {
        const before = addDays(r.date, -7);
        if (before >= today) jobs.push({ when: at(before), title: t("rem.vaccineSoon"), body });
        jobs.push({ when: at(r.date), title: t("rem.vaccineToday"), body });
      } else if (r.type === "parasite") {
        jobs.push({ when: at(r.date), title: t("rem.parasite"), body });
      } else if (r.type === "grooming") {
        jobs.push({ when: at(r.date), title: t("rem.bath"), body: t("rem.bodyBath", { pet: r.pet_name }) });
      } else if (r.type === "medication" && r.times) {
        for (let i = 0; i < MED_DAYS_AHEAD; i++) {
          const day = addDays(r.date, i);
          if (r.end && day > r.end) break;
          for (const hhmm of r.times.split(",").map((x) => x.trim())) jobs.push({ when: at(day, hhmm), title: t("rem.med"), body });
        }
      }
    }
    const now = Date.now();
    const next = jobs.filter((x) => x.when.getTime() > now).sort((a, b) => a.when.getTime() - b.when.getTime()).slice(0, MAX_NOTIFS);
    for (const j of next) {
      await Notifications.scheduleNotificationAsync({
        content: { title: j.title, body: j.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: j.when, channelId: "reminders" },
      });
    }
  } catch (e) {
    console.warn("reminders sync failed", e);
  }
}

export async function clearReminders() {
  if (remindersSupported) await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}
