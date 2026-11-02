import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { t } from "@/src/i18n";
import { getPermState, PermState, requestPerm, syncReminders } from "@/src/reminders";
import { makeStyles, useTheme } from "@/src/theme";
import { Button, F, Icon, Sheet } from "@/src/ui";

// Home card that explains reminders before asking for the notification permission.
export function ReminderBanner() {
  const s = useStyles();
  const { colors } = useTheme();
  const [state, setState] = useState<PermState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getPermState().then((p) => {
      setState(p);
      if (p === "granted") syncReminders();
    });
  }, []);

  if (!state || state === "granted" || state === "unsupported") return null;

  return (
    <>
      <Pressable style={s.card} onPress={() => setOpen(true)} testID="reminder-banner">
        <View style={s.icon}>
          <Icon name="bell-ring" size={22} color={colors.onBrandSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t("rem.title")}</Text>
          <Text style={s.text} numberOfLines={2}>
            {state === "blocked" ? t("rem.blocked") : t("rem.text")}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={colors.onBrandSecondary} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} icon="bell-ring" title={t("rem.title")} text={state === "blocked" ? t("rem.blocked") : t("rem.text")} testID="reminder-sheet">
        <View style={{ gap: 8 }}>
          {state === "blocked" ? (
            <Button label={t("perm.settings")} icon="cog" onPress={() => Linking.openSettings()} testID="reminder-settings-button" />
          ) : (
            <Button
              label={t("rem.enable")}
              icon="bell"
              onPress={async () => {
                const p = await requestPerm();
                setState(p);
                if (p === "granted") setOpen(false);
              }}
              testID="reminder-enable-button"
            />
          )}
          <Button label={t("cancel")} variant="ghost" onPress={() => setOpen(false)} testID="reminder-cancel-button" />
        </View>
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 24, backgroundColor: c.brandSecondary, marginBottom: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: F.bold, fontSize: 15, color: c.onBrandSecondary },
  text: { fontFamily: F.semi, fontSize: 13, color: c.onBrandSecondary },
}));
