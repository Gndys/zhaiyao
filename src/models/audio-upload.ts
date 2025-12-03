import { audio_uploads } from "@/db/schema";
import { db } from "@/db";
import { desc, eq } from "drizzle-orm";

export async function insertAudioUpload(
  data: typeof audio_uploads.$inferInsert
): Promise<typeof audio_uploads.$inferSelect | undefined> {
  const now = new Date();
  const payload = {
    created_at: data.created_at instanceof Date ? data.created_at : now,
    updated_at: data.updated_at instanceof Date ? data.updated_at : now,
    ...data,
  };

  const [record] = await db()
    .insert(audio_uploads)
    .values(payload)
    .returning();

  return record;
}

export async function getAudioUploadsByUserUuid(
  user_uuid: string
): Promise<(typeof audio_uploads.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(audio_uploads)
    .where(eq(audio_uploads.user_uuid, user_uuid || ""))
    .orderBy(desc(audio_uploads.created_at));

  return data;
}
