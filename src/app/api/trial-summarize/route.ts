import { NextResponse } from "next/server";
import { MEETING_SUMMARY_PROMPT } from "@/lib/prompts";
import { getChatProviderLabel } from "@/config/chat-providers";
import {
  getChatProviderApiKey,
  getChatProviderEndpoint,
  getChatProviderModel,
  resolveChatProvider,
} from "@/lib/chat-providers";

type SupportedLang = "zh" | "en";

export const runtime = "nodejs";
export const maxDuration = 300;

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
      "⚠️ 暂时无法连接所选 AI 服务，以下为本地快速提炼，仅供预览，请稍后重试以生成正式版摘要。",
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
      "⚠️ Unable to reach the selected AI provider. Generated a lightweight local summary for preview. Please retry later for the full AI output.",
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

type StreamStatusPhase =
  | "starting"
  | "streaming"
  | "done"
  | "error";

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

const TRANSCRIPT_LIMIT_CHARS = 60_000;

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

const MAX_TRANSCRIPT_CHARS = 10_000;
const CHUNK_TARGET_CHARS = 3_500;
const MAX_CHUNKS = 16;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 240_000;
const DEFAULT_MAX_TOKENS = 1_200;
const DEFAULT_CHUNK_CONCURRENCY = 2;

function resolveChunkConcurrency() {
  const raw = process.env.TRIAL_SUMMARIZE_CHUNK_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_CHUNK_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_CHUNK_CONCURRENCY;
  return Math.max(1, Math.min(6, Math.floor(parsed)));
}

function resolveUpstreamTimeoutMs() {
  const raw = process.env.TRIAL_SUMMARIZE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_UPSTREAM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_UPSTREAM_TIMEOUT_MS;
  return Math.max(5_000, Math.min(300_000, Math.floor(parsed)));
}

function buildCondensedTranscript(transcript: string) {
  const lang = detectLanguage(transcript);
  const sentences = splitSentences(transcript, lang);
  if (!sentences.length) {
    return transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  }

  const joiner = lang === "zh" ? "" : " ";
  const selected: string[] = [];
  let size = 0;

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    const nextSize = size + piece.length + (selected.length ? joiner.length : 0);
    if (nextSize > MAX_TRANSCRIPT_CHARS) break;
    selected.push(piece);
    size = nextSize;
    if (selected.length >= 120) break;
  }

  return selected.length ? selected.join(joiner) : transcript.slice(0, MAX_TRANSCRIPT_CHARS);
}

function splitTranscriptIntoChunks(transcript: string) {
  const lang = detectLanguage(transcript);
  const sentences = splitSentences(transcript, lang);
  const joiner = lang === "zh" ? "" : " ";

  if (!sentences.length) {
    return [transcript.slice(0, CHUNK_TARGET_CHARS)];
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;

    const nextSize =
      size + piece.length + (current.length ? joiner.length : 0);

    if (nextSize > CHUNK_TARGET_CHARS && current.length) {
      chunks.push(current.join(joiner));
      if (chunks.length >= MAX_CHUNKS) return chunks;
      current = [piece];
      size = piece.length;
      continue;
    }

    current.push(piece);
    size = nextSize;
  }

  if (current.length && chunks.length < MAX_CHUNKS) {
    chunks.push(current.join(joiner));
  }

  return chunks;
}

function buildChunkPrompt({
  globalPrompt,
  language,
}: {
  globalPrompt: string;
  language: SupportedLang;
}) {
  const header =
    language === "zh"
      ? "你是一位会议纪要/需求提炼专家。请严格遵守【全局要求】。"
      : "You are a meeting-notes expert. Follow the GLOBAL REQUIREMENTS strictly.";

  const task =
    language === "zh"
      ? "你将收到会议逐字稿的一个分段。请仅总结这一段：提炼要点、决策、待办、风险/疑问，并保留关键数字与人名（如有）。输出 Markdown，尽量简洁，避免编造。"
      : "You will receive ONE chunk of a meeting transcript. Summarize ONLY this chunk: key points, decisions, action items, risks/questions, preserving numbers/names. Output Markdown, concise, and do not fabricate.";

  return `${header}\n\n【全局要求】\n${globalPrompt}\n\n【分段任务】\n${task}`.trim();
}

function buildMergePrompt({
  globalPrompt,
  language,
}: {
  globalPrompt: string;
  language: SupportedLang;
}) {
  const header =
    language === "zh"
      ? "你将收到多段“分段摘要”。请严格遵守【全局要求】，将它们合并为一份完整会议纪要。"
      : "You will receive multiple partial summaries. Follow the GLOBAL REQUIREMENTS strictly and merge them into one final report.";

  const requirements =
    language === "zh"
      ? "输出必须包含：核心主题、一句话总结、关键洞察、决策结论、行动项（Owner/DDL 如缺失请标注待补）、风险与未决问题。输出 Markdown，结构清晰，可直接复制。"
      : "Must include: core theme, one-line summary, key insights, decisions, action items (mark missing owner/deadline as TBD), risks and open questions. Output well-structured Markdown.";

  return `${header}\n\nGLOBAL REQUIREMENTS:\n${globalPrompt}\n\nMERGE TASK:\n${requirements}`.trim();
}

function buildPreviewPrompt({
  globalPrompt,
  language,
}: {
  globalPrompt: string;
  language: SupportedLang;
}) {
  const header =
    language === "zh"
      ? "你是一位会议纪要专家。请严格遵守【全局要求】。"
      : "You are a meeting-notes expert. Follow the GLOBAL REQUIREMENTS strictly.";

  const task =
    language === "zh"
      ? [
          "现在你只需要先生成“预览版”，用于让用户快速看到核心结论与行动项。",
          "仅输出两部分，必须使用以下固定标题：",
          "## 关键结论（预览）",
          "- 3~6 条要点，尽量具体，保留关键数字/人名（如有），避免编造",
          "## 行动项（预览）",
          "- 用 Markdown 表格输出：| 事项 | Owner | DDL | 备注 |（缺失信息用 TBD）",
          "不要输出其他任何内容。",
        ].join("\n")
      : [
          "Generate a QUICK PREVIEW only so users can see key takeaways and action items first.",
          "Output ONLY two sections with these exact headings:",
          "## Key Takeaways (Preview)",
          "- 3-6 bullets, keep numbers/names if present, do not fabricate",
          "## Action Items (Preview)",
          "- Markdown table: | Item | Owner | Due | Notes | (use TBD for missing)",
          "Do not output anything else.",
        ].join("\n");

  return `${header}\n\n【全局要求】\n${globalPrompt}\n\n【预览任务】\n${task}`.trim();
}

function splitPreviewSections(text: string, language: SupportedLang) {
  const raw = text.trim();
  if (!raw) return { keyTakeaways: "", actionItems: "" };

  const keyHeading =
    language === "zh"
      ? "## 关键结论（预览）"
      : "## Key Takeaways (Preview)";
  const actionHeading =
    language === "zh" ? "## 行动项（预览）" : "## Action Items (Preview)";

  const normalize = (value: string) => value.replace(/\r/g, "").trim();
  const normalized = normalize(raw);

  const keyIndex = normalized.indexOf(keyHeading);
  const actionIndex = normalized.indexOf(actionHeading);

  if (keyIndex === -1 && actionIndex === -1) {
    return { keyTakeaways: normalized, actionItems: "" };
  }

  if (keyIndex !== -1 && actionIndex !== -1) {
    const keyBlock = normalize(
      normalized.slice(keyIndex + keyHeading.length, actionIndex)
    );
    const actionBlock = normalize(
      normalized.slice(actionIndex + actionHeading.length)
    );
    return { keyTakeaways: keyBlock, actionItems: actionBlock };
  }

  if (keyIndex !== -1) {
    return {
      keyTakeaways: normalize(normalized.slice(keyIndex + keyHeading.length)),
      actionItems: "",
    };
  }

  return {
    keyTakeaways: "",
    actionItems: normalize(normalized.slice(actionIndex + actionHeading.length)),
  };
}

function isRetriableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("aborted") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("429") ||
    message.includes("rate") ||
    message.includes("503") ||
    message.includes("overloaded")
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callChatCompletion({
  endpoint,
  apiKey,
  model,
  prompt,
  userContent,
  timeoutMs,
  signal,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  userContent: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const abortListener = () => controller.abort();
    signal?.addEventListener("abort", abortListener, { once: true });
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: userContent },
          ],
          stream: false,
        }),
      });

      const raw = await response.text();
      let data: ChatCompletionChunk | null = null;
      try {
        data = raw ? (JSON.parse(raw) as ChatCompletionChunk) : null;
      } catch (parseError) {
        console.error("[trial-summarize] Failed to parse provider response", {
          message: (parseError as Error).message,
          preview: raw.slice(0, 200),
        });
      }

      if (!response.ok) {
        const message =
          data?.error?.message ||
          `Upstream error (${response.status}): ${raw.slice(0, 120)}`;
        const error = new Error(message);
        (error as any).status = response.status;
        throw error;
      }

      if (!data) {
        throw new Error("Upstream returned unparseable content.");
      }

      const content = extractMessageContent(data);
      if (!content) {
        throw new Error("No content returned from the AI model.");
      }

      return content;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetriableError(error)) {
        throw error;
      }
      await sleep(400 * attempt * attempt);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortListener);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Upstream error.");
}

type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
};

const DEFAULT_STREAM_IDLE_DONE_MS = 25_000;
const DEFAULT_STREAM_FIRST_DELTA_TIMEOUT_MS = 60_000;

function resolveStreamIdleDoneMs() {
  const raw = process.env.TRIAL_SUMMARIZE_STREAM_IDLE_DONE_MS?.trim();
  if (!raw) return DEFAULT_STREAM_IDLE_DONE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STREAM_IDLE_DONE_MS;
  return Math.max(5_000, Math.min(300_000, Math.floor(parsed)));
}

function resolveStreamFirstDeltaTimeoutMs() {
  const raw = process.env.TRIAL_SUMMARIZE_STREAM_FIRST_DELTA_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_STREAM_FIRST_DELTA_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STREAM_FIRST_DELTA_TIMEOUT_MS;
  return Math.max(5_000, Math.min(300_000, Math.floor(parsed)));
}

async function streamChatCompletion({
  endpoint,
  apiKey,
  model,
  prompt,
  userContent,
  timeoutMs,
  signal,
  onDelta,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  userContent: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}) {
  const controller = new AbortController();
  const abortListener = () => controller.abort();
  signal?.addEventListener("abort", abortListener, { once: true });
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const streamIdleDoneMs = resolveStreamIdleDoneMs();
  const streamFirstDeltaTimeoutMs = resolveStreamFirstDeltaTimeoutMs();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let firstDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  let abortedByIdle = false;
  let abortedByNoDelta = false;
  let hasAnyDelta = false;
  let hasMeaningfulDelta = false;

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortedByIdle = true;
      controller.abort();
    }, streamIdleDoneMs);
  };

  const armFirstDeltaTimeout = () => {
    if (firstDeltaTimer) clearTimeout(firstDeltaTimer);
    firstDeltaTimer = setTimeout(() => {
      abortedByNoDelta = true;
      controller.abort();
    }, streamFirstDeltaTimeoutMs);
  };

  const markDelta = (delta: string) => {
    if (!hasAnyDelta) {
      hasAnyDelta = true;
      if (firstDeltaTimer) {
        clearTimeout(firstDeltaTimer);
        firstDeltaTimer = null;
      }
      resetIdle();
    }
    if (!hasMeaningfulDelta && delta.trim().length > 0) {
      hasMeaningfulDelta = true;
    }
    if (delta.trim().length > 0) {
      resetIdle();
    }
  };

  try {
    armFirstDeltaTimeout();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userContent },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const raw = await response.text();
      let data: ChatCompletionStreamChunk | null = null;
      try {
        data = raw ? (JSON.parse(raw) as ChatCompletionStreamChunk) : null;
      } catch {
        data = null;
      }
      const message =
        data?.error?.message ||
        `Upstream error (${response.status}): ${raw.slice(0, 120)}`;
      const error = new Error(message);
      (error as any).status = response.status;
      throw error;
    }

    if (!response.body) {
      throw new Error("Upstream did not return a stream body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (signal?.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\n/);
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, "").trim();
          if (!line) continue;
          if (!line.startsWith("data:")) continue;
          const data = line.slice("data:".length).trim();
          if (!data) continue;
          if (data === "[DONE]") return;

          let json: ChatCompletionStreamChunk | null = null;
          try {
            json = JSON.parse(data) as ChatCompletionStreamChunk;
          } catch {
            json = null;
          }

          if (json?.error?.message) {
            throw new Error(json.error.message);
          }

          const choice = json?.choices?.[0];
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta.length) {
            markDelta(delta);
            onDelta(delta);
          }

          const finishReason = choice?.finish_reason;
          if (typeof finishReason === "string" && finishReason.length) {
            return;
          }
        }
      }
    } catch (error) {
      if (abortedByIdle && hasMeaningfulDelta) {
        return;
      }
      if (abortedByNoDelta) {
        throw new Error("Upstream did not stream any content in time.");
      }
      throw error;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (idleTimer) clearTimeout(idleTimer);
    if (firstDeltaTimer) clearTimeout(firstDeltaTimer);
    signal?.removeEventListener("abort", abortListener);
  }
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
  let providerInput: unknown;

  try {
    const body = await req.json();
    transcript = body?.transcript;
    prompt = body?.prompt;
    providerInput = body?.provider;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const streamRequested = true;

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

  if (trimmedTranscript.length > TRANSCRIPT_LIMIT_CHARS) {
    return NextResponse.json(
      {
        error: `Transcript is too long (>${TRANSCRIPT_LIMIT_CHARS} chars). Please shorten it.`,
        limitChars: TRANSCRIPT_LIMIT_CHARS,
        actualChars: trimmedTranscript.length,
      },
      { status: 413 }
    );
  }

  const provider = resolveChatProvider(providerInput);
  const providerLabel = getChatProviderLabel(provider);
  const apiKey = getChatProviderApiKey(provider);

  if (!apiKey) {
    return NextResponse.json(
      { error: `${providerLabel} 的 API 密钥尚未配置，请先填写环境变量。` },
      { status: 500 }
    );
  }

  const language = detectLanguage(trimmedTranscript);
  const model = getChatProviderModel(provider);
  const endpoint = getChatProviderEndpoint(provider);
  const upstreamTimeoutMs = resolveUpstreamTimeoutMs();
  const systemPrompt =
    typeof prompt === "string" && prompt.trim().length
      ? prompt.trim()
      : MEETING_SUMMARY_PROMPT;

  if (streamRequested) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const enqueue = (text: string) => {
          if (closed || req.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            closed = true;
          }
        };

        const send = (event: string, data: unknown) => {
          enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const sendStatus = (phase: StreamStatusPhase, extra?: any) => {
          send("status", { phase, ...extra });
        };

        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        };

        const abort = () => close();
        req.signal.addEventListener("abort", abort, { once: true });
        const pingId = setInterval(() => enqueue(": ping\n\n"), 20_000);

        const run = async () => {
          try {
            sendStatus("starting", { provider, model });
            sendStatus("streaming");
            await streamChatCompletion({
              endpoint,
              apiKey,
              model,
              prompt: systemPrompt,
              userContent: trimmedTranscript,
              timeoutMs: upstreamTimeoutMs,
              signal: req.signal,
              onDelta(text) {
                send("delta", { text });
              },
            });
            sendStatus("done");
            send("done", { ok: true, source: "single", provider, model });
          } catch (error) {
            if (req.signal.aborted) {
              return;
            }
            const isAbortError =
              error instanceof Error &&
              (error.name === "AbortError" ||
                error.message.toLowerCase().includes("aborted"));
            if (!isAbortError) {
              console.error("[trial-summarize][stream]", { provider, error });
            }
            const message =
              error instanceof Error ? error.message : "Upstream error.";
            sendStatus("error");
            send("error", { message, retriable: isRetriableError(error) });
          } finally {
            clearInterval(pingId);
            close();
          }
        };

        void run();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    return NextResponse.json({
      error:
        "This endpoint now streams by default. Please consume it as text/event-stream.",
    });
  } catch (error) {
    console.error("[trial-summarize]", { provider, error });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upstream error.",
      },
      { status: 200 }
    );
  }
}
