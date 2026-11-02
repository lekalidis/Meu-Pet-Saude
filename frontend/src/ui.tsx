import React from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";

import { fileUrl } from "@/src/api";
import { t } from "@/src/i18n";
import { makeStyles, useTheme } from "@/src/theme";

export const F = {
  display: "Quicksand-Bold",
  regular: "Nunito-Regular",
  semi: "Nunito-SemiBold",
  bold: "Nunito-ExtraBold",
};

export const Icon = MaterialDesignIcons as unknown as React.ComponentType<{
  name: string;
  size?: number;
  color?: string;
}>;

export function tap() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

type BtnProps = {
  label: string;
  onPress: () => void;
  icon?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, icon, variant = "primary", loading, disabled, testID, style }: BtnProps) {
  const { colors } = useTheme();
  const bg = {
    primary: colors.brandPrimary,
    secondary: colors.brandSecondary,
    ghost: colors.surfaceTertiary,
    danger: colors.brandTertiary,
  }[variant];
  const fg = {
    primary: colors.onBrandPrimary,
    secondary: colors.onBrandSecondary,
    ghost: colors.onSurfaceTertiary,
    danger: colors.error,
  }[variant];
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        btn.base,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} color={fg} />}
          <Text style={[btn.label, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const btn = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: 999,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: { fontFamily: F.bold, fontSize: 16 },
});

export function IconButton({
  icon,
  onPress,
  testID,
  tone = "light",
}: {
  icon: string;
  onPress: () => void;
  testID: string;
  tone?: "light" | "brand";
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tone === "brand" ? colors.brandPrimary : colors.surfaceSecondary,
          transform: [{ scale: pressed ? 0.92 : 1 }],
        },
      ]}
    >
      <Icon name={icon} size={22} color={tone === "brand" ? colors.onBrandPrimary : colors.onSurface} />
    </Pressable>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const s = useHeaderStyles();
  return (
    <View style={[s.wrap, { paddingTop: insets.top + 8 }]}>
      <IconButton icon="arrow-left" testID="header-back-button" onPress={() => router.back()} />
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1} testID="screen-title">
          {title}
        </Text>
        {subtitle ? (
          <Text style={s.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const useHeaderStyles = makeStyles((c) => ({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: c.surface,
  },
  title: { fontFamily: F.display, fontSize: 22, color: c.onSurface },
  sub: { fontFamily: F.semi, fontSize: 13, color: c.muted },
}));

export function Field({
  label,
  suffix,
  error,
  testID,
  ...props
}: TextInputProps & { label: string; suffix?: string; error?: string; testID: string }) {
  const s = useFieldStyles();
  const { colors } = useTheme();
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.box, error ? { borderColor: colors.error } : null, props.multiline ? { minHeight: 96 } : null]}>
        <TextInput
          testID={testID}
          placeholderTextColor={colors.muted}
          style={[s.input, props.multiline ? { textAlignVertical: "top", paddingTop: 14 } : null]}
          {...props}
        />
        {suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
      </View>
      {error ? (
        <Text style={s.error} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useFieldStyles = makeStyles((c) => ({
  wrap: { gap: 6 },
  label: { fontFamily: F.bold, fontSize: 14, color: c.onSurface },
  box: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  input: { flex: 1, fontFamily: F.semi, fontSize: 16, color: c.onSurface, paddingVertical: 12 },
  suffix: { fontFamily: F.bold, fontSize: 15, color: c.muted, marginLeft: 8 },
  error: { fontFamily: F.semi, fontSize: 12, color: c.error },
}));

export function ChoicePills({
  label,
  options,
  value,
  onChange,
  testID,
  error,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  testID: string;
  error?: string;
}) {
  const s = useFieldStyles();
  const { colors } = useTheme();
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              testID={`${testID}-${o.value || "none"}`}
              onPress={() => {
                tap();
                onChange(active ? "" : o.value);
              }}
              style={{
                minHeight: 44,
                paddingHorizontal: 18,
                borderRadius: 999,
                justifyContent: "center",
                borderWidth: 1.5,
                borderColor: active ? colors.brandPrimary : colors.border,
                backgroundColor: active ? colors.brandTertiary : colors.surfaceSecondary,
              }}
            >
              <Text style={{ fontFamily: F.bold, fontSize: 14, color: active ? colors.onBrandTertiary : colors.onSurface }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text style={s.error} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function PetAvatar({ photo, size, species }: { photo?: string | null; size: number; species?: string }) {
  const { colors } = useTheme();
  const radius = size / 2;
  if (photo) {
    return (
      <Image
        source={{ uri: fileUrl(photo) }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.brandTertiary }}
        contentFit="cover"
        transition={200}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: colors.brandTertiary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={species === "cat" ? "cat" : species === "dog" ? "dog" : "paw"} size={size * 0.5} color={colors.brandPrimary} />
    </View>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: string; title: string; text: string; children?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: 32, paddingHorizontal: 24, gap: 12 }} testID="empty-state">
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: colors.brandTertiary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={48} color={colors.brandPrimary} />
      </View>
      <Text style={{ fontFamily: F.display, fontSize: 20, color: colors.onSurface, textAlign: "center" }}>{title}</Text>
      <Text style={{ fontFamily: F.semi, fontSize: 14, color: colors.muted, textAlign: "center" }}>{text}</Text>
      {children}
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  icon,
  title,
  text,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  icon: string;
  title: string;
  text: string;
  children: React.ReactNode;
  testID: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }} onPress={onClose} testID={`${testID}-backdrop`}>
        <Pressable
          testID={testID}
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 24,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: colors.brandTertiary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={icon} size={28} color={colors.brandPrimary} />
          </View>
          <Text style={{ fontFamily: F.display, fontSize: 20, color: colors.onSurface }}>{title}</Text>
          <Text style={{ fontFamily: F.semi, fontSize: 15, color: colors.muted, marginBottom: 8 }}>{text}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }} testID="loading-indicator">
      <Icon name="paw" size={40} color={colors.brandPrimary} />
      <ActivityIndicator color={colors.brandPrimary} />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState icon="emoticon-sad-outline" title={t("oops")} text={message}>
      <Button label={t("retry")} icon="refresh" onPress={onRetry} testID="retry-button" />
    </EmptyState>
  );
}
