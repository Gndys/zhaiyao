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
  let shouldStream = false;
  let hasTranscriptContext = false;

  let payload: unknown;
  try {
    payload = await req.json();
    providerInput = (payload as { provider?: unknown })?.provider;
    shouldStream =
      typeof (payload as { stream?: unknown })?.stream === "boolean"
        ? Boolean((payload as { stream?: boolean }).stream)
        : false;
    transcriptContext =
      typeof (payload as { contextTranscript?: unknown })?.contextTranscript ===
      "string"
        ? (
            payload as {
              contextTranscript?: string;
            }
          ).contextTranscript!.trim()
        : "";
    hasTranscriptContext =
      typeof (payload as { hasTranscriptContext?: unknown })
        ?.hasTranscriptContext === "boolean"
        ? Boolean(
            (payload as { hasTranscriptContext?: boolean }).hasTranscriptContext
          )
        : false;
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

  const systemPrompt: ChatMessage = hasTranscriptContext
    ? {
        role: "system",
        content:
          "You are the ZhaiYao assistant. Use ONLY the provided meeting transcript for facts. If asked for anything not in the transcript, say you can only answer based on the transcript and invite the user to paste more details. Keep replies concise and in the user's language.",
      }
    : {
        role: "system",
        content:
          "You are the ZhaiYao assistant. The user has not provided a meeting transcript. Give concise, generic guidance and invite the user to paste or upload the transcript for precise answers. Do not fabricate meeting-specific facts without a transcript.",
      };
  const trimmedContext =
    transcriptContext.length > CONTEXT_MAX_CHARS
      ? transcriptContext.slice(transcriptContext.length - CONTEXT_MAX_CHARS)
      : transcriptContext;

  const contextPrompt = trimmedContext
    ? ({
        role: "system",
        content: `Below is the latest meeting transcript provided by the user. Use ONLY this as factual context when answering. If a question is unrelated or missing, reply that you can only answer based on the transcript. Transcript:\n${trimmedContext}`,
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
    stream: shouldStream,
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

    if (shouldStream) {
      if (!response.ok || !response.body) {
        const reason = await response.text();
        return NextResponse.json(
          {
            error:
              reason ||
              `${providerLabel} error (${response.status}): cannot stream response.`,
          },
          { status: response.status }
        );
      }

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader();
          let buffer = "";
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;
                const payloadStr = trimmed.slice(5).trim();
                if (payloadStr === "[DONE]") {
                  continue;
                }
                try {
                  const json = JSON.parse(payloadStr) as {
                    choices?: Array<{
                      delta?: { content?: string };
                      message?: { content?: string };
                    }>;
                  };
                  const delta =
                    json.choices?.[0]?.delta?.content ||
                    json.choices?.[0]?.message?.content ||
                    "";
                  if (delta) {
                    controller.enqueue(encoder.encode(delta));
                  }
                } catch (error) {
                  // ignore malformed chunk
                  continue;
                }
              }
            }
            if (buffer.length) {
              try {
                const json = JSON.parse(buffer.trim()) as {
                  choices?: Array<{
                    delta?: { content?: string };
                    message?: { content?: string };
                  }>;
                };
                const delta =
                  json.choices?.[0]?.delta?.content ||
                  json.choices?.[0]?.message?.content ||
                  "";
                if (delta) {
                  controller.enqueue(encoder.encode(delta));
                }
              } catch {
                // ignore trailing buffer
              }
            }
          } catch (error) {
            console.error("[trial-chat][stream]", error);
            controller.enqueue(
              encoder.encode("⚠️ 流式响应异常，请稍后再试。")
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

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
