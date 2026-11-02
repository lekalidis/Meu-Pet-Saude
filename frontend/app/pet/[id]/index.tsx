import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Pet } from "@/src/api";
import { ageText, daysUntil, dueLabel, fmtNum, isoToLocal, shortDate } from "@/src/format";
import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { PREMIUM_TYPES, RECORD_TYPES, TYPE_CONFIG } from "@/src/records";
import { useSubscription } from "@/src/revenuecat";
import { makeStyles, useTheme } from "@/src/theme";
import { Button, ErrorView, F, Icon, IconButton, Loading, PetAvatar, tap } from "@/src/ui";

export default function PetDashboard() {
  useLang();
  const { isSubscribed } = useSubscription();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ["pet", id], queryFn: () => api<Pet>(`/pets/${id}`) });

  const topBar = (
    <View style={[s.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <IconButton icon="arrow-left" testID="pet-back-button" onPress={() => router.back()} />
      {q.data && <IconButton icon="pencil" testID="pet-edit-button" onPress={() => router.push(`/pet-form?id=${id}`)} />}
    </View>
  );

  if (q.isLoading)
    return (
      <View style={s.root}>
        {topBar}
        <Loading />
      </View>
    );
  if (q.isError || !q.data)
    return (
      <View style={[s.root, { paddingTop: insets.top + 60 }]}>
        {topBar}
        <ErrorView message={(q.error as Error)?.message ?? t("notFound")} onRetry={() => q.refetch()} />
      </View>
    );

  const pet = q.data;
  const next = pet.next_vaccine;

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.brandPrimary} />}
      >
        <View style={[s.hero, { paddingTop: insets.top + 64 }]}>
          <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
          <PetAvatar photo={pet.photo} size={132} species={pet.species} />
          <Text style={s.name} testID="pet-name">
            {pet.name}
          </Text>
          <Text style={s.meta}>{[t(`species.${pet.species}`), pet.breed, pet.sex ? t(`sex.${pet.sex}`) : ""].filter(Boolean).join(" · ")}</Text>
        </View>

        <View style={s.stats}>
          <View style={s.stat} testID="stat-age">
            <Icon name="cake-variant" size={22} color={colors.brandPrimary} />
            <Text style={s.statValue} numberOfLines={2}>
              {ageText(pet.birth_date)}
            </Text>
            <Text style={s.statLabel}>{pet.birth_date ? isoToLocal(pet.birth_date) : t("pet.birth")}</Text>
          </View>
          <View style={s.stat} testID="stat-weight">
            <Icon name="scale-bathroom" size={22} color={colors.brandPrimary} />
            <Text style={s.statValue}>{pet.last_weight != null ? `${fmtNum(pet.last_weight)} kg` : "—"}</Text>
            <Text style={s.statLabel}>{t("pet.weight")}</Text>
          </View>
          <View style={s.stat} testID="stat-next-vaccine">
            <Icon name="needle" size={22} color={colors.brandPrimary} />
            <Text style={s.statValue}>{next ? shortDate(next) : "—"}</Text>
            <Text style={s.statLabel}>{next ? dueLabel(next) : t("pet.nextVaccine")}</Text>
          </View>
        </View>

        {!!pet.overdue_vaccines && (
          <Pressable style={s.alert} testID="overdue-alert" onPress={() => router.push(`/pet/${id}/vaccine`)}>
            <Icon name="alert-circle" size={24} color={colors.onError} />
            <Text style={s.alertText}>{t("pet.overdue", { n: pet.overdue_vaccines })}</Text>
            <Icon name="chevron-right" size={22} color={colors.onError} />
          </Pressable>
        )}
        {next && daysUntil(next) <= 14 && !pet.overdue_vaccines && (
          <View style={[s.alert, { backgroundColor: colors.brandSecondary }]} testID="soon-alert">
            <Icon name="bell-ring" size={22} color={colors.onBrandSecondary} />
            <Text style={[s.alertText, { color: colors.onBrandSecondary }]}>{t("pet.soon", { when: dueLabel(next) })}</Text>
          </View>
        )}

        <Text style={s.section}>{t("pet.healthOf", { name: pet.name })}</Text>
        <View style={s.quickRow}>
          <Pressable testID="open-vaccine-card-button" onPress={() => router.push(`/pet/${id}/vaccine-card`)} style={s.quickChip}>
            <Icon name="card-account-details-star" size={20} color={colors.brandPrimary} />
            <Text style={s.quickChipText}>{t("card.cta")}</Text>
          </Pressable>
          <Pressable testID="open-expenses-button" onPress={() => router.push(`/pet/${id}/expenses`)} style={s.quickChip}>
            <Icon name="cash-multiple" size={20} color={colors.brandPrimary} />
            <Text style={s.quickChipText}>{t("exp.cta")}</Text>
          </Pressable>
        </View>
        <View style={s.grid}>
          {RECORD_TYPES.map((ty, i) => {
            const cfg = TYPE_CONFIG[ty];
            const locked = PREMIUM_TYPES.includes(ty) && !isSubscribed;
            const n = pet.counts?.[ty] ?? 0;
            return (
              <Animated.View key={ty} entering={FadeInDown.delay(i * 60).springify()} style={s.moduleWrap}>
                <Pressable
                  testID={`module-${ty}`}
                  onPress={() => {
                    tap();
                    router.push(locked ? "/paywall" : `/pet/${id}/${ty}`);
                  }}
                  style={({ pressed }) => [s.module, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <View style={s.moduleIcon}>
                      <Icon name={cfg.icon} size={26} color={colors[cfg.tint]} />
                    </View>
                    {locked && (
                      <View style={s.lock} testID={`premium-badge-${ty}`}>
                        <Icon name="crown" size={14} color={colors.onBrandSecondary} />
                        <Text style={s.lockText}>{t("premium")}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.moduleTitle}>{t(`type.${ty}`)}</Text>
                  <Text style={s.moduleCount}>{t("records", { n })}</Text>
                </Pressable>
              </Animated.View>
            );
          })}
          <View style={s.moduleWrap}>
            <Pressable
              testID="quick-illness-button"
              onPress={() => {
                tap();
                router.push(`/record-form?petId=${id}&type=illness`);
              }}
              style={({ pressed }) => [s.module, s.quick, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
            >
              <View style={[s.moduleIcon, { backgroundColor: colors.surfaceSecondary }]}>
                <Icon name="plus" size={26} color={colors.brandPrimary} />
              </View>
              <Text style={[s.moduleTitle, { color: colors.onBrandPrimary }]}>{t("pet.sick")}</Text>
              <Text style={[s.moduleCount, { color: colors.onBrandPrimary }]}>{t("pet.registerNow")}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {topBar}

      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={t("pet.reportCta")}
          icon={isSubscribed ? "file-pdf-box" : "crown"}
          onPress={() => router.push(isSubscribed ? `/pet/${id}/report` : "/paywall")}
          testID="open-report-button"
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  hero: { alignItems: "center", paddingBottom: 16, paddingHorizontal: 16, gap: 4 },
  name: { fontFamily: F.display, fontSize: 30, color: c.onSurface, marginTop: 12 },
  meta: { fontFamily: F.semi, fontSize: 14, color: c.muted },
  stats: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 8 },
  stat: {
    flex: 1,
    backgroundColor: c.surfaceSecondary,
    borderRadius: 16,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: c.border,
  },
  statValue: { fontFamily: F.bold, fontSize: 15, color: c.onSurface },
  statLabel: { fontFamily: F.semi, fontSize: 12, color: c.muted },
  alert: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: c.error,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  alertText: { flex: 1, fontFamily: F.bold, fontSize: 14, color: c.onError },
  section: { fontFamily: F.display, fontSize: 20, color: c.onSurface, marginTop: 24, marginBottom: 12, paddingHorizontal: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12 },
  moduleWrap: { width: "50%", padding: 4 },
  module: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 24,
    padding: 16,
    gap: 4,
    minHeight: 130,
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: c.onSurface,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  quick: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  moduleIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  moduleTitle: { fontFamily: F.display, fontSize: 17, color: c.onSurface },
  moduleCount: { fontFamily: F.semi, fontSize: 13, color: c.muted },
  lock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: c.brandSecondary,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lockText: { fontFamily: F.bold, fontSize: 11, color: c.onBrandSecondary },
  quickRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  quickChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: c.brandTertiary,
  },
  quickChipText: { fontFamily: F.bold, fontSize: 14, color: c.onBrandTertiary },
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
