import Link from "next/link";
import { RealtimeTranscriber } from "@/components/transcription/realtime-transcriber";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const realtimeCopy = {
  en: {
    badge: "Live Transcript",
    title: "Mic on. Text out.",
    description: "Pick a language, press Start, watch lines appear instantly.",
    cta: "Start transcribing",
    steps: [
      {
        title: "Pick a language",
        description: "Mandarin, Cantonese, English, Japanese, or Spanish.",
      },
      {
        title: "Hit Start",
        description: "Give mic access and stream straight to the live ASR.",
      },
      {
        title: "Copy anytime",
        description: "Interim + final text stay on screen while you speak.",
      },
    ],
    perks: [
      "No uploads — audio stays in the browser",
      "Live preview plus committed transcript",
      "Pause, resume, or clear whenever you want",
    ],
  },
  zh: {
    badge: "实时转写",
    title: "开麦即出字",
    description: "选语言，点开始，字幕实时滚动。",
    cta: "立即开始转写",
    steps: [
      {
        title: "选语言",
        description: "普通话 / 粤语 / 英语 / 日语 / 西语。",
      },
      {
        title: "点开始",
        description: "授权麦克风，浏览器直连腾讯实时 ASR。",
      },
      {
        title: "随时复制",
        description: "当前片段 + 已完成内容都会留在页面上。",
      },
    ],
    perks: [
      "无需上传音频，数据留在本地",
      "秒级刷新，随时暂停或继续",
      "结束可一键复制或清空内容",
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
    <main className="mx-auto w-full max-w-6xl px-6 py-16 lg:px-10">
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-sky-50 via-white to-indigo-50 p-8 shadow-sm dark:border-slate-800 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/0 via-white/30 to-white/0 dark:from-slate-900/70 dark:via-slate-800/70 dark:to-slate-950/80" />
        <div className="pointer-events-none absolute -left-20 top-10 h-48 w-48 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15" />
        <div className="pointer-events-none absolute -right-10 -bottom-10 h-56 w-56 rounded-full bg-indigo-200/40 blur-3xl dark:bg-indigo-500/12" />

        <div className="relative grid gap-8 lg:grid-cols-[1.1fr,0.9fr] lg:items-center">
          <div className="space-y-5">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {copy.badge}
            </span>
            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl dark:text-white">
                {copy.title}
              </h1>
              <p className="text-base text-muted-foreground dark:text-slate-200">
                {copy.description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" asChild className="shadow-lg dark:bg-primary dark:text-white dark:shadow-primary/30">
                <Link href="#realtime-console">{copy.cta}</Link>
              </Button>
              <Badge
                variant="secondary"
                className="rounded-full border bg-white/70 text-xs font-medium text-foreground dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-100"
              >
                {copy.perks[0]}
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {copy.steps.map((step, index) => (
              <div
                key={step.title}
                className="flex flex-col gap-2 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/80"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary dark:bg-primary/20">
                    {index + 1}
                  </span>
                  <p className="text-sm font-semibold text-foreground dark:text-slate-100">
                    {step.title}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground dark:text-slate-200">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="realtime-console" className="mt-10 scroll-mt-24">
        <RealtimeTranscriber />
      </section>
    </main>
  );
}
