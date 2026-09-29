"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate } from "./dictionary";
import type { Language } from "../shared/types";
interface I18n {
  language: Language;
  setLanguage: (value: Language) => void;
  t: (text: unknown) => string;
}
const Context = createContext<I18n>({
  language: "kk",
  setLanguage: () => {},
  t: (text) => translate(text),
});
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, update] = useState<Language>("kk");
  useEffect(() => {
    try {
      if (localStorage.getItem("qarzhy-language") === "ru") update("ru");
    } catch {}
  }, []);
  const setLanguage = useCallback((value: Language) => {
    update(value);
    try {
      localStorage.setItem("qarzhy-language", value);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (text: unknown) => translate(text, language),
    }),
    [language, setLanguage],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useI18n = () => useContext(Context);
