"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../features/i18n/provider";
import { Icon } from "./ui/icon";

const copy = {
  kk: {
    hero: "Кітап бизнесінің қаржысын басқару платформасы",
    intro: "Баспа, кітап дүкендері және дистрибуция қаржысы бір жүйеде.",
    welcome: "ҚОШ КЕЛДІҢІЗ",
    title: "Жүйеге кіру",
    description: "Жұмыс кеңістігіңізге кіру үшін логиніңіз бен құпиясөзіңізді енгізіңіз.",
    username: "Логин",
    password: "Құпиясөз",
    show: "Құпиясөзді көрсету",
    hide: "Құпиясөзді жасыру",
    remember: "Мені есте сақтау (30 күн)",
    submit: "Жұмыс кеңістігіне кіру",
    loading: "Жүктелуде…",
    unavailable: "Кіру мүмкін болмады",
    language: "Тіл",
  },
  ru: {
    hero: "Платформа управления финансами книжного бизнеса",
    intro: "Финансы издательства, магазинов и дистрибуции в одной системе.",
    welcome: "ДОБРО ПОЖАЛОВАТЬ",
    title: "Вход в систему",
    description: "Введите логин и пароль, чтобы войти в рабочее пространство.",
    username: "Логин",
    password: "Пароль",
    show: "Показать пароль",
    hide: "Скрыть пароль",
    remember: "Запомнить меня (30 дней)",
    submit: "Войти в рабочее пространство",
    loading: "Загрузка…",
    unavailable: "Не удалось войти",
    language: "Язык",
  },
};

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { language, setLanguage, t } = useI18n();
  const words = copy[language];
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

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
      if (!response.ok) throw new Error(data.error || words.unavailable);
      if (!controller.signal.aborted) onSuccess();
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : words.unavailable);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        pending.current = null;
      }
    }
  }

  return (
    <div className="login-layout">
      <div className="login-decoration" aria-hidden="true" />
      <section className="login-art" aria-label="Kitapal">
        <div className="login-art-content">
          <div className="login-brand">
            <span className="login-logo"><img src="/kitapal-logo.png" alt="Kitapal" width="1880" height="701" /></span>
          </div>
          <div className="login-art-grid">
            <div className="login-hero-copy">
              <h1>{words.hero}</h1>
              <p>{words.intro}</p>
            </div>
          </div>
        </div>
      </section>
      <div className="login-language">
          <Icon name="globe" size={22} />
          <select
            id="auth-language"
            className="language-select"
            aria-label={words.language}
            value={language}
            onChange={(event) => setLanguage(event.target.value === "ru" ? "ru" : "kk")}
          >
            <option value="kk">Қазақша</option>
            <option value="ru">Русский</option>
          </select>
          <Icon name="down" size={17} />
      </div>
      <section className="login-form">
        <form className="login-box" id="login-form" onSubmit={submit} aria-busy={busy}>
          <div className="mobile-company-brand">
            <img src="/kitapal-logo.png" alt="Kitapal" width="1880" height="701" />
          </div>
          <div className="eyebrow">{words.welcome}</div>
          <h2>{words.title}</h2>
          <p className="login-description">{words.description}</p>

          <label className="login-field" htmlFor="login-username">{words.username}</label>
          <div className="login-input-wrap">
            <Icon name="users" size={22} />
            <input id="login-username" name="username" autoComplete="username" required disabled={busy} />
          </div>

          <label className="login-field" htmlFor="login-password">{words.password}</label>
          <div className="login-input-wrap">
            <Icon name="lock" size={21} />
            <input
              id="login-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={busy}
            />
            <button
              className="login-password-toggle"
              type="button"
              aria-label={visible ? words.hide : words.show}
              aria-controls="login-password"
              aria-pressed={visible}
              onClick={() => setVisible((current) => !current)}
            >
              <Icon name={visible ? "eye-off" : "eye"} size={22} />
            </button>
          </div>

          <div className="login-options">
            <label className="checkbox-label">
              <input
                id="show-login-password"
                type="checkbox"
                checked={visible}
                onChange={(event) => setVisible(event.target.checked)}
                aria-controls="login-password"
              />
              {words.show}
            </label>
            <label className="checkbox-label">
              <input name="remember" type="checkbox" disabled={busy} />
              {words.remember}
            </label>
          </div>
          <div id="login-error" role="alert">
            {error && <div className="error-message">{t(error)}</div>}
          </div>
          <button className="primary login-submit" type="submit" disabled={busy}>
            {busy ? words.loading : words.submit}<Icon name="arrow" size={21} />
          </button>
        </form>
      </section>
    </div>
  );
}
