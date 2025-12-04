import { TranscriptionUploader } from "@/components/transcription/transcription-uploader";

const transcribeCopy = {
  en: {
    metaTitle: "Audio to Transcript · ZhaiYao",
    metaDescription:
      "Upload your recordings and receive clean, copyable transcripts within minutes.",
    badge: "Audio Assistant",
    heading: "Upload audio and auto transcribe",
    description:
      "Supports popular audio formats and runs the end-to-end transcription workflow automatically.",
  },
  zh: {
    metaTitle: "音频转逐字稿 · ZhaiYao",
    metaDescription:
      "上传会议录音，自动生成可复制的逐字稿，几分钟内即可查看。",
    badge: "音频助手",
    heading: "上传音频，自动转写逐字稿",
    description:
      "支持常见音频格式，后台自动完成转写流程并输出可复制的文本结果。",
  },
};

type LocaleKey = keyof typeof transcribeCopy;

function getCopy(locale: string) {
  const localeKey = (locale in transcribeCopy ? locale : "en") as LocaleKey;
  return transcribeCopy[localeKey];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = getCopy(locale);

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
  };
}

export default async function TranscribePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = getCopy(locale);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16 lg:px-8">
      <div className="space-y-6">
        <div className="space-y-3 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary/80">
            {copy.badge}
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {copy.heading}
          </h1>
          <p className="text-base text-muted-foreground">{copy.description}</p>
        </div>
        <TranscriptionUploader />
      </div>
    </main>
  );
}
