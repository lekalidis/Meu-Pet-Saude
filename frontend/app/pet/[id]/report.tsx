import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Pet } from "@/src/api";
import { ageText, fmtNum } from "@/src/format";
import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { RECORD_TYPES, RecordType, TYPE_CONFIG } from "@/src/records";
import { buildReportHtml, ReportData } from "@/src/report-html";
import { useSubscription } from "@/src/revenuecat";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { Button, ErrorView, F, Icon, Loading, PetAvatar, ScreenHeader, tap } from "@/src/ui";

export default function Report() {
  useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const { isSubscribed, isLoading: subLoading } = useSubscription();
  const q = useQuery({ queryKey: ["pet", id], queryFn: () => api<Pet>(`/pets/${id}`) });
  const [selected, setSelected] = useState<RecordType[]>([...RECORD_TYPES]);
  const [busy, setBusy] = useState(false);

  // Premium feature
  useEffect(() => {
    if (!subLoading && !isSubscribed) router.replace("/paywall");
  }, [subLoading, isSubscribed, router]);

  const toggle = (ty: RecordType) => {
    tap();
    setSelected((p) => (p.includes(ty) ? p.filter((x) => x !== ty) : [...p, ty]));
  };

  const share = async () => {
    setBusy(true);
    try {
      const sections = RECORD_TYPES.filter((x) => selected.includes(x));
      const data = await api<ReportData>(`/pets/${id}/report-data?sections=${sections.join(",")}`);
      const html = buildReportHtml(data, sections);
      if (Platform.OS === "web") {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: data.pet.name });
        } else {
          await Print.printAsync({ uri });
        }
      }
    } catch {
      toast(t("report.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading)
    return (
      <View style={s.root}>
        <ScreenHeader title={t("report.title")} />
        <Loading />
      </View>
    );
  if (q.isError || !q.data)
    return (
      <View style={s.root}>
        <ScreenHeader title={t("report.title")} />
        <ErrorView message={(q.error as Error)?.message ?? t("genericError")} onRetry={() => q.refetch()} />
      </View>
    );
  const pet = q.data;

  return (
    <View style={s.root}>
      <ScreenHeader title={t("report.title")} subtitle={t("report.subtitle")} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}>
        <View style={s.petCard} testID="report-pet-card">
          <PetAvatar photo={pet.photo} size={64} species={pet.species} />
          <View style={{ flex: 1 }}>
            <Text style={s.petName}>{pet.name}</Text>
            <Text style={s.petMeta}>
              {[t(`species.${pet.species}`), pet.breed, ageText(pet.birth_date), pet.last_weight != null ? `${fmtNum(pet.last_weight)} kg` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </View>

        <Text style={s.section}>{t("report.include")}</Text>
        {RECORD_TYPES.map((ty) => {
          const cfg = TYPE_CONFIG[ty];
          const on = selected.includes(ty);
          const n = pet.counts?.[ty] ?? 0;
          return (
            <Pressable key={ty} testID={`report-section-${ty}`} onPress={() => toggle(ty)} style={[s.row, on && s.rowOn]}>
              <View style={s.rowIcon}>
                <Icon name={cfg.icon} size={22} color={colors[cfg.tint]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{t(`type.${ty}`)}</Text>
                <Text style={s.rowSub}>
                  {t("records", { n })}
                  {cfg.photos ? ` · ${t("report.withPhotos")}` : ""}
                </Text>
              </View>
              <Icon name={on ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={28} color={on ? colors.brandPrimary : colors.muted} />
            </Pressable>
          );
        })}
        <View style={s.tip}>
          <Icon name="lightbulb-on-outline" size={20} color={colors.onBrandSecondary} />
          <Text style={s.tipText}>{t("report.tip")}</Text>
        </View>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={busy ? t("report.generating") : t("report.share")}
          icon="share-variant"
          onPress={share}
          loading={busy}
          disabled={selected.length === 0}
          testID="share-report-button"
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  petCard: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderRadius: 24, backgroundColor: c.surfaceTertiary },
  petName: { fontFamily: F.display, fontSize: 20, color: c.onSurface },
  petMeta: { fontFamily: F.semi, fontSize: 13, color: c.muted, marginTop: 2 },
  section: { fontFamily: F.display, fontSize: 18, color: c.onSurface, marginTop: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
  },
  rowOn: { borderColor: c.brandPrimary },
  rowIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: F.bold, fontSize: 15, color: c.onSurface },
  rowSub: { fontFamily: F.semi, fontSize: 13, color: c.muted },
  tip: { flexDirection: "row", gap: 12, alignItems: "center", padding: 16, borderRadius: 16, backgroundColor: c.brandSecondary, marginTop: 8 },
  tipText: { flex: 1, fontFamily: F.semi, fontSize: 13, color: c.onBrandSecondary },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
}));
