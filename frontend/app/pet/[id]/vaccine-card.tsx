import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";

import { api, Pet, PetRecord } from "@/src/api";
import { ageText, isoToLocal } from "@/src/format";
import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { Button, ErrorView, F, Icon, Loading, PetAvatar, ScreenHeader } from "@/src/ui";

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default function VaccineCard() {
  useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const cardRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const pet = useQuery({ queryKey: ["pet", id], queryFn: () => api<Pet>(`/pets/${id}`) });
  const q = useQuery({ queryKey: ["records", id, "vaccine"], queryFn: () => api<PetRecord[]>(`/pets/${id}/records?type=vaccine`) });

  const vaccines = q.data ?? [];

  const share = async () => {
    setBusy(true);
    try {
      if (Platform.OS === "web") {
        const rows = vaccines
          .map((v) => `<tr><td>${esc(v.data.name || "")}</td><td>${isoToLocal(v.date)}</td><td>${v.data.next_date ? isoToLocal(v.data.next_date) : "-"}</td></tr>`)
          .join("");
        await Print.printAsync({
          html: `<html><body style="font-family:Helvetica;padding:24px"><h2 style="color:#FF7F6A">${esc(t("card.title"))} · ${esc(pet.data?.name ?? "")}</h2>
          <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><tr><th>${t("card.vaccine")}</th><th>${t("card.given")}</th><th>${t("card.next")}</th></tr>${rows}</table>
          <p style="color:#7A7571;font-size:10px">${esc(t("card.footer", { app: t("appName") }))}</p></body></html>`,
        });
      } else {
        const uri = await captureRef(cardRef, { format: "png", quality: 1 });
        await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: t("card.title") });
      }
    } catch {
      toast(t("card.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  if (pet.isLoading || q.isLoading)
    return (
      <View style={s.root}>
        <ScreenHeader title={t("card.title")} />
        <Loading />
      </View>
    );
  if (pet.isError || !pet.data)
    return (
      <View style={s.root}>
        <ScreenHeader title={t("card.title")} />
        <ErrorView message={t("genericError")} onRetry={() => pet.refetch()} />
      </View>
    );
  const p = pet.data;

  return (
    <View style={s.root}>
      <ScreenHeader title={t("card.title")} subtitle={p.name} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}>
        <View ref={cardRef} collapsable={false} style={s.card} testID="vaccine-card">
          <View style={s.cardHead}>
            <PetAvatar photo={p.photo} size={72} species={p.species} />
            <View style={{ flex: 1 }}>
              <Text style={s.cardKicker}>{t("card.title").toUpperCase()}</Text>
              <Text style={s.cardName}>{p.name}</Text>
              <Text style={s.cardMeta}>{[t(`species.${p.species}`), p.breed, ageText(p.birth_date)].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>
          <View style={s.tableHead}>
            <Text style={[s.th, { flex: 1.4 }]}>{t("card.vaccine")}</Text>
            <Text style={s.th}>{t("card.given")}</Text>
            <Text style={s.th}>{t("card.next")}</Text>
          </View>
          {vaccines.length === 0 ? (
            <Text style={s.empty}>{t("card.empty")}</Text>
          ) : (
            vaccines.map((v) => (
              <View key={v.id} style={s.tr}>
                <View style={{ flex: 1.4, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="check-decagram" size={16} color={colors.success} />
                  <Text style={s.tdName} numberOfLines={2}>
                    {v.data.name}
                  </Text>
                </View>
                <Text style={s.td}>{isoToLocal(v.date)}</Text>
                <Text style={[s.td, { color: colors.brandPrimary }]}>{v.data.next_date ? isoToLocal(v.data.next_date) : "—"}</Text>
              </View>
            ))
          )}
          <View style={s.footer}>
            <Icon name="paw" size={14} color={colors.onBrandPrimary} />
            <Text style={s.footerText}>{t("card.footer", { app: t("appName") })}</Text>
          </View>
        </View>
      </ScrollView>
      <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
        <Button label={t("card.share")} icon="share-variant" onPress={share} loading={busy} disabled={vaccines.length === 0} testID="share-vaccine-card-button" />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, backgroundColor: c.brandTertiary },
  cardKicker: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1, color: c.onBrandTertiary },
  cardName: { fontFamily: F.display, fontSize: 24, color: c.onSurface },
  cardMeta: { fontFamily: F.semi, fontSize: 13, color: c.muted },
  tableHead: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.divider },
  th: { flex: 1, fontFamily: F.bold, fontSize: 12, color: c.muted },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  tdName: { fontFamily: F.bold, fontSize: 14, color: c.onSurface, flexShrink: 1 },
  td: { flex: 1, fontFamily: F.semi, fontSize: 13, color: c.onSurface },
  empty: { fontFamily: F.semi, fontSize: 14, color: c.muted, padding: 16 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, backgroundColor: c.brandPrimary },
  footerText: { fontFamily: F.bold, fontSize: 12, color: c.onBrandPrimary },
  bottom: {
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
