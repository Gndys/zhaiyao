import { RealtimeTranscriber } from "@/components/transcription/realtime-transcriber";

const realtimeCopy = {
  en: {
    badge: "Live Transcript",
    title: "Turn voice into text in real time",
    description:
      "Start speaking and watch the transcript refresh every second. Built on the browser’s speech recognition so nothing leaves your device.",
    features: [
      {
        title: "Live preview",
        description: "A dedicated panel shows interim text before it is committed.",
      },
      {
        title: "Language aware",
        description: "Switch among Mandarin, Cantonese, English, Japanese or Spanish.",
      },
      {
        title: "One-click export",
        description: "Copy or clear the transcript when you finish the recording.",
      },
    ],
  },
  zh: {
    badge: "实时转写",
    title: "一边说话，一边生成逐字稿",
    description:
      "点击开始即可实时把语音转换成文字，识别过程全部在本地浏览器完成，离线环境也能使用。",
    features: [
      {
        title: "秒级刷新",
        description: "实时面板展示正在识别的片段，确认无误再写入逐字稿。",
      },
      {
        title: "多语种支持",
        description: "可在普通话、粤语、英语、日语、西语之间切换。",
      },
      {
        title: "轻松管理",
        description: "结束后可一键复制或清空内容，方便继续下一段。",
      },
    ],
  },
};

type LocaleKey = keyof typeof realtimeCopy;

function getCopy(locale: string) {
  const localeKey = (locale in realtimeCopy ? locale : "en") as LocaleKey;
  return realtimeCopy[localeKey];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = getCopy(locale);

  return {
    title: `${copy.title} · ZhaiYao`,
    description: copy.description,
  };
}

export default async function RealtimePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = getCopy(locale);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 lg:px-10">
      <div className="space-y-8">
        <div className="space-y-3 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary/80">
            {copy.badge}
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {copy.title}
          </h1>
          <p className="text-base text-muted-foreground">{copy.description}</p>
        </div>

        <div className="grid gap-4 rounded-3xl border border-border/70 bg-card/40 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-dashed border-border/70 bg-background/80 p-4 shadow-sm"
            >
              <p className="text-sm font-semibold text-foreground">
                {feature.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        <RealtimeTranscriber />
      </div>
    </main>
  );
}
