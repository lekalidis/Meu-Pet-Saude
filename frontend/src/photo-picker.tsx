import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Linking, View } from "react-native";

import { t } from "@/src/i18n";
import { Button, Sheet } from "@/src/ui";

export type PickedFile = { uri: string; name?: string | null; mimeType?: string | null };
type SheetMode = null | "ask" | "settings";

// Camera + gallery (+ optional PDF) picker with pre-permission explanation and settings fallback.
export function usePhotoPicker(onPicked: (a: PickedFile) => void, reason: string) {
  const [mode, setMode] = useState<SheetMode>(null);

  const launchCamera = async () => {
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (!r.canceled && r.assets[0]) onPicked({ uri: r.assets[0].uri, name: r.assets[0].fileName, mimeType: r.assets[0].mimeType });
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.getCameraPermissionsAsync();
    if (perm.granted) return launchCamera();
    setMode(perm.canAskAgain ? "ask" : "settings");
  };

  const requestAndLaunch = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) {
      setMode(null);
      return launchCamera();
    }
    setMode(perm.canAskAgain ? "ask" : "settings");
  };

  const pickFromGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (!r.canceled && r.assets[0]) onPicked({ uri: r.assets[0].uri, name: r.assets[0].fileName, mimeType: r.assets[0].mimeType });
  };

  const pickPdf = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) onPicked({ uri: r.assets[0].uri, name: r.assets[0].name, mimeType: r.assets[0].mimeType ?? "application/pdf" });
  };

  const sheet = (
    <Sheet
      visible={mode !== null}
      onClose={() => setMode(null)}
      icon="camera"
      testID="camera-permission-sheet"
      title={mode === "settings" ? t("perm.blockedTitle") : t("perm.allowTitle")}
      text={mode === "settings" ? t("perm.blockedText") : reason}
    >
      <View style={{ gap: 8 }}>
        {mode === "settings" ? (
          <Button label={t("perm.settings")} icon="cog" onPress={() => Linking.openSettings()} testID="open-settings-button" />
        ) : (
          <Button label={t("perm.allow")} icon="camera" onPress={requestAndLaunch} testID="allow-camera-button" />
        )}
        <Button
          label={t("perm.gallery")}
          icon="image"
          variant="ghost"
          onPress={() => {
            setMode(null);
            pickFromGallery();
          }}
          testID="sheet-gallery-button"
        />
      </View>
    </Sheet>
  );

  return { takePhoto, pickFromGallery, pickPdf, sheet };
}
