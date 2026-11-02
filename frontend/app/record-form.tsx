import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, fileUrl, PetRecord, uploadFile } from "@/src/api";
import { fmtNum, isoToLocal, localToIso, maskDate, maskTime, nowTime, parseNum, todayLocal, validTime } from "@/src/format";
import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { PickedFile, usePhotoPicker } from "@/src/photo-picker";
import { FieldDef, fieldLabel, RecordType, TYPE_CONFIG } from "@/src/records";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { Button, ChoicePills, ErrorView, F, Field, Icon, Loading, ScreenHeader, Sheet } from "@/src/ui";

type Values = Record<string, any>;
type Doc = { path: string; name: string };

function initialValues(fields: FieldDef[], rec?: PetRecord): Values {
  const v: Values = {};
  for (const f of fields) {
    const raw = rec?.data?.[f.key];
    if (f.kind === "bool") v[f.key] = !!raw;
    else if (f.kind === "date") v[f.key] = raw ? isoToLocal(raw) : "";
    else if (f.kind === "number") v[f.key] = raw != null ? fmtNum(raw) : "";
    else v[f.key] = raw ?? "";
  }
  if (rec) {
    const [d, tm] = rec.date.split("T");
    v.__date = isoToLocal(d);
    v.__time = tm ? tm.slice(0, 5) : "";
  } else {
    v.__date = todayLocal();
    v.__time = nowTime();
  }
  return v;
}

export default function RecordForm() {
  useLang();
  const { petId, type, id } = useLocalSearchParams<{ petId: string; type: RecordType; id?: string }>();
  const cfg = TYPE_CONFIG[type as RecordType];
  const editing = !!id;
  const q = useQuery({ queryKey: ["record", id], queryFn: () => api<PetRecord>(`/records/${id}`), enabled: editing });

  if (!cfg) return <ErrorView message={t("notFound")} onRetry={() => {}} />;
  if (editing && q.isLoading)
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title={t(`type.${type}`)} />
        <Loading />
      </View>
    );
  if (editing && (q.isError || !q.data)) return <ErrorView message={t("notFound")} onRetry={() => q.refetch()} />;
  return <FormBody petId={petId} type={type as RecordType} record={q.data} />;
}

function FormBody({ petId, type, record }: { petId: string; type: RecordType; record?: PetRecord }) {
  const cfg = TYPE_CONFIG[type];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [values, setValues] = useState<Values>(() => initialValues(cfg.fields, record));
  const [photos, setPhotos] = useState<string[]>(record?.photos ?? []);
  const [docs, setDocs] = useState<Doc[]>(record?.docs ?? []);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (k: string, v: any) => setValues((p) => ({ ...p, [k]: v }));

  const onPicked = async (file: PickedFile) => {
    setUploading(true);
    try {
      const path = await uploadFile(file);
      if (file.mimeType === "application/pdf") setDocs((d) => [...d, { path, name: file.name || "document.pdf" }]);
      else setPhotos((p) => [...p, path]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  };
  const picker = usePhotoPicker(onPicked, t("perm.reasonRecord"));

  const save = async () => {
    const errs: Record<string, string> = {};
    const fmt = t("datePh");
    const dateIso = localToIso(values.__date);
    if (!dateIso) errs.__date = t("invalidDate", { fmt });
    if (cfg.withTime && values.__time && !validTime(values.__time)) errs.__time = t("invalidTime");
    const data: Values = {};
    for (const f of cfg.fields) {
      if (f.showIf && !f.showIf(values)) continue;
      const v = values[f.key];
      if (f.kind === "bool") data[f.key] = !!v;
      else if (f.kind === "date") {
        if (v) {
          const iso = localToIso(v);
          if (!iso) errs[f.key] = t("invalidDate", { fmt });
          else data[f.key] = iso;
        }
      } else if (f.kind === "number") {
        if (v) {
          const n = parseNum(v);
          if (n === null) errs[f.key] = t("invalidNumber");
          else data[f.key] = n;
        } else if (f.required) errs[f.key] = t("required");
      } else {
        const tx = String(v ?? "").trim();
        if (f.required && !tx) errs[f.key] = t("required");
        if (tx) data[f.key] = tx;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const date = cfg.withTime && values.__time ? `${dateIso}T${values.__time}` : dateIso!;
    setSaving(true);
    try {
      const body = { type, date, data, photos, docs };
      if (record) await api(`/records/${record.id}`, { method: "PUT", body });
      else await api(`/pets/${petId}/records`, { method: "POST", body });
      await qc.invalidateQueries();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(record ? t("record.updated") : t("record.saved"));
      router.back();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!record) return;
    try {
      await api(`/records/${record.id}`, { method: "DELETE" });
      await qc.invalidateQueries();
      setConfirmDelete(false);
      toast(t("record.deleted"));
      router.back();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const renderField = (f: FieldDef) => {
    if (f.showIf && !f.showIf(values)) return null;
    const tid = `field-${f.key}`;
    const label = fieldLabel(type, f.key);
    if (f.kind === "bool")
      return (
        <ChoicePills
          key={f.key}
          label={label}
          testID={tid}
          value={values[f.key] ? "yes" : "no"}
          onChange={(v) => set(f.key, v === "yes")}
          options={[
            { label: t("yes"), value: "yes" },
            { label: t("no"), value: "no" },
          ]}
        />
      );
    if (f.kind === "choice")
      return (
        <ChoicePills
          key={f.key}
          label={label}
          testID={tid}
          value={values[f.key]}
          onChange={(v) => set(f.key, v)}
          options={(f.options ?? []).map((o) => ({ label: t(`opt.${o}`), value: o }))}
        />
      );
    return (
      <Field
        key={f.key}
        testID={tid}
        label={label + (f.required ? " *" : "")}
        placeholder={f.kind === "date" ? t("datePh") : f.ph ? t(`${type}.${f.key}.ph`) : t("optional")}
        value={values[f.key]}
        suffix={f.suffix}
        error={errors[f.key]}
        multiline={f.kind === "multiline"}
        keyboardType={f.kind === "number" ? "decimal-pad" : f.kind === "date" ? "number-pad" : "default"}
        onChangeText={(tx) => set(f.key, f.kind === "date" ? maskDate(tx) : tx)}
      />
    );
  };

  return (
    <View style={s.root}>
      <ScreenHeader
        title={record ? t("record.edit") : t("record.new")}
        subtitle={t(`type.${type}`)}
        right={
          record ? (
            <Pressable testID="delete-record-button" onPress={() => setConfirmDelete(true)} style={s.delBtn} hitSlop={6}>
              <Icon name="trash-can-outline" size={22} color={colors.error} />
            </Pressable>
          ) : undefined
        }
      />
      <KeyboardAwareScrollView bottomOffset={110} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}>
        <View style={s.dateRow}>
          <View style={{ flex: 1.4 }}>
            <Field
              testID="field-date"
              label={t(`date.${type}`) + " *"}
              placeholder={t("datePh")}
              keyboardType="number-pad"
              value={values.__date}
              error={errors.__date}
              onChangeText={(tx) => set("__date", maskDate(tx))}
            />
          </View>
          {cfg.withTime && (
            <View style={{ flex: 1 }}>
              <Field
                testID="field-time"
                label={t("time")}
                placeholder="HH:MM"
                keyboardType="number-pad"
                value={values.__time}
                error={errors.__time}
                onChangeText={(tx) => set("__time", maskTime(tx))}
              />
            </View>
          )}
        </View>
        <Pressable
          testID="set-now-button"
          onPress={() => {
            set("__date", todayLocal());
            set("__time", nowTime());
          }}
          style={s.nowChip}
        >
          <Icon name="clock-outline" size={16} color={colors.onBrandTertiary} />
          <Text style={s.nowText}>{cfg.withTime ? t("now") : t("today")}</Text>
        </Pressable>

        {cfg.fields.map(renderField)}

        {cfg.photos && (
          <View style={{ gap: 8 }}>
            <Text style={s.label}>{t(`${type}.photos`)}</Text>
            <Text style={s.hint}>{t(`${type}.photos.hint`)}</Text>
            <View style={s.photoGrid}>
              {photos.map((p, i) => (
                <View key={p} testID={`photo-${i}`}>
                  <Image source={{ uri: fileUrl(p) }} style={s.photo} contentFit="cover" />
                  <Pressable testID={`remove-photo-${i}`} onPress={() => setPhotos((arr) => arr.filter((x) => x !== p))} style={s.photoRemove} hitSlop={8}>
                    <Icon name="close" size={16} color={colors.onSurfaceInverse} />
                  </Pressable>
                </View>
              ))}
              {docs.map((d, i) => (
                <View key={d.path} testID={`doc-${i}`}>
                  <Pressable onPress={() => Linking.openURL(fileUrl(d.path))} style={[s.photo, s.docTile]} testID={`open-doc-${i}`}>
                    <Icon name="file-pdf-box" size={32} color={colors.brandPrimary} />
                    <Text style={s.docName} numberOfLines={2}>
                      {d.name}
                    </Text>
                  </Pressable>
                  <Pressable testID={`remove-doc-${i}`} onPress={() => setDocs((arr) => arr.filter((x) => x.path !== d.path))} style={s.photoRemove} hitSlop={8}>
                    <Icon name="close" size={16} color={colors.onSurfaceInverse} />
                  </Pressable>
                </View>
              ))}
              {uploading && (
                <View style={[s.photo, s.photoAdd]}>
                  <ActivityIndicator color={colors.brandPrimary} />
                </View>
              )}
              <Pressable testID="take-photo-button" onPress={picker.takePhoto} style={[s.photo, s.photoAdd]}>
                <Icon name="camera-plus" size={28} color={colors.brandPrimary} />
                <Text style={s.photoAddText}>{t("camera")}</Text>
              </Pressable>
              <Pressable testID="pick-photo-button" onPress={picker.pickFromGallery} style={[s.photo, s.photoAdd]}>
                <Icon name="image-plus" size={28} color={colors.brandPrimary} />
                <Text style={s.photoAddText}>{t("gallery")}</Text>
              </Pressable>
              {cfg.docs && (
                <Pressable testID="pick-pdf-button" onPress={picker.pickPdf} style={[s.photo, s.photoAdd]}>
                  <Icon name="file-upload-outline" size={28} color={colors.brandPrimary} />
                  <Text style={s.photoAddText}>{t("addPdf")}</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={s.stickyWrap}>
        <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Button label={t("save")} icon="check" onPress={save} loading={saving} disabled={uploading} testID="save-record-button" />
        </View>
      </KeyboardStickyView>

      {picker.sheet}
      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        icon="trash-can-outline"
        title={t("record.deleteTitle")}
        text={t("record.deleteText")}
        testID="confirm-delete-sheet"
      >
        <View style={{ gap: 8 }}>
          <Button label={t("delete")} variant="danger" icon="trash-can-outline" onPress={remove} testID="confirm-delete-button" />
          <Button label={t("cancel")} variant="ghost" onPress={() => setConfirmDelete(false)} testID="cancel-delete-button" />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 20 },
  dateRow: { flexDirection: "row", gap: 12 },
  nowChip: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    backgroundColor: c.brandTertiary,
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 36,
    marginTop: -8,
  },
  nowText: { fontFamily: F.bold, fontSize: 13, color: c.onBrandTertiary },
  label: { fontFamily: F.bold, fontSize: 14, color: c.onSurface },
  hint: { fontFamily: F.semi, fontSize: 13, color: c.muted, marginTop: -4 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  photo: { width: 96, height: 96, borderRadius: 16, backgroundColor: c.surfaceTertiary },
  docTile: { alignItems: "center", justifyContent: "center", padding: 6, gap: 2 },
  docName: { fontFamily: F.semi, fontSize: 10, color: c.onSurface, textAlign: "center" },
  photoAdd: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: c.brandPrimary,
    gap: 4,
  },
  photoAddText: { fontFamily: F.bold, fontSize: 12, color: c.brandPrimary },
  photoRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: c.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
  },
  delBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  stickyWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
}));
