import { NextResponse } from "next/server";
import { MEETING_SUMMARY_PROMPT } from "@/lib/prompts";

const APIMART_ENDPOINT = "https://api.apimart.ai/v1/chat/completions";
const DEFAULT_MODEL =
  process.env.APIMART_MODEL && process.env.APIMART_MODEL.trim().length > 0
    ? process.env.APIMART_MODEL
    : "gemini-3-pro-preview";

type SupportedLang = "zh" | "en";

const FALLBACK_COPY: Record<
  SupportedLang,
  {
    warning: string;
    introHeading: string;
    introGuide: string;
    keypointHeading: string;
    keypointTitle: (index: number) => string;
    keypointCore: string;
    keypointQuote: string;
    keypointWhy: string;
    keypointWhyTail: string;
    themeHeading: string;
    themeCore: string;
    themeStory: string;
    themeAction: string;
    themeQuote: string;
    cardHeading: string;
    cardColumns: string[];
    metaHeading: string;
    metaBullets: string[];
  }
> = {
  zh: {
    warning:
      "⚠️ 暂时无法连接 APIMart，以下为本地快速提炼，仅供预览，请稍后重试以生成正式版摘要。",
    introHeading: "## 第一部分：核心主题",
    introGuide:
      "该版本依据本地规则粗略提炼，涵盖录音中的主线与目标，最终结果可能与正式模型存在差异。",
    keypointHeading: "## 第二部分：核心观点提炼",
    keypointTitle: (index) => `【关键洞察 ${index + 1}】`,
    keypointCore: "核心思想：",
    keypointQuote: "金句：",
    keypointWhy: "为什么重要：",
    keypointWhyTail: "该信息在原文中出现频繁，是推动讨论的关键依据。",
    themeHeading: "## 第三部分：主题式详细拆解",
    themeCore: "核心论点：",
    themeStory: "案例/情节：",
    themeAction: "可操作建议：",
    themeQuote: "相关金句：",
    cardHeading: "## 第四部分：可视化知识卡片（参考）",
    cardColumns: ["步骤", "行动", "提示"],
    metaHeading: "## 第五部分：元分析",
    metaBullets: [
      "识别：抓取高频词与连续语义组成核心主题。",
      "删减：去除问候、停顿、重复措辞和明显离题内容。",
      "保留：保留带情绪色彩或数据信息的句子以支撑观点。",
      "质量：由于为离线推断，建议使用 AI 模型重新生成以获得更丰富的推理。",
    ],
  },
  en: {
    warning:
      "⚠️ Unable to reach APIMart. Generated a lightweight local summary for preview. Please retry later for the full AI output.",
    introHeading: "## Part 1: Core Theme",
    introGuide:
      "This snapshot is produced locally and only captures the major storyline and goal. The official AI model will provide richer reasoning once the network is available.",
    keypointHeading: "## Part 2: Key Insights",
    keypointTitle: (index) => `【Insight ${index + 1}】`,
    keypointCore: "Core idea: ",
    keypointQuote: "Quote: ",
    keypointWhy: "Why it matters: ",
    keypointWhyTail:
      "This sentence surfaced multiple times and drives the conversation forward.",
    themeHeading: "## Part 3: Thematic Deep Dive",
    themeCore: "Main argument: ",
    themeStory: "Supporting story: ",
    themeAction: "Actionable advice: ",
    themeQuote: "Signature quote: ",
    cardHeading: "## Part 4: Knowledge Cards",
    cardColumns: ["Step", "Action", "Key note"],
    metaHeading: "## Part 5: Meta Analysis",
    metaBullets: [
      "Signals: detected high-frequency words and glued them as the storyline.",
      "Trimmed: removed greetings, fillers, and obvious tangents.",
      "Kept: preserved sentences with data or emotions to keep the tone.",
      "Quality: this is a lightweight reconstruction; rerun with the AI model for production-ready insight.",
    ],
  },
};

type ChatCompletionChunk = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{ type?: string; text?: string; content?: string }>;
    };
  }>;
  error?: { message?: string };
};

function extractMessageContent(data: ChatCompletionChunk): string {
  const message = data.choices?.[0]?.message;
  if (!message?.content) return "";

  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part?.text || part?.content || "")
      .join("")
      .trim();
  }

  return "";
}

function detectLanguage(transcript: string): SupportedLang {
  return /[\u4e00-\u9fa5]/.test(transcript) ? "zh" : ("en" as SupportedLang);
}

function splitSentences(transcript: string, lang: SupportedLang) {
  const normalized = transcript.replace(/\r/g, "\n");
  const sentenceSplit =
    lang === "zh" ? /(?<=[。！？])/u : /(?<=[.!?])/;
  const sentences: string[] = [];

  normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line
        .split(sentenceSplit)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length) {
        sentences.push(...parts);
      } else if (line) {
        sentences.push(line);
      }
    });

  return sentences;
}

function truncateSentence(text: string, maxLength = 120) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildLocalSummary(transcript: string) {
  const lang = detectLanguage(transcript);
  const copy = FALLBACK_COPY[lang];
  const sentences = splitSentences(transcript, lang);
  const sentencesToUse = sentences.length
    ? sentences
    : [transcript.slice(0, 200)];

  const summaryBlock = sentencesToUse.slice(0, 6);
  const summaryText = summaryBlock
    .map((sentence) => sentence)
    .join(lang === "zh" ? "" : " ");

  const keyPointCount = Math.min(6, sentencesToUse.length);
  const keyPoints = sentencesToUse
    .slice(0, keyPointCount)
    .map((sentence, index) => {
      const clipped = truncateSentence(sentence, 160);
      return `${copy.keypointTitle(index)}\n${copy.keypointCore}${clipped}\n${copy.keypointQuote}“${clipped}”\n${copy.keypointWhy}${copy.keypointWhyTail}`;
    })
    .join("\n\n");

  const themeChunks = chunkArray(sentencesToUse.slice(keyPointCount), 3).slice(
    0,
    3
  );
  const themes = themeChunks
    .map((chunk, index) => {
      const [core = "-", story = "-", action = "-"] = chunk.map((item) =>
        truncateSentence(item, 200)
      );
      const quote = chunk[0] ? `“${truncateSentence(chunk[0], 80)}”` : "-";
      return `### ${lang === "zh" ? `主题 ${index + 1}` : `Theme ${index + 1}`}\n${copy.themeCore}${core}\n${copy.themeStory}${story}\n${copy.themeAction}${action}\n${copy.themeQuote}${quote}`;
    })
    .join("\n\n");

  const cardRows = chunkArray(sentencesToUse, 3)
    .slice(0, 3)
    .map((chunk, index) => {
      const [action = "-", detail = "-", hint = "-"] = chunk;
      const stepLabel =
        lang === "zh" ? `步骤 ${index + 1}` : `Step ${index + 1}`;
      return `| ${stepLabel} | ${truncateSentence(action, 120)} | ${truncateSentence(
        detail || hint,
        120
      )} |`;
    })
    .join("\n");

  const metaBullets = copy.metaBullets
    .map((line) => `- ${line}`)
    .join("\n");

  return [
    copy.introHeading,
    copy.introGuide,
    summaryText,
    copy.keypointHeading,
    keyPoints,
    copy.themeHeading,
    themes || "-",
    copy.cardHeading,
    `| ${copy.cardColumns.join(" | ")} |`,
    `| ${copy.cardColumns.map(() => "---").join(" | ")} |`,
    cardRows || "| - | - | - |",
    copy.metaHeading,
    metaBullets,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(req: Request) {
  let transcript: string | undefined;
  let prompt: string | undefined;

  try {
    const body = await req.json();
    transcript = body?.transcript;
    prompt = body?.prompt;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json(
      { error: "Transcript is required." },
      { status: 400 }
    );
  }

  const trimmedTranscript = transcript.trim();

  if (!trimmedTranscript) {
    return NextResponse.json(
      { error: "Transcript cannot be empty." },
      { status: 400 }
    );
  }

  const apiKey = process.env.APIMART_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "APIMART_API_KEY is not configured." },
      { status: 500 }
    );
  }

  const language = detectLanguage(trimmedTranscript);

  try {
    const response = await fetch(APIMART_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              typeof prompt === "string" && prompt.trim().length
                ? prompt.trim()
                : MEETING_SUMMARY_PROMPT,
          },
          {
            role: "user",
            content: trimmedTranscript,
          },
        ],
      }),
    });

    const data = (await response.json()) as ChatCompletionChunk;

    if (!response.ok) {
      const message =
        data?.error?.message || `Upstream error (${response.status}).`;
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const summary = extractMessageContent(data);

    if (!summary) {
      return NextResponse.json(
        { error: "No content returned from the AI model." },
        { status: 502 }
      );
    }

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("[trial-summarize]", error);
    const fallbackSummary = buildLocalSummary(trimmedTranscript);
    return NextResponse.json(
      {
        summary: fallbackSummary,
        warning: FALLBACK_COPY[language].warning,
        source: "local-fallback",
      },
      { status: 200 }
    );
  }
}
