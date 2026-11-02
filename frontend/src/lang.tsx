import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { Lang, loadLang, saveLang } from "@/src/i18n";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; ready: boolean };
const LangCtx = createContext<Ctx>({ lang: "pt", setLang: () => {}, ready: false });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setState] = useState<Lang>("pt");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadLang().then((l) => {
      setState(l);
      setReady(true);
    });
  }, []);
  const setLang = useCallback((l: Lang) => {
    saveLang(l);
    setState(l);
  }, []);
  return <LangCtx.Provider value={{ lang, setLang, ready }}>{children}</LangCtx.Provider>;
}

// Call in every screen so it re-renders when the language changes.
export const useLang = () => useContext(LangCtx);
