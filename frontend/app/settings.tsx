import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LANGS, t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { useSubscription } from "@/src/revenuecat";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { Button, F, Icon, ScreenHeader, tap } from "@/src/ui";

export default function Settings() {
  const { lang, setLang } = useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const { isSubscribed, restore, isRestoring } = useSubscription();

  const onRestore = async () => {
    try {
      const info = await restore();
      toast(info.entitlements.active.pro ? t("settings.restored") : t("settings.nothing"), info.entitlements.active.pro ? "success" : "error");
    } catch {
      toast(t("genericError"), "error");
    }
  };

  return (
    <View style={s.root}>
      <ScreenHeader title={t("settings.title")} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={s.section}>{t("settings.plan")}</Text>
        <View style={[s.plan, isSubscribed && { backgroundColor: colors.brandSecondary }]} testID="plan-card">
          <Icon name={isSubscribed ? "crown" : "paw"} size={28} color={isSubscribed ? colors.onBrandSecondary : colors.brandPrimary} />
          <Text style={[s.planText, isSubscribed && { color: colors.onBrandSecondary }]} testID="plan-status">
            {isSubscribed ? t("settings.premiumActive") : t("settings.free")}
          </Text>
        </View>
        {!isSubscribed && <Button label={t("settings.upgrade")} icon="crown" onPress={() => router.push("/paywall")} testID="settings-upgrade-button" />}
        <Button label={t("settings.restore")} variant="ghost" icon="restore" onPress={onRestore} loading={isRestoring} testID="settings-restore-button" />

        <Text style={s.section}>{t("settings.language")}</Text>
        <View style={s.langList}>
          {LANGS.map((l, i) => {
            const on = l.code === lang;
            return (
              <Pressable
                key={l.code}
                testID={`lang-${l.code}`}
                onPress={() => {
                  tap();
                  setLang(l.code);
                }}
                style={[s.langRow, i > 0 && s.langDivider]}
              >
                <Text style={[s.langName, on && { color: colors.brandPrimary }]}>{l.name}</Text>
                <Icon name={on ? "check-circle" : "circle-outline"} size={24} color={on ? colors.brandPrimary : colors.muted} />
              </Pressable>
            );
          })}
        </View>
        <Text style={s.note}>{t("settings.deviceNote")}</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  section: { fontFamily: F.display, fontSize: 18, color: c.onSurface, marginTop: 12 },
  plan: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 24, backgroundColor: c.surfaceTertiary },
  planText: { fontFamily: F.bold, fontSize: 16, color: c.onSurface, flex: 1 },
  langList: { backgroundColor: c.surfaceSecondary, borderRadius: 24, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  langRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56, paddingHorizontal: 16 },
  langDivider: { borderTopWidth: 1, borderTopColor: c.divider },
  langName: { fontFamily: F.bold, fontSize: 16, color: c.onSurface },
  note: { fontFamily: F.semi, fontSize: 12, color: c.muted, marginTop: 8 },
}));
