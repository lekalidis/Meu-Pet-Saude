import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Pet, uploadFile } from "@/src/api";
import { isoToLocal, localToIso, maskDate } from "@/src/format";
import { t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { usePhotoPicker } from "@/src/photo-picker";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { Button, ChoicePills, F, Field, Icon, Loading, PetAvatar, ScreenHeader, Sheet } from "@/src/ui";

export default function PetFormScreen() {
  useLang();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useQuery({ queryKey: ["pet", id], queryFn: () => api<Pet>(`/pets/${id}`), enabled: !!id });
  if (id && q.isLoading)
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title={t("petForm.edit")} />
        <Loading />
      </View>
    );
  return <PetForm pet={q.data} />;
}

function PetForm({ pet }: { pet?: Pet }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: pet?.name ?? "",
    species: pet?.species ?? "dog",
    breed: pet?.breed ?? "",
    sex: pet?.sex ?? "",
    birth: pet?.birth_date ? isoToLocal(pet.birth_date) : "",
    color: pet?.color ?? "",
    microchip: pet?.microchip ?? "",
    notes: pet?.notes ?? "",
  });
  const [photo, setPhoto] = useState<string | null>(pet?.photo ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((p) => ({ ...p, [k]: val }));

  const picker = usePhotoPicker(async (file) => {
    setUploading(true);
    try {
      setPhoto(await uploadFile(file));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }, t("perm.reasonPet"));

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!v.name.trim()) errs.name = t("petForm.nameRequired");
    const birth = v.birth ? localToIso(v.birth) : null;
    if (v.birth && !birth) errs.birth = t("invalidDate", { fmt: t("datePh") });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body = {
      name: v.name.trim(),
      species: v.species || "other",
      breed: v.breed.trim(),
      sex: v.sex,
      birth_date: birth,
      color: v.color.trim(),
      microchip: v.microchip.trim(),
      notes: v.notes.trim(),
      photo,
    };
    setSaving(true);
    try {
      if (pet) {
        await api(`/pets/${pet.id}`, { method: "PUT", body });
        await qc.invalidateQueries();
        toast(t("petForm.updated"));
        router.back();
      } else {
        const created = await api<Pet>("/pets", { method: "POST", body });
        await qc.invalidateQueries();
        toast(t("petForm.created", { name: created.name }));
        router.replace(`/pet/${created.id}`);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!pet) return;
    try {
      await api(`/pets/${pet.id}`, { method: "DELETE" });
      qc.removeQueries({ queryKey: ["pet", pet.id] });
      await qc.invalidateQueries({ queryKey: ["pets"] });
      await qc.invalidateQueries({ queryKey: ["upcoming"] });
      setConfirmDelete(false);
      toast(t("petForm.removed"));
      router.dismissAll();
      router.replace("/");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <View style={s.root}>
      <ScreenHeader
        title={pet ? t("petForm.edit") : t("petForm.new")}
        right={
          pet ? (
            <Pressable testID="delete-pet-button" onPress={() => setConfirmDelete(true)} style={s.delBtn} hitSlop={6}>
              <Icon name="trash-can-outline" size={22} color={colors.error} />
            </Pressable>
          ) : undefined
        }
      />
      <KeyboardAwareScrollView bottomOffset={110} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}>
        <View style={s.photoBox}>
          <View>
            <PetAvatar photo={photo} size={112} species={v.species} />
            {uploading && (
              <View style={s.photoLoading}>
                <ActivityIndicator color={colors.onBrandPrimary} />
              </View>
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable testID="pet-photo-camera-button" onPress={picker.takePhoto} style={s.photoBtn}>
              <Icon name="camera" size={18} color={colors.onBrandTertiary} />
              <Text style={s.photoBtnText}>{t("camera")}</Text>
            </Pressable>
            <Pressable testID="pet-photo-gallery-button" onPress={picker.pickFromGallery} style={s.photoBtn}>
              <Icon name="image" size={18} color={colors.onBrandTertiary} />
              <Text style={s.photoBtnText}>{t("gallery")}</Text>
            </Pressable>
          </View>
        </View>

        <Field testID="pet-name-input" label={`${t("petForm.name")} *`} placeholder={t("petForm.namePh")} value={v.name} error={errors.name} onChangeText={(x) => set("name", x)} />
        <ChoicePills
          label={t("petForm.species")}
          testID="pet-species"
          value={v.species}
          onChange={(x) => set("species", x)}
          options={["dog", "cat", "other"].map((o) => ({ label: t(`species.${o}`), value: o }))}
        />
        <Field testID="pet-breed-input" label={t("petForm.breed")} placeholder={t("petForm.breedPh")} value={v.breed} onChangeText={(x) => set("breed", x)} />
        <ChoicePills
          label={t("petForm.sex")}
          testID="pet-sex"
          value={v.sex}
          onChange={(x) => set("sex", x)}
          options={["male", "female"].map((o) => ({ label: t(`sex.${o}`), value: o }))}
        />
        <Field
          testID="pet-birth-input"
          label={t("petForm.birth")}
          placeholder={t("datePh")}
          keyboardType="number-pad"
          value={v.birth}
          error={errors.birth}
          onChangeText={(x) => set("birth", maskDate(x))}
        />
        <Field testID="pet-color-input" label={t("petForm.color")} placeholder={t("optional")} value={v.color} onChangeText={(x) => set("color", x)} />
        <Field testID="pet-microchip-input" label={t("petForm.microchip")} placeholder={t("optional")} value={v.microchip} onChangeText={(x) => set("microchip", x)} />
        <Field
          testID="pet-notes-input"
          label={t("petForm.notes")}
          placeholder={t("petForm.notesPh")}
          multiline
          value={v.notes}
          onChangeText={(x) => set("notes", x)}
        />
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={s.stickyWrap}>
        <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Button label={pet ? t("petForm.saveChanges") : t("petForm.create")} icon="paw" onPress={save} loading={saving} disabled={uploading} testID="save-pet-button" />
        </View>
      </KeyboardStickyView>

      {picker.sheet}
      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        icon="trash-can-outline"
        title={t("petForm.removeTitle", { name: pet?.name ?? "" })}
        text={t("petForm.removeText")}
        testID="confirm-delete-pet-sheet"
      >
        <View style={{ gap: 8 }}>
          <Button label={t("petForm.remove")} variant="danger" icon="trash-can-outline" onPress={remove} testID="confirm-delete-pet-button" />
          <Button label={t("cancel")} variant="ghost" onPress={() => setConfirmDelete(false)} testID="cancel-delete-pet-button" />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 20 },
  photoBox: { alignItems: "center", gap: 12 },
  photoLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 56,
    backgroundColor: c.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: c.brandTertiary,
  },
  photoBtnText: { fontFamily: F.bold, fontSize: 14, color: c.onBrandTertiary },
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
