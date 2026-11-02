import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { currencyCode, setCurrencyVar } from "@/src/format";
import { Lang, loadLang, saveLang } from "@/src/i18n";
import { storage } from "@/src/utils/storage";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; currency: string; setCurrency: (c: string) => void; ready: boolean };
const LangCtx = createContext<Ctx>({ lang: "pt", setLang: () => {}, currency: "USD", setCurrency: () => {}, ready: false });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setState] = useState<Lang>("pt");
  const [currency, setCur] = useState("USD");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const l = await loadLang();
      const saved = (await storage.getItem("app_currency", "")) as string;
      setCurrencyVar(saved || null);
      setState(l);
      setCur(currencyCode());
      setReady(true);
    })();
  }, []);
  const setLang = useCallback((l: Lang) => {
    saveLang(l);
    setState(l);
  }, []);
  const setCurrency = useCallback((c: string) => {
    setCurrencyVar(c);
    storage.setItem("app_currency", c);
    setCur(c);
  }, []);
  return <LangCtx.Provider value={{ lang, setLang, currency, setCurrency, ready }}>{children}</LangCtx.Provider>;
}

// Call in every screen so it re-renders when the language or currency changes.
export const useLang = () => useContext(LangCtx);
