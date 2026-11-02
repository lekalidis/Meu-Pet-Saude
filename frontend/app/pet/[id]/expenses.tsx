import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Pet, PetRecord } from "@/src/api";
import { fmtMoney, isoToLocal, todayIso } from "@/src/format";
import { getLang, t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { RECORD_TYPES, TYPE_CONFIG } from "@/src/records";
import { makeStyles, useTheme } from "@/src/theme";
import { EmptyState, ErrorView, F, Icon, Loading, ScreenHeader } from "@/src/ui";

function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat(getLang(), { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  } catch {
    return ym;
  }
}

export default function Expenses() {
  useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const pet = useQuery({ queryKey: ["pet", id], queryFn: () => api<Pet>(`/pets/${id}`) });
  const q = useQuery({ queryKey: ["records", id, "all"], queryFn: () => api<PetRecord[]>(`/pets/${id}/records`) });

  const items = (q.data ?? []).filter((r) => Number(r.data.cost) > 0);
  const today = todayIso();
  const sum = (list: PetRecord[]) => list.reduce((a, r) => a + Number(r.data.cost), 0);
  const month = sum(items.filter((r) => r.date.slice(0, 7) === today.slice(0, 7)));
  const year = sum(items.filter((r) => r.date.slice(0, 4) === today.slice(0, 4)));
  const byType = RECORD_TYPES.map((ty) => ({ ty, total: sum(items.filter((r) => r.type === ty && r.date.slice(0, 4) === today.slice(0, 4))) })).filter((x) => x.total > 0);
  const months = [...new Set(items.map((r) => r.date.slice(0, 7)))].sort().reverse();

  return (
    <View style={s.root}>
      <ScreenHeader title={t("exp.title")} subtitle={pet.data?.name} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorView message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="cash-multiple" title={t("exp.title")} text={t("exp.empty")} />
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.totals}>
            <View style={[s.total, { backgroundColor: colors.brandPrimary }]} testID="expense-month-total">
              <Text style={[s.totalLabel, { color: colors.onBrandPrimary }]}>{t("exp.thisMonth")}</Text>
              <Text style={[s.totalValue, { color: colors.onBrandPrimary }]}>{fmtMoney(month)}</Text>
            </View>
            <View style={s.total} testID="expense-year-total">
              <Text style={s.totalLabel}>{t("exp.thisYear")}</Text>
              <Text style={s.totalValue}>{fmtMoney(year)}</Text>
            </View>
          </View>
          {byType.length > 0 && (
            <View style={s.card}>
              {byType.map((x) => (
                <View key={x.ty} style={s.row}>
                  <View style={s.icon}>
                    <Icon name={TYPE_CONFIG[x.ty].icon} size={18} color={colors[TYPE_CONFIG[x.ty].tint]} />
                  </View>
                  <Text style={s.rowTitle}>{t(`type.${x.ty}`)}</Text>
                  <View style={s.barWrap}>
                    <View style={[s.bar, { width: `${Math.max(6, (x.total / year) * 100)}%` }]} />
                  </View>
                  <Text style={s.rowValue}>{fmtMoney(x.total)}</Text>
                </View>
              ))}
            </View>
          )}
          {months.map((ym) => {
            const list = items.filter((r) => r.date.slice(0, 7) === ym);
            return (
              <View key={ym} style={{ gap: 8 }} testID={`expense-month-${ym}`}>
                <View style={s.monthHead}>
                  <Text style={s.month}>{monthName(ym)}</Text>
                  <Text style={s.monthTotal}>{fmtMoney(sum(list))}</Text>
                </View>
                <View style={s.card}>
                  {list.map((r) => (
                    <View key={r.id} style={s.row}>
                      <View style={s.icon}>
                        <Icon name={TYPE_CONFIG[r.type].icon} size={18} color={colors[TYPE_CONFIG[r.type].tint]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowTitle} numberOfLines={1}>
                          {TYPE_CONFIG[r.type].title(r)}
                        </Text>
                        <Text style={s.rowSub}>{isoToLocal(r.date.slice(0, 10))}</Text>
                      </View>
                      <Text style={s.rowValue}>{fmtMoney(Number(r.data.cost))}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  totals: { flexDirection: "row", gap: 12 },
  total: { flex: 1, borderRadius: 24, padding: 16, gap: 4, backgroundColor: c.surfaceTertiary },
  totalLabel: { fontFamily: F.semi, fontSize: 13, color: c.muted },
  totalValue: { fontFamily: F.display, fontSize: 22, color: c.onSurface },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 24, padding: 12, gap: 12, borderWidth: 1, borderColor: c.border },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: F.bold, fontSize: 14, color: c.onSurface, flexShrink: 1 },
  rowSub: { fontFamily: F.semi, fontSize: 12, color: c.muted },
  rowValue: { fontFamily: F.bold, fontSize: 14, color: c.onSurface },
  barWrap: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceTertiary, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4, backgroundColor: c.brandPrimary },
  monthHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4 },
  month: { fontFamily: F.display, fontSize: 17, color: c.onSurface, textTransform: "capitalize" },
  monthTotal: { fontFamily: F.bold, fontSize: 15, color: c.brandPrimary },
}));
