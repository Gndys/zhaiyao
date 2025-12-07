import { TrialPlayground, TrialFormCopy } from "@/components/trial/playground";
import { TrialChatBot } from "@/components/trial/chat-bot";
import { TrialContextProvider } from "@/components/trial/trial-context";
import {
  REQUIREMENT_EXTRACTION_PROMPT,
  REQUIREMENT_EXTRACTION_PROMPT_EN,
} from "@/lib/prompts";

const trialCopy = {
  zh: {
    badge: "免费试用",
    title: "上传逐字稿，AI 自动汇总会议精华",
    description:
      "体验 ZhaiYao 的第一个核心功能：上传或粘贴逐字稿，几分钟内生成结构化的会议报告、金句与行动项。",
    highlights: [
      {
        title: "逐字稿上传",
        description:
          "支持粘贴文本或 .txt/.md/字幕文件，自动截断、识别语言与角色。",
      },
      {
        title: "AI 重构逻辑",
        description:
          "多模型联动 + 定制模板，提炼要点、行动项、风险与最佳话术。",
      },
      {
        title: "Markdown 输出",
        description:
          "生成分层 Markdown，含摘要/亮点/行动项/引用，可复制、导出或分享。",
      },
    ],
    form: {
      formTitle: "上传逐字稿",
      formDescription: "粘贴内容或上传文本文件，建议控制在 20,000 字符以内。",
      transcriptLabel: "逐字稿内容",
      transcriptPlaceholder:
        "请将会议逐字稿粘贴到此处，或点击下方上传文本文件。",
      promptLabel: "自定义提示词（可选）",
      promptPlaceholder:
        "输入您自己的提示词，不填则自动使用内置提示词。",
      promptHint: "留空表示使用系统默认提示词。",
      promptPresetsTitle: "常用场景模板",
      promptPresetsDescription:
        "选择一个场景自动填充提示词，右侧可查看场景说明。",
      promptPresetsEmptyState:
        "选择一个场景即可查看简介，提示词将自动填入输入框。",
      promptPresets: [
        {
          id: "requirement-extraction",
          label: "需求提炼",
          description: "一键提炼客户痛点、需求优先级与实施方案。",
          prompt: REQUIREMENT_EXTRACTION_PROMPT,
        },
        {
          id: "business-meeting",
          label: "商务会议",
          description: "快速提炼商务会议重点、任务与各方立场，生成专业摘要。",
          prompt: `你是一位顶尖的会议摘要与商务沟通专家，而我是个完全不懂如何提取会议重点的人。我刚刚参加了一个重要的商务会议，有详细的逐字稿，但我完全不知道如何从中提取关键信息，而我的老板期待我明天提交一份专业的会议摘要。

我需要你帮我从这份冗长的逐字稿中提取出：
1. 会议中讨论的所有需要备忘的事项（特别是有明确时间节点的任务）
2. 会议的核心重点（最多3-5个关键点）
3. 各方表达的主要观点和立场
4. 任何需要跟进的决策或行动项目

请以一种结构清晰、一目了然的格式呈现，让我看起来像是一位高效的商务专业人士。我的老板特别重视简洁和重点突出，所以摘要必须既全面又精炼。

如果有些内容模糊不清，请标注出来并提供建议，告诉我如何在后续沟通中澄清这些问题。我完全依赖你的专业知识，因为我自己根本无法从这么多内容中找出重点。

以下是会议逐字稿：
[在这里粘贴您的会议逐字稿]`,
        },
      ],
      uploadLabel: "或上传文本文件",
      uploadHint: "最大 20,000 字符 / 5MB",
      submitLabel: "生成 AI 摘要",
      summaryTitle: "AI 摘要",
      summaryDescription: "自动生成的结构化报告会出现在这里。",
      summaryPlaceholder: "提交逐字稿后，这里会展示详细的多层摘要。",
      summaryHint: "输出包含 Markdown，可直接复制粘贴到知识库。",
      copyLabel: "复制内容",
      copiedLabel: "已复制",
      exportLabel: "导出 PDF",
      exportingLabel: "生成中...",
      warningTitle: "本地降级摘要",
      errors: {
        empty: "请先粘贴或上传逐字稿。",
        general: "生成摘要失败，请稍后再试。",
        fileSize: "文件不能超过 5MB。",
        upload: "无法读取该文件，请换一个文本文件重试。",
      },
      modelSelector: {
        label: "选择模型",
        description: "切换不同的 AI 供应商，用于生成会议摘要。",
        hint: "当前模型 ID：{{model}}",
      },
      healthCheck: {
        title: "AI 连通性检测",
        description: "提交前可先确认服务器能否连接所选 AI 模型。",
        actionLabel: "检测 AI 是否接通",
        actionLoadingLabel: "检测中...",
        successLabel: "AI 服务已接通",
        failureLabel: "检测失败",
      },
      dropzone: {
        title: "拖拽或点击上传文本文件",
        description: "将逐字稿文件拖到此处，或点击选择 .txt/.md/.srt/.vtt/.json。",
        actionLabel: "选择文本文件",
        secondaryLabel: "或改为粘贴逐字稿",
        selectedLabel: "已选择文件",
        emptyLabel: "支持 .txt/.md/.srt/.vtt/.json 格式",
      },
    } satisfies TrialFormCopy,
  },
  en: {
    badge: "Free Trial",
    title: "Upload transcripts and let AI craft a layered summary",
    description:
      "Try ZhaiYao’s core workflow: drop in your meeting transcript and receive an editor-grade report with highlights, quotes and action items.",
    highlights: [
      {
        title: "Transcript ingestion",
        description:
          "Paste text or upload .txt/.md/subtitle files with auto-chunking, language and speaker detection.",
      },
      {
        title: "AI restructuring",
        description:
          "Multi-model prompts rewrite the meeting into themes, action items, risks and reusable talking points.",
      },
      {
        title: "Markdown ready",
        description:
          "Layered Markdown with summary/highlights/actions/quotes, ready to copy, export or share.",
      },
    ],
    form: {
      formTitle: "Upload transcript",
      formDescription:
        "Paste your transcript or upload a text file (recommended under 20k characters).",
      transcriptLabel: "Transcript",
      transcriptPlaceholder:
        "Paste the meeting transcript here or upload a text file below.",
      promptLabel: "Custom prompt (optional)",
      promptPlaceholder:
        "Type your own instructions. Leave empty to use the built-in prompt.",
      promptHint: "If left blank we fall back to the internal default prompt.",
      promptPresetsTitle: "Templates",
      promptPresetsDescription:
        "Pick a scenario to auto-fill the prompt and see its description on the right.",
      promptPresetsEmptyState:
        "Pick a template to preview its description; the prompt auto-fills below.",
      promptPresets: [
        {
          id: "requirement-extraction",
          label: "Requirement Brief",
          description:
            "Extract client asks and turn them into implementation plans.",
          prompt: REQUIREMENT_EXTRACTION_PROMPT_EN,
        },
        {
          id: "business-meeting",
          label: "Business Meeting",
          description:
            "Pull out meeting essentials, timed tasks, stances, and follow-ups.",
          prompt: `You are a top-tier meeting summarization and business communication expert. I just attended an important business meeting and have a full transcript, but I don't know how to extract key information. My boss expects a concise professional summary by tomorrow.

Please extract:
1) All items to remember, especially tasks with deadlines.
2) The 3-5 core takeaways.
3) Each party's main viewpoints/positions.
4) Any decisions or action items that need follow-up.

Present it in a clear, skimmable format—concise yet complete. If anything is unclear, flag it and suggest what to clarify next time.

Transcript:
[paste the transcript here]`,
        },
      ],
      uploadLabel: "Or upload a text file",
      uploadHint: "Max 20,000 characters / 5MB",
      submitLabel: "Generate summary",
      summaryTitle: "AI summary",
      summaryDescription: "Your layered meeting report will appear below.",
      summaryPlaceholder:
        "The structured summary will be rendered here after the request finishes.",
      summaryHint:
        "Output is Markdown friendly and ready to paste into your workspace.",
      copyLabel: "Copy",
      copiedLabel: "Copied",
      exportLabel: "Export PDF",
      exportingLabel: "Preparing...",
      warningTitle: "Local fallback summary",
      errors: {
        empty: "Please paste or upload a transcript first.",
        general: "Failed to generate the summary. Please try again.",
        fileSize: "Files must be smaller than 5MB.",
        upload: "Unable to read that file. Please upload a plain text file.",
      },
      modelSelector: {
        label: "Model provider",
        description: "Pick which AI vendor/model to use for this summary.",
        hint: "Active model ID: {{model}}",
      },
      healthCheck: {
        title: "AI connectivity",
        description:
          "Run a quick handshake with the selected AI provider before submitting.",
        actionLabel: "Run health check",
        actionLoadingLabel: "Checking...",
        successLabel: "AI service reachable",
        failureLabel: "Health check failed",
      },
      dropzone: {
        title: "Drag & drop your transcript file",
        description:
          "Drop the transcript here or click to pick a .txt/.md/.srt/.vtt/.json file.",
        actionLabel: "Choose a text file",
        secondaryLabel: "or paste the transcript below",
        selectedLabel: "Selected file",
        emptyLabel: "Supports .txt/.md/.srt/.vtt/.json formats",
      },
    } satisfies TrialFormCopy,
  },
};

type LocaleKey = keyof typeof trialCopy;

const highlightGridStyles =
  "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>div]:rounded-2xl [&>div]:border [&>div]:bg-muted/40 [&>div]:p-4";

function getCopy(locale: string) {
  const hasLocale = Object.prototype.hasOwnProperty.call(trialCopy, locale);
  const localeKey = (hasLocale ? locale : "en") as LocaleKey;
  return trialCopy[localeKey];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = getCopy(locale);
  const baseUrl = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
  const canonical =
    locale === "en" ? `${baseUrl}/trial` : `${baseUrl}/${locale}/trial`;

  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical,
    },
  };
}

export default async function TrialPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const copy = getCopy(locale);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <span className="text-sm font-semibold uppercase tracking-wide text-primary">
          {copy.badge}
        </span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {copy.title}
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          {copy.description}
        </p>
      </div>

      <div className={`mt-8 ${highlightGridStyles}`}>
        {copy.highlights.map((item) => (
          <div key={item.title}>
            <p className="text-sm font-semibold text-primary/80">
              {item.title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>

      <TrialContextProvider>
        <div className="mt-10">
          <TrialPlayground copy={copy.form} />
        </div>

        <TrialChatBot />
      </TrialContextProvider>
    </div>
  );
}
