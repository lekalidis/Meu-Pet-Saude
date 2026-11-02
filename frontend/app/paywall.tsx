import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { isTestStore, useSubscription } from "@/src/revenuecat";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { Button, F, Icon, IconButton, Sheet, tap } from "@/src/ui";

export default function Paywall() {
  useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const sub = useSubscription();
  const pkgs = sub.offerings?.current?.availablePackages ?? [];
  const monthly = pkgs.find((p) => p.identifier === "$rc_monthly");
  const annual = pkgs.find((p) => p.identifier === "$rc_annual");
  const options = [annual, monthly].filter(Boolean) as PurchasesPackage[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = options.find((p) => p.identifier === selectedId) ?? options[0];
  const [confirm, setConfirm] = useState(false);

  const planName = (p: PurchasesPackage) => (p.identifier === "$rc_annual" ? t("pay.annual") : t("pay.monthly"));

  const doPurchase = async () => {
    if (!selected) return;
    setConfirm(false);
    try {
      const info = await sub.purchase(selected);
      if (info.entitlements.active.pro) {
        toast(t("pay.success"));
        router.back();
      }
    } catch (e: any) {
      if (e?.userCancelled) return;
      toast(e?.message === "identity_not_ready" ? t("pay.identityError") : e?.message || t("genericError"), "error");
    }
  };

  const onBuy = () => {
    tap();
    if (isTestStore) setConfirm(true);
    else doPurchase();
  };

  const onRestore = async () => {
    try {
      const info = await sub.restore();
      if (info.entitlements.active.pro) {
        toast(t("settings.restored"));
        router.back();
      } else toast(t("settings.nothing"), "error");
    } catch {
      toast(t("genericError"), "error");
    }
  };

  const features = [
    { icon: "paw", text: t("pay.f1") },
    { icon: "file-pdf-box", text: t("pay.f2") },
    { icon: "file-document-multiple", text: t("pay.f3") },
  ];

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 180 }]}>
        <View style={{ flexDirection: "row" }}>
          <IconButton icon="close" testID="paywall-close-button" onPress={() => router.back()} />
        </View>
        <View style={s.hero}>
          <View style={s.crown}>
            <Icon name="crown" size={44} color={colors.onBrandSecondary} />
          </View>
          <Text style={s.title}>{t("pay.title")}</Text>
          <Text style={s.subtitle}>{t("pay.subtitle")}</Text>
        </View>
        <View style={s.features}>
          {features.map((f) => (
            <View key={f.icon} style={s.feature}>
              <View style={s.featIcon}>
                <Icon name={f.icon} size={22} color={colors.brandPrimary} />
              </View>
              <Text style={s.featText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {sub.isSubscribed ? (
          <View style={s.already} testID="already-premium">
            <Icon name="check-decagram" size={24} color={colors.success} />
            <Text style={s.featText}>{t("pay.already")}</Text>
          </View>
        ) : sub.isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : options.length === 0 ? (
          <Text style={s.unavailable} testID="paywall-unavailable">
            {t("pay.unavailable")}
          </Text>
        ) : (
          options.map((p) => {
            const on = p.identifier === selected?.identifier;
            const isAnnual = p.identifier === "$rc_annual";
            return (
              <Pressable
                key={p.identifier}
                testID={`plan-${isAnnual ? "annual" : "monthly"}`}
                onPress={() => {
                  tap();
                  setSelectedId(p.identifier);
                }}
                style={[s.plan, on && s.planOn]}
              >
                <Icon name={on ? "radiobox-marked" : "radiobox-blank"} size={24} color={on ? colors.brandPrimary : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={s.planName}>{planName(p)}</Text>
                  <Text style={s.planPrice}>
                    {p.product.priceString}
                    {isAnnual ? t("pay.perYear") : t("pay.perMonth")}
                  </Text>
                </View>
                {isAnnual && (
                  <View style={s.best}>
                    <Text style={s.bestText}>{t("pay.best")}</Text>
                  </View>
                )}
              </Pressable>
            );
          })
        )}
        {sub.identityError && (
          <Text style={s.error} testID="identity-error">
            {t("pay.identityError")}
          </Text>
        )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        {!sub.isSubscribed && options.length > 0 && (
          <Button
            label={t("pay.subscribe")}
            icon="crown"
            onPress={onBuy}
            loading={sub.isPurchasing}
            disabled={!sub.identityReady || !selected}
            testID="subscribe-button"
          />
        )}
        <Pressable onPress={onRestore} testID="restore-purchases-button" style={s.restore} disabled={sub.isRestoring}>
          {sub.isRestoring ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={s.restoreText}>{t("pay.restore")}</Text>}
        </Pressable>
        <Text style={s.terms}>{t("pay.terms")}</Text>
      </View>

      <Sheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        icon="crown"
        title={t("pay.confirmTitle")}
        text={`${selected ? t("pay.confirmText", { plan: planName(selected), price: selected.product.priceString }) : ""}\n${t("pay.simulated")}`}
        testID="confirm-purchase-sheet"
      >
        <View style={{ gap: 8 }}>
          <Button label={t("pay.confirm")} icon="check" onPress={doPurchase} testID="confirm-purchase-button" />
          <Button label={t("cancel")} variant="ghost" onPress={() => setConfirm(false)} testID="cancel-purchase-button" />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, gap: 12 },
  hero: { alignItems: "center", gap: 8, marginBottom: 8 },
  crown: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.brandSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: F.display, fontSize: 28, color: c.onSurface, textAlign: "center" },
  subtitle: { fontFamily: F.semi, fontSize: 15, color: c.muted, textAlign: "center" },
  features: { backgroundColor: c.surfaceSecondary, borderRadius: 24, padding: 16, gap: 12, borderWidth: 1, borderColor: c.border },
  feature: { flexDirection: "row", alignItems: "center", gap: 12 },
  featIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  featText: { fontFamily: F.bold, fontSize: 15, color: c.onSurface, flex: 1 },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 2,
    borderColor: c.border,
  },
  planOn: { borderColor: c.brandPrimary, backgroundColor: c.brandTertiary },
  planName: { fontFamily: F.display, fontSize: 18, color: c.onSurface },
  planPrice: { fontFamily: F.semi, fontSize: 14, color: c.muted },
  best: { backgroundColor: c.brandSecondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  bestText: { fontFamily: F.bold, fontSize: 12, color: c.onBrandSecondary },
  already: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 24, backgroundColor: c.surfaceTertiary },
  unavailable: { fontFamily: F.semi, fontSize: 14, color: c.muted, textAlign: "center", padding: 16 },
  error: { fontFamily: F.semi, fontSize: 13, color: c.error, textAlign: "center" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 4,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  restore: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  restoreText: { fontFamily: F.bold, fontSize: 14, color: c.brandPrimary },
  terms: { fontFamily: F.regular, fontSize: 11, color: c.muted, textAlign: "center" },
}));
