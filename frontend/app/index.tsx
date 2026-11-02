import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Pet, Upcoming } from "@/src/api";
import { ReminderBanner } from "@/src/reminder-banner";
import { ageText, daysUntil, dueLabel, fmtNum, isoToLocal } from "@/src/format";
import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { useSubscription } from "@/src/revenuecat";
import { makeStyles, useTheme } from "@/src/theme";
import { Button, EmptyState, ErrorView, F, Icon, IconButton, Loading, PetAvatar, tap } from "@/src/ui";

export default function Home() {
  useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const { isSubscribed } = useSubscription();
  const pets = useQuery({ queryKey: ["pets"], queryFn: () => api<Pet[]>("/pets") });
  const upcoming = useQuery({ queryKey: ["upcoming"], queryFn: () => api<Upcoming[]>("/upcoming") });

  const refresh = () => {
    pets.refetch();
    upcoming.refetch();
  };

  const list = pets.data ?? [];
  // Free plan: 1 pet. More pets need Premium.
  const addPet = () => router.push(list.length >= 1 && !isSubscribed ? "/paywall" : "/pet-form");

  const header = (
    <View style={[s.header, { paddingTop: insets.top + 12 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.hello}>{t("home.hello")}</Text>
        <Text style={s.title}>{t("home.title")}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <IconButton icon="cog-outline" testID="open-settings-button" onPress={() => router.push("/settings")} />
        {list.length > 0 && <IconButton icon="plus" tone="brand" testID="header-add-pet-button" onPress={addPet} />}
      </View>
    </View>
  );

  if (pets.isLoading)
    return (
      <View style={s.root}>
        {header}
        <Loading />
      </View>
    );
  if (pets.isError)
    return (
      <View style={s.root}>
        {header}
        <ErrorView message={(pets.error as Error).message} onRetry={refresh} />
      </View>
    );

  const up = upcoming.data ?? [];

  return (
    <View style={s.root}>
      {header}
      <FlatList
        testID="pets-list"
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={<RefreshControl refreshing={pets.isRefetching} onRefresh={refresh} tintColor={colors.brandPrimary} />}
        ListHeaderComponent={list.length > 0 ? <ReminderBanner /> : undefined}
        ListEmptyComponent={
          <EmptyState icon="dog-side" title={t("home.emptyTitle")} text={t("home.emptyText")}>
            <Button label={t("home.addPet")} icon="paw" onPress={() => router.push("/pet-form")} testID="empty-add-pet-button" />
          </EmptyState>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 70).springify()}>
            <Pressable
              testID={`pet-card-${item.id}`}
              onPress={() => {
                tap();
                router.push(`/pet/${item.id}`);
              }}
              style={({ pressed }) => [s.card, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
            >
              <PetAvatar photo={item.photo} size={72} species={item.species} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.petName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={s.petMeta} numberOfLines={1}>
                  {[t(`species.${item.species}`), item.breed].filter(Boolean).join(" · ")}
                </Text>
                <View style={s.tags}>
                  <View style={s.tag}>
                    <Icon name="cake-variant" size={14} color={colors.brandPrimary} />
                    <Text style={s.tagText}>{ageText(item.birth_date)}</Text>
                  </View>
                  {item.last_weight != null && (
                    <View style={[s.tag, { backgroundColor: colors.surfaceTertiary }]}>
                      <Icon name="scale-bathroom" size={14} color={colors.onSurface} />
                      <Text style={[s.tagText, { color: colors.onSurface }]}>{fmtNum(item.last_weight)} kg</Text>
                    </View>
                  )}
                </View>
              </View>
              <Icon name="chevron-right" size={26} color={colors.muted} />
            </Pressable>
          </Animated.View>
        )}
        ListFooterComponent={
          list.length > 0 ? (
            <View style={{ marginTop: 16, gap: 12 }} testID="upcoming-section">
              <Text style={s.section}>{t("home.upcoming")}</Text>
              {up.length === 0 ? (
                <View style={s.upEmpty}>
                  <Icon name="shield-check" size={24} color={colors.success} />
                  <Text style={s.upEmptyText}>{t("home.noUpcoming")}</Text>
                </View>
              ) : (
                up.map((u) => {
                  const late = daysUntil(u.next_date) < 0;
                  return (
                    <Pressable
                      key={u.record_id}
                      testID={`upcoming-${u.record_id}`}
                      onPress={() => router.push(`/pet/${u.pet_id}/vaccine`)}
                      style={s.upRow}
                    >
                      <View style={[s.upIcon, { backgroundColor: late ? colors.error : colors.brandTertiary }]}>
                        <Icon name="needle" size={20} color={late ? colors.onError : colors.brandPrimary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.upTitle}>
                          {u.name} · {u.pet_name}
                        </Text>
                        <Text style={s.upSub}>{isoToLocal(u.next_date)}</Text>
                      </View>
                      <View style={[s.due, { backgroundColor: late ? colors.brandTertiary : colors.surfaceTertiary }]}>
                        <Text style={[s.dueText, { color: late ? colors.error : colors.onSurface }]}>{dueLabel(u.next_date)}</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, paddingBottom: 16 },
  hello: { fontFamily: F.semi, fontSize: 15, color: c.muted },
  title: { fontFamily: F.display, fontSize: 32, color: c.onSurface },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 24,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: c.onSurface,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  petName: { fontFamily: F.display, fontSize: 20, color: c.onSurface },
  petMeta: { fontFamily: F.semi, fontSize: 13, color: c.muted },
  tags: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: c.brandTertiary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { fontFamily: F.bold, fontSize: 12, color: c.onBrandTertiary },
  section: { fontFamily: F.display, fontSize: 20, color: c.onSurface },
  upEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  upEmptyText: { fontFamily: F.semi, fontSize: 14, color: c.muted, flex: 1 },
  upRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  upIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  upTitle: { fontFamily: F.bold, fontSize: 15, color: c.onSurface },
  upSub: { fontFamily: F.semi, fontSize: 13, color: c.muted },
  due: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  dueText: { fontFamily: F.bold, fontSize: 12 },
}));
