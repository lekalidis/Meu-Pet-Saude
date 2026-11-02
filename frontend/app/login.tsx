import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { LANGS, t } from "@/src/i18n";
import { useLang } from "@/src/lang";
import { makeStyles, useTheme } from "@/src/theme";
import { Button, F, Field, Icon, tap } from "@/src/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { lang, setLang } = useLang();
  const { login, register, loginWithGoogle } = useAuth();
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [gBusy, setGBusy] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = t("auth.emailInvalid");
    if (mode === "register" && password.length < 8) errs.password = t("auth.weak");
    if (mode === "login" && !password) errs.password = t("required");
    setErrors(errs);
    setFormError("");
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
    } catch (e) {
      const d = e instanceof ApiError ? e.detail : "";
      setFormError(d === "invalid_credentials" ? t("auth.invalid") : d === "account_exists" ? t("auth.exists") : t("genericError"));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setFormError("");
    setGBusy(true);
    try {
      await loginWithGoogle();
    } catch {
      setFormError(t("auth.googleFailed"));
    } finally {
      setGBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={[s.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.langRow}>
          {LANGS.map((l) => (
            <Pressable
              key={l.code}
              testID={`login-lang-${l.code}`}
              onPress={() => {
                tap();
                setLang(l.code);
              }}
              style={[s.langChip, l.code === lang && s.langChipOn]}
            >
              <Text style={[s.langText, l.code === lang && { color: colors.onBrandTertiary }]}>{l.code.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.hero}>
          <View style={s.logo}>
            <Icon name="paw" size={48} color={colors.onBrandPrimary} />
          </View>
          <Text style={s.title} testID="login-title">
            {t("appName")}
          </Text>
          <Text style={s.tagline}>{t("auth.tagline")}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>{mode === "login" ? t("auth.login") : t("auth.register")}</Text>
          {mode === "register" && (
            <Field testID="register-name-input" label={t("auth.name")} placeholder={t("auth.namePh")} value={name} onChangeText={setName} autoComplete="name" />
          )}
          <Field
            testID="login-email-input"
            label={t("auth.email")}
            placeholder="nome@email.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            error={errors.email}
          />
          <Field
            testID="login-password-input"
            label={t("auth.password")}
            placeholder={mode === "register" ? t("auth.passwordPh") : ""}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            error={errors.password}
            onSubmitEditing={submit}
          />
          {formError ? (
            <Text style={s.formError} testID="login-error">
              {formError}
            </Text>
          ) : null}
          <Button
            label={mode === "login" ? t("auth.login") : t("auth.register")}
            icon={mode === "login" ? "login" : "account-plus"}
            onPress={submit}
            loading={busy}
            testID="login-submit-button"
          />
          <View style={s.orRow}>
            <View style={s.line} />
            <Text style={s.or}>{t("auth.or")}</Text>
            <View style={s.line} />
          </View>
          <Pressable testID="google-login-button" onPress={google} disabled={gBusy} style={({ pressed }) => [s.google, { opacity: gBusy ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
            <Icon name="google" size={22} color="#DB4437" />
            <Text style={s.googleText}>{t("auth.google")}</Text>
          </Pressable>
        </View>

        <Pressable
          testID="toggle-auth-mode-button"
          onPress={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setErrors({});
            setFormError("");
          }}
          style={s.toggle}
        >
          <Text style={s.toggleText}>{mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}</Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 16, gap: 16 },
  langRow: { flexDirection: "row", justifyContent: "flex-end", gap: 6 },
  langChip: { height: 36, minWidth: 44, paddingHorizontal: 10, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  langChipOn: { borderColor: c.brandPrimary, backgroundColor: c.brandTertiary },
  langText: { fontFamily: F.bold, fontSize: 12, color: c.onSurface },
  hero: { alignItems: "center", gap: 8, marginTop: 8 },
  logo: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: F.display, fontSize: 28, color: c.onSurface, textAlign: "center" },
  tagline: { fontFamily: F.semi, fontSize: 15, color: c.muted, textAlign: "center", paddingHorizontal: 16 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 24, padding: 16, gap: 16, borderWidth: 1, borderColor: c.border },
  cardTitle: { fontFamily: F.display, fontSize: 20, color: c.onSurface },
  formError: { fontFamily: F.semi, fontSize: 14, color: c.error },
  orRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: c.divider },
  or: { fontFamily: F.semi, fontSize: 13, color: c.muted },
  google: {
    minHeight: 54,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: c.border,
    backgroundColor: c.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleText: { fontFamily: F.bold, fontSize: 16, color: c.onSurface },
  toggle: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  toggleText: { fontFamily: F.bold, fontSize: 15, color: c.brandPrimary },
}));
