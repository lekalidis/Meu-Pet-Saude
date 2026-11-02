import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme";
import { F, Icon } from "@/src/ui";

type Kind = "success" | "error";
const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: Kind; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const show = useCallback((msg: string, kind: Kind = "success") => {
    setToast({ msg, kind, key: Date.now() });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <Animated.View
          key={toast.key}
          entering={FadeInUp}
          exiting={FadeOutUp}
          testID="toast-message"
          style={[styles.toast, { top: insets.top + 8, backgroundColor: colors.surfaceInverse }]}
        >
          <Icon
            name={toast.kind === "success" ? "check-circle" : "alert-circle"}
            size={22}
            color={toast.kind === "success" ? colors.success : colors.error}
          />
          <Text style={[styles.text, { color: colors.onSurfaceInverse }]}>{toast.msg}</Text>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: { fontFamily: F.semi, fontSize: 14, flex: 1 },
});
