import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n/provider";
import type { Language, User } from "../shared/types";
import {
  errorText,
  Localized,
  roleName,
  send,
  type ManagementProps,
} from "./common";

export function AccountView({ user, api, refresh }: ManagementProps) {
  const { setLanguage } = useI18n();
  const privileged = user.role === "admin" || user.role === "finance";
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const language = String(form.get("language")) as Language;
    const username = String(form.get("username") || "");
    const body: Record<string, string> = { language };
    if (privileged && username !== user.username) {
      body.username = username;
      body.current_password = String(form.get("current_password") || "");
    }
    setProfileBusy(true);
    setProfileError("");
    setProfileSuccess("");
    try {
      const result = await send<{ user: User }>(api, "/api/profile", body);
      setLanguage(result.user.language);
      await refresh();
      setProfileSuccess("Өзгерістер сақталды");
    } catch (reason) {
      setProfileError(errorText(reason));
    } finally {
      setProfileBusy(false);
    }
  };
  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("new_password") || "");
    const confirmation = String(form.get("confirmation") || "");
    setPasswordError("");
    setPasswordSuccess("");
    if (newPassword !== confirmation) {
      setPasswordError("Құпиясөздер сәйкес емес");
      return;
    }
    setPasswordBusy(true);
    try {
      await send<{ ok: boolean }>(api, "/api/password", {
        current_password: String(form.get("current_password") || ""),
        new_password: newPassword,
        confirmation,
      });
      formElement.reset();
      await refresh();
      setPasswordSuccess("Құпиясөз өзгерді");
    } catch (reason) {
      setPasswordError(errorText(reason));
    } finally {
      setPasswordBusy(false);
    }
  };
  return (
    <Localized>
      <>
        {Boolean(user.must_change_password) && (
          <div className="source-warning">
            <b>Алдымен уақытша құпиясөзді ауыстырыңыз</b>
          </div>
        )}
        <div className="settings-grid">
          <div className="panel settings-card">
            <h2>Жеке баптаулар</h2>
            <p>
              <b data-no-i18n>{user.name}</b> · {roleName(user.role)}
            </p>
            <form id="profile-form" onSubmit={saveProfile}>
              <div className="form-grid">
                <label className="wide">
                  Логин
                  <input
                    name="username"
                    defaultValue={user.username}
                    autoComplete="username"
                    required={privileged}
                    disabled={!privileged}
                  />
                </label>
                <label className="wide">
                  Тіл
                  <select
                    id="profile-language"
                    name="language"
                    defaultValue={user.language}
                  >
                    <option value="kk">Қазақша</option>
                    <option value="ru">Русский</option>
                  </select>
                </label>
                {privileged && (
                  <label className="wide">
                    Қазіргі құпиясөз
                    <input
                      name="current_password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Логинді өзгерту үшін"
                    />
                  </label>
                )}
              </div>
              <div className="form-error" role="alert">
                {profileError}
              </div>
              {profileSuccess && (
                <p className="note" role="status">
                  {profileSuccess}
                </p>
              )}
              <div className="form-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={profileBusy}
                >
                  {profileBusy ? "Сақталуда…" : "Сақтау"}
                </button>
              </div>
            </form>
          </div>
          <div className="panel settings-card">
            <h2>Парольді өзгерту</h2>
            <form id="password-form" onSubmit={savePassword}>
              <div className="form-grid">
                <label className="wide">
                  Қазіргі құпиясөз
                  <input
                    name="current_password"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label className="wide">
                  Жаңа құпиясөз
                  <input
                    name="new_password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
                <label className="wide">
                  Құпиясөзді қайталау
                  <input
                    name="confirmation"
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <div className="form-error" role="alert">
                {passwordError}
              </div>
              {passwordSuccess && (
                <p className="note" role="status">
                  {passwordSuccess}
                </p>
              )}
              <div className="form-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={passwordBusy}
                >
                  {passwordBusy ? "Сақталуда…" : "Парольді өзгерту"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </>
    </Localized>
  );
}
