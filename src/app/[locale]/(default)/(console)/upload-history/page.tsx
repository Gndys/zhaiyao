import TableSlot from "@/components/console/slots/table";
import { Table as TableSlotType } from "@/types/slots/table";
import { TableColumn } from "@/types/blocks/table";
import { getAudioUploadsByUserUuid } from "@/models/audio-upload";
import { getUserUuid } from "@/services/user";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import moment from "moment";

export default async function UploadHistoryPage() {
  const t = await getTranslations();
  const user_uuid = await getUserUuid();

  const callbackUrl = `${process.env.NEXT_PUBLIC_WEB_URL}/upload-history`;
  if (!user_uuid) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const uploads = (await getAudioUploadsByUserUuid(user_uuid)) || [];
  const statusMap: Record<string, string> = {
    completed: t("upload_history.status.completed"),
    failed: t("upload_history.status.failed"),
  };

  const columns: TableColumn[] = [
    {
      name: "filename",
      title: t("upload_history.table.file_name"),
      callback: (item: any) => {
        const hasUrl = Boolean(item.audio_url);
        return (
          <div className="space-y-1">
            {hasUrl ? (
              <a
                href={item.audio_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {item.filename}
              </a>
            ) : (
              <span>{item.filename}</span>
            )}
            {hasUrl && (
              <p className="text-xs text-muted-foreground break-all">
                {item.audio_url}
              </p>
            )}
          </div>
        );
      },
    },
    {
      name: "created_at",
      title: t("upload_history.table.upload_time"),
      callback: (item: any) =>
        item.created_at
          ? moment(item.created_at).format("YYYY-MM-DD HH:mm:ss")
          : "-",
    },
    {
      name: "status",
      title: t("upload_history.table.status"),
      callback: (item: any) => statusMap[item.status] ?? item.status ?? "-",
    },
  ];

  const table: TableSlotType = {
    title: t("upload_history.title"),
    description: t("upload_history.description"),
    columns,
    data: uploads,
    empty_message: t("upload_history.empty_message"),
  };

  return <TableSlot {...table} />;
}
