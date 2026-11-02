import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "@/src/api";
import { addDays, todayIso } from "@/src/format";
import { t } from "@/src/i18n";

export const remindersSupported = Platform.OS !== "web";

type Reminder = { id: string; type: "vaccine" | "grooming"; pet_name: string; name: string; date: string };

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
    await syncReminders();
    return "granted";
  }
  return p.canAskAgain ? "ask" : "blocked";
}

// 9:00 local time on the given ISO date
const at9 = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 9, 0, 0);
};

// Re-schedules all local reminders from the server list (vaccines: 7 days before + on the day; baths: on the due day).
export async function syncReminders() {
  try {
    if ((await getPermState()) !== "granted") return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", { name: "Reminders", importance: Notifications.AndroidImportance.HIGH });
    }
    const list = await api<Reminder[]>("/reminders");
    await Notifications.cancelAllScheduledNotificationsAsync();
    const now = Date.now();
    const jobs: { when: Date; title: string; body: string }[] = [];
    for (const r of list) {
      if (r.type === "vaccine") {
        const body = t("rem.bodyVaccine", { pet: r.pet_name, name: r.name });
        const before = addDays(r.date, -7);
        if (before >= todayIso()) jobs.push({ when: at9(before), title: t("rem.vaccineSoon"), body });
        jobs.push({ when: at9(r.date), title: t("rem.vaccineToday"), body });
      } else {
        jobs.push({ when: at9(r.date), title: t("rem.bath"), body: t("rem.bodyBath", { pet: r.pet_name }) });
      }
    }
    for (const j of jobs.filter((x) => x.when.getTime() > now).slice(0, 60)) {
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
