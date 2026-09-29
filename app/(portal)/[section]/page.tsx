import { notFound } from "next/navigation";
import { isPortalPage } from "../../../features/portal/routes";
import { PortalPage } from "../../../features/portal/page-view";
export default async function ReportPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isPortalPage(section)) notFound();
  return <PortalPage page={section} />;
}
