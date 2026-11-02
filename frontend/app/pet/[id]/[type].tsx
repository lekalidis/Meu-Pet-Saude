import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { LineChart } from "react-native-gifted-charts";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, fileUrl, Pet, PetRecord } from "@/src/api";
import { daysUntil, dueLabel, fmtNum, shortDate } from "@/src/format";
import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { RecordType, TYPE_CONFIG } from "@/src/records";
import { makeStyles, useTheme } from "@/src/theme";
import { Button, EmptyState, ErrorView, F, Icon, Loading, ScreenHeader, tap } from "@/src/ui";

function WeightChart({ records }: { records: PetRecord[] }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const s = useStyles();
  const pts = [...records].sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  if (pts.length < 2)
    return (
      <View style={s.chartCard}>
        <Text style={s.chartHint}>{t("list.chartHint")}</Text>
      </View>
    );
  const values = pts.map((r) => Number(r.data.weight));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const offset = Math.max(0, Math.floor(min - (max - min) * 0.3 - 1));
  const chartW = Math.min(width, 600) - 32 - 32 - 40;
  return (
    <View style={s.chartCard} testID="weight-chart">
      <Text style={s.chartTitle}>{t("list.chartTitle")}</Text>
      <LineChart
        data={pts.map((r) => ({
          value: Number(r.data.weight) - offset,
          label: shortDate(r.date),
          dataPointText: fmtNum(r.data.weight),
        }))}
        width={chartW}
        height={170}
        spacing={Math.max(36, chartW / (pts.length - 0.5))}
        initialSpacing={16}
        color={colors.brandPrimary}
        thickness={3}
        curved
        areaChart
        startFillColor={colors.brandPrimary}
        endFillColor={colors.surfaceSecondary}
        startOpacity={0.35}
        endOpacity={0.02}
        dataPointsColor={colors.brandPrimary}
        dataPointsRadius={5}
        textColor={colors.onSurface}
        textFontSize={11}
        textShiftY={-8}
        textShiftX={-6}
        yAxisColor={colors.border}
        xAxisColor={colors.border}
        rulesColor={colors.divider}
        yAxisTextStyle={{ color: colors.muted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.muted, fontSize: 10 }}
        yAxisLabelWidth={32}
        formatYLabel={(v: string) => String(Math.round(Number(v) + offset))}
        noOfSections={4}
      />
    </View>
  );
}

export default function RecordList() {
  useLang();
  const { id, type } = useLocalSearchParams<{ id: string; type: RecordType }>();
  const cfg = TYPE_CONFIG[type as RecordType];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const pet = useQuery({ queryKey: ["pet", id], queryFn: () => api<Pet>(`/pets/${id}`) });
  const q = useQuery({
    queryKey: ["records", id, type],
    queryFn: () => api<PetRecord[]>(`/pets/${id}/records?type=${type}`),
    enabled: !!cfg,
  });

  if (!cfg) return <ErrorView message={t("notFound")} onRetry={() => router.back()} />;

  return (
    <View style={s.root}>
      <ScreenHeader title={t(`type.${type}`)} subtitle={pet.data?.name} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorView message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          testID="records-list"
          data={q.data ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, gap: 12 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.brandPrimary} />}
          ListHeaderComponent={type === "weight" && (q.data?.length ?? 0) > 0 ? <WeightChart records={q.data ?? []} /> : undefined}
          ListEmptyComponent={<EmptyState icon={cfg.icon} title={t("list.emptyTitle")} text={t(`empty.${type}`)} />}
          renderItem={({ item, index }) => {
            const next = type === "vaccine" ? (item.data.next_date as string | undefined) : undefined;
            const late = next ? daysUntil(next) < 0 : false;
            return (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 50)}>
                <Pressable
                  testID={`record-${item.id}`}
                  onPress={() => {
                    tap();
                    router.push(`/record-form?petId=${id}&type=${type}&id=${item.id}`);
                  }}
                  style={({ pressed }) => [s.card, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
                >
                  <View style={s.row}>
                    <View style={s.icon}>
                      <Icon name={cfg.icon} size={22} color={colors[cfg.tint]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.title} numberOfLines={2}>
                        {cfg.title(item)}
                      </Text>
                      <Text style={s.sub} numberOfLines={2}>
                        {cfg.subtitle(item)}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={22} color={colors.muted} />
                  </View>
                  {(next || (type === "illness" && item.data.fever)) && (
                    <View style={s.badges}>
                      {next && (
                        <View style={[s.badge, { backgroundColor: late ? colors.error : colors.brandTertiary }]}>
                          <Text style={[s.badgeText, { color: late ? colors.onError : colors.onBrandTertiary }]}>
                            {t("list.booster", { when: dueLabel(next) })}
                          </Text>
                        </View>
                      )}
                      {type === "illness" && item.data.fever && (
                        <View style={[s.badge, { backgroundColor: colors.error }]}>
                          <Icon name="thermometer-alert" size={14} color={colors.onError} />
                          <Text style={[s.badgeText, { color: colors.onError }]}>{t("list.fever")}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {(item.photos?.length > 0 || item.docs?.length > 0) && (
                    <View style={s.photos}>
                      {item.photos.slice(0, 4).map((p) => (
                        <Image key={p} source={{ uri: fileUrl(p) }} style={s.thumb} contentFit="cover" />
                      ))}
                      {(item.docs ?? []).slice(0, 3).map((d) => (
                        <View key={d.path} style={[s.thumb, s.pdfThumb]}>
                          <Icon name="file-pdf-box" size={28} color={colors.brandPrimary} />
                          <Text style={s.pdfText}>{t("pdf")}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Pressable>
              </Animated.View>
            );
          }}
        />
      )}
      <View style={[s.fab, { bottom: insets.bottom + 16 }]}>
        <Button
          label={t("list.add")}
          icon="plus"
          onPress={() => router.push(`/record-form?petId=${id}&type=${type}`)}
          testID="add-record-button"
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 24,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: c.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: F.bold, fontSize: 16, color: c.onSurface },
  sub: { fontFamily: F.semi, fontSize: 13, color: c.muted, marginTop: 2 },
  badges: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: F.bold, fontSize: 12 },
  photos: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: c.surfaceTertiary },
  pdfThumb: { alignItems: "center", justifyContent: "center" },
  pdfText: { fontFamily: F.bold, fontSize: 10, color: c.brandPrimary },
  chartCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 4,
    overflow: "hidden",
  },
  chartTitle: { fontFamily: F.display, fontSize: 16, color: c.onSurface, marginBottom: 12 },
  chartHint: { fontFamily: F.semi, fontSize: 14, color: c.muted },
  fab: { position: "absolute", left: 16, right: 16 },
}));
