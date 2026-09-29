import { PortalProvider } from "../../features/portal/provider";
import { I18nProvider } from "../../features/i18n/provider";
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <I18nProvider>
      <PortalProvider>{children}</PortalProvider>
    </I18nProvider>
  );
}
