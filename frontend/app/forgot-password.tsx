import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { getLang, t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { makeStyles } from "@/src/theme";
import { useToast } from "@/src/toast";
import { Button, F, Field, ScreenHeader } from "@/src/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPassword() {
  useLang();
  const { resetPassword } = useAuth();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const toast = useToast();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setError("");
    if (!EMAIL_RE.test(email.trim())) return setError(t("auth.emailInvalid"));
    setBusy(true);
    try {
      await api("/auth/forgot", { method: "POST", body: { email: email.trim(), lang: getLang() }, auth: false });
      setStep("code");
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError("");
    if (code.length !== 6) return setError(t("forgot.invalid"));
    if (password.length < 8) return setError(t("auth.weak"));
    setBusy(true);
    try {
      await resetPassword(email.trim(), code, password);
      toast(t("forgot.done"));
    } catch (e) {
      const d = e instanceof ApiError ? e.detail : "";
      setError(d === "code_expired" ? t("forgot.expired") : d === "invalid_code" ? t("forgot.invalid") : t("genericError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <ScreenHeader title={t("forgot.title")} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.text} testID="forgot-info">
          {step === "email" ? t("forgot.text") : t("forgot.sent")}
        </Text>
        <Field
          testID="forgot-email-input"
          label={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={step === "email"}
        />
        {step === "code" && (
          <>
            <Field testID="forgot-code-input" label={t("forgot.code")} value={code} onChangeText={(x) => setCode(x.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
            <Field
              testID="forgot-password-input"
              label={t("forgot.newPassword")}
              placeholder={t("auth.passwordPh")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </>
        )}
        {error ? (
          <Text style={s.error} testID="forgot-error">
            {error}
          </Text>
        ) : null}
        {step === "email" ? (
          <Button label={t("forgot.send")} icon="email-fast" onPress={send} loading={busy} testID="forgot-send-button" />
        ) : (
          <>
            <Button label={t("forgot.reset")} icon="lock-reset" onPress={reset} loading={busy} testID="forgot-reset-button" />
            <Pressable onPress={send} style={s.link} testID="forgot-resend-button">
              <Text style={s.linkText}>{t("forgot.resend")}</Text>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  text: { fontFamily: F.semi, fontSize: 15, color: c.muted },
  error: { fontFamily: F.semi, fontSize: 14, color: c.error },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { fontFamily: F.bold, fontSize: 14, color: c.brandPrimary },
}));
