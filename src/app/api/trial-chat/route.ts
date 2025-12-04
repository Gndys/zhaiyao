import { NextResponse } from "next/server";
import { getChatProviderLabel } from "@/config/chat-providers";
import {
  getChatProviderApiKey,
  getChatProviderEndpoint,
  getChatProviderModel,
  resolveChatProvider,
} from "@/lib/chat-providers";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const CONTEXT_MAX_CHARS = 10000;

function normalizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const allowedRoles = new Set(["system", "user", "assistant"]);
  return input
    .map((item) => {
      if (
        item &&
        typeof item === "object" &&
        allowedRoles.has((item as ChatMessage).role) &&
        typeof (item as ChatMessage).content === "string"
      ) {
        return {
          role: (item as ChatMessage).role,
          content: (item as ChatMessage).content,
        };
      }
      return null;
    })
    .filter(Boolean) as ChatMessage[];
}

export async function POST(req: Request) {
  let providerInput: unknown;
  let transcriptContext = "";

  let payload: unknown;
  try {
    payload = await req.json();
    providerInput = (payload as { provider?: unknown })?.provider;
    transcriptContext =
      typeof (payload as { contextTranscript?: unknown })?.contextTranscript ===
      "string"
        ? (
            payload as {
              contextTranscript?: string;
            }
          ).contextTranscript!.trim()
        : "";
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const provider = resolveChatProvider(providerInput);
  const providerLabel = getChatProviderLabel(provider);
  const apiKey = getChatProviderApiKey(provider);

  if (!apiKey) {
    return NextResponse.json(
      { error: `${providerLabel} API key is not configured.` },
      { status: 500 }
    );
  }

  const userMessages = normalizeMessages((payload as any)?.messages);

  if (!userMessages.length) {
    return NextResponse.json(
      { error: "At least one message is required." },
      { status: 400 }
    );
  }

  const systemPrompt: ChatMessage = {
    role: "system",
    content:
      "You are the ZhaiYao assistant that helps users troubleshoot meeting summarization and transcription workflows. Respond concisely in the same language as the user. When referencing steps, keep them short and practical.",
  };
  const trimmedContext =
    transcriptContext.length > CONTEXT_MAX_CHARS
      ? transcriptContext.slice(transcriptContext.length - CONTEXT_MAX_CHARS)
      : transcriptContext;

  const contextPrompt = trimmedContext
    ? ({
        role: "system",
        content: `Below is the latest meeting transcript provided by the user. Use it as factual context when answering, quote the user's language, and mention when information is inferred. Transcript:\n${trimmedContext}`,
      } as ChatMessage)
    : null;

  const model = getChatProviderModel(provider);
  const messages = [systemPrompt];
  if (contextPrompt) {
    messages.push(contextPrompt);
  }
  messages.push(...userMessages);

  const upstreamPayload = {
    model,
    temperature: 0.4,
    stream: false,
    messages,
    max_tokens: 400,
    top_p: 0.9,
  };

  try {
    const response = await fetch(getChatProviderEndpoint(provider), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      body: JSON.stringify(upstreamPayload),
    });

    const raw = await response.text();
    let data: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("[trial-chat] Failed to parse response", {
        message: (error as Error).message,
        preview: raw.slice(0, 200),
      });
    }

    if (!response.ok) {
      const reason =
        data?.error?.message ||
        `${providerLabel} error (${response.status}): ${raw.slice(0, 120)}`;
      return NextResponse.json(
        { error: reason },
        { status: response.status }
      );
    }

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "抱歉，我暂时无法回答，请稍后再试。";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("[trial-chat]", { provider, error });
    return NextResponse.json(
      {
        error: `Unable to reach ${providerLabel}. Please try again later.`,
      },
      { status: 503 }
    );
  }
}
