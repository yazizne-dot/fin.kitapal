"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../features/i18n/provider";

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { language, setLanguage, t: text } = useI18n();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem("qarzhy-language") === "ru") setLanguage("ru");
    } catch {}
    return () => pending.current?.abort();
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  function changeLanguage(value: string) {
    const next = value === "ru" ? "ru" : "kk";
    setLanguage(next);
    try {
      localStorage.setItem("qarzhy-language", next);
    } catch {}
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const values = new FormData(event.currentTarget);
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          username: values.get("username"),
          password: values.get("password"),
          remember: values.get("remember") === "on",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Кіру мүмкін болмады");
      if (!controller.signal.aborted) onSuccess();
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Кіру мүмкін болмады",
        );
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        pending.current = null;
      }
    }
  }
  return (
    <div className="login-layout">
      <div className="login-art">
        <div className="brand company-brand login-brand">
          <img
            src="/kitapal-logo.png"
            alt="Kitapal"
            width="1880"
            height="701"
          />
          <div className="brand-mission">
            {text("Қазақстанды кітап оқитын елге айналдырамыз")}
          </div>
        </div>
        <div>
          <h1>{text("Қаржыңыз айқын. Шешіміңіз нық.")}</h1>
          <p>
            {text(
              "Баспа, кітап дүкендері және дистрибуция. Компанияңыздың бүкіл қаржысы бір кеңістікте.",
            )}
          </p>
          <div className="mock-bars">
            {[45, 68, 61, 89, 77, 110, 100, 135, 160].map((height, index) => (
              <i key={index} style={{ height }} />
            ))}
          </div>
        </div>
        <p>Kitapal · {text("Қаржылық басқару платформасы")}</p>
      </div>
      <div className="login-form">
        <form
          className="login-box"
          id="login-form"
          onSubmit={submit}
          aria-busy={busy}
        >
          <div className="mobile-company-brand">
            <img
              src="/kitapal-logo.png"
              alt="Kitapal"
              width="1880"
              height="701"
            />
            <p className="brand-mission">
              {text("Қазақстанды кітап оқитын елге айналдырамыз")}
            </p>
          </div>
          <div className="eyebrow">{text("ҚОШ КЕЛДІҢІЗ")}</div>
          <h2>{text("Қаржыңызға көз салыңыз")}</h2>
          <p>
            {text("Жұмыс кеңістігіңізге кіру үшін")}
            <br />
            {text("логиніңіз бен құпиясөзіңізді енгізіңіз.")}
          </p>
          <select
            id="auth-language"
            className="language-select"
            aria-label={text("Тіл")}
            value={language}
            onChange={(e) => changeLanguage(e.target.value)}
          >
            <option value="kk">Қазақша</option>
            <option value="ru">Русский</option>
          </select>
          <label>
            {text("Логин")}
            <input
              name="username"
              autoComplete="username"
              required
              disabled={busy}
            />
          </label>
          <label>
            {text("Құпиясөз")}
            <input
              id="login-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </label>
          <div className="login-options">
            <label className="checkbox-label">
              <input
                id="show-login-password"
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
                aria-controls="login-password"
              />{" "}
              {text("Құпиясөзді көрсету")}
            </label>
            <label className="checkbox-label">
              <input name="remember" type="checkbox" disabled={busy} />{" "}
              {text("Мені есте сақтау (30 күн)")}
            </label>
          </div>
          <div id="login-error" role="alert">
            {error && <div className="error-message">{text(error)}</div>}
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? text("Жүктелуде…") : text("Жұмыс кеңістігіне кіру")}
          </button>
          <div className="login-demo">
            {text("Жеке логиніңіз бен құпиясөзіңізді енгізіңіз.")}
          </div>
        </form>
      </div>
    </div>
  );
}
