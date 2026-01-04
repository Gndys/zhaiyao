type PushPlusPayload = {
  token: string;
  title?: string;
  content: string;
  template?: "html" | "txt" | "json" | "markdown";
};

const DEFAULT_ENDPOINT = "https://www.pushplus.plus/send";
const DEFAULT_TEMPLATE: PushPlusPayload["template"] = "markdown";
const DEFAULT_MAX_CHARS = 6000;

function resolveMaxChars() {
  const raw = process.env.PUSHPLUS_MAX_CHARS?.trim();
  if (!raw) return DEFAULT_MAX_CHARS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_CHARS;
  return Math.max(500, Math.min(20_000, Math.floor(parsed)));
}

function truncateContent(content: string) {
  const maxChars = resolveMaxChars();
  if (content.length <= maxChars) return { content, truncated: false };
  const head = content.slice(0, Math.floor(maxChars * 0.7));
  const tail = content.slice(-Math.floor(maxChars * 0.25));
  const note = `\n\n---\n（已截断：原始长度 ${content.length} 字符）`;
  return { content: `${head}\n\n...\n\n${tail}${note}`, truncated: true };
}

function resolveTemplate(): PushPlusPayload["template"] {
  const raw = process.env.PUSHPLUS_TEMPLATE?.trim().toLowerCase();
  if (raw === "html" || raw === "txt" || raw === "json" || raw === "markdown") {
    return raw;
  }
  return DEFAULT_TEMPLATE;
}

function resolveEndpoint() {
  const configured = process.env.PUSHPLUS_ENDPOINT?.trim();
  if (!configured) return DEFAULT_ENDPOINT;
  return configured.replace(/\/+$/, "");
}

export async function pushPlusSendReport(input: {
  title: string;
  content: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
}) {
  const token = process.env.PUSHPLUS_TOKEN?.trim();
  if (!token) return { ok: false as const, skipped: true as const };

  const template = resolveTemplate();
  const metaLines = input.meta
    ? Object.entries(input.meta)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `- ${key}: ${String(value)}`)
        .join("\n")
    : "";

  const fullContent = metaLines
    ? `${metaLines}\n\n---\n\n${input.content}`
    : input.content;

  const truncated = truncateContent(fullContent);
  const payload: PushPlusPayload = {
    token,
    title: input.title,
    content: truncated.content,
    template,
  };

  try {
    const response = await fetch(resolveEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    if (!response.ok) {
      return {
        ok: false as const,
        skipped: false as const,
        status: response.status,
        error: raw.slice(0, 200),
      };
    }

    return { ok: true as const, skipped: false as const, truncated: truncated.truncated };
  } catch (error) {
    return {
      ok: false as const,
      skipped: false as const,
      error: error instanceof Error ? error.message : "PushPlus error.",
    };
  }
}

