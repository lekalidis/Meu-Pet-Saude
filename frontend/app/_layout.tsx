import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { LogBox, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { initDevice } from "@/src/api";
import { AuthProvider, useAuth } from "@/src/auth";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { LangProvider, useLang } from "@/src/lang";
import { queryClient } from "@/src/query-client";
import { initializeRevenueCat, SubscriptionProvider } from "@/src/revenuecat";
import { useTheme } from "@/src/theme";
import { ToastProvider } from "@/src/toast";
import { Loading } from "@/src/ui";

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
  const { user, loading } = useAuth();
  if (!booted || !ready) return <View style={[styles.root, { backgroundColor: colors.surface }]} />;
  if (loading)
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <Loading />
      </View>
    );
  return (
    <SubscriptionProvider userId={user?.id ?? null}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="index" />
          <Stack.Screen name="pet-form" />
          <Stack.Screen name="pet/[id]/index" />
          <Stack.Screen name="pet/[id]/[type]" />
          <Stack.Screen name="pet/[id]/report" />
          <Stack.Screen name="record-form" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="paywall" />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </SubscriptionProvider>
  );
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
          <LangProvider>
            <AuthProvider>
              <KeyboardProvider>
                <ToastProvider>
                  <StatusBar style="dark" />
                  <AppStack booted={(fontsLoaded || !!fontError) && deviceReady} />
                </ToastProvider>
              </KeyboardProvider>
            </AuthProvider>
          </LangProvider>
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
