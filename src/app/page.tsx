import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/locale";

export default function RootPage() {
  // Ensure the bare domain keeps working even if middleware is skipped
  redirect(`/${defaultLocale}`);
}
