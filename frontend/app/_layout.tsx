import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { LogBox, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { initDevice } from "@/src/api";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { LangProvider, useLang } from "@/src/lang";
import { queryClient } from "@/src/query-client";
import { initializeRevenueCat, SubscriptionProvider } from "@/src/revenuecat";
import { useTheme } from "@/src/theme";
import { ToastProvider } from "@/src/toast";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// RevenueCat must be configured once at module scope, before any component mounts.
try {
  initializeRevenueCat();
} catch (err) {
  console.warn("RevenueCat unavailable:", err);
}

function AppStack({ booted }: { booted: boolean }) {
  const { colors } = useTheme();
  const { ready } = useLang();
  if (!booted || !ready) return <View style={[styles.root, { backgroundColor: colors.surface }]} />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}

export default function RootLayout() {
  // Prewarm icon font + app fonts so icons render on Expo Go Android.
  const [fontsLoaded, fontError] = useFonts({
    MaterialDesignIcons: require("@react-native-vector-icons/material-design-icons/fonts/MaterialDesignIcons.ttf"),
    "Quicksand-Bold": require("../assets/fonts/Quicksand-Bold.ttf"),
    "Nunito-Regular": require("../assets/fonts/Nunito-Regular.ttf"),
    "Nunito-SemiBold": require("../assets/fonts/Nunito-SemiBold.ttf"),
    "Nunito-ExtraBold": require("../assets/fonts/Nunito-ExtraBold.ttf"),
  });
  const [deviceReady, setDeviceReady] = useState(false);

  useEffect(() => {
    initDevice().finally(() => setDeviceReady(true));
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SubscriptionProvider>
            <LangProvider>
              <KeyboardProvider>
                <ToastProvider>
                  <StatusBar style="dark" />
                  <AppStack booted={(fontsLoaded || !!fontError) && deviceReady} />
                </ToastProvider>
              </KeyboardProvider>
            </LangProvider>
          </SubscriptionProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
