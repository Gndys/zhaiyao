import { NextResponse } from "next/server";
import { getChatProviderLabel } from "@/config/chat-providers";
import {
  getChatProviderApiKey,
  getChatProviderEndpoint,
  getChatProviderModel,
  resolveChatProvider,
} from "@/lib/chat-providers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const providerInput = searchParams.get("provider") ?? undefined;
  const provider = resolveChatProvider(providerInput);
  const providerLabel = getChatProviderLabel(provider);
  const apiKey = getChatProviderApiKey(provider);

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        reason: `${providerLabel} 的 API 密钥未配置。`,
      },
      { status: 500 }
    );
  }

  const model = getChatProviderModel(provider);
  const payload = {
    model,
    temperature: 0,
    max_tokens: 8,
    messages: [
      {
        role: "system",
        content: "You are a lightweight health-check probe. Reply with OK.",
      },
      {
        role: "user",
        content: "ping",
      },
    ],
    stream: false,
  };

  const start = Date.now();
  try {
    const response = await fetch(getChatProviderEndpoint(provider), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      body: JSON.stringify(payload),
    });

    const elapsed = Date.now() - start;
    const raw = await response.text();
    let data: { error?: { message?: string } } | null = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("[trial-summarize][health] parse failed", {
        provider,
        message: (error as Error).message,
        preview: raw.slice(0, 120),
      });
    }

    if (!response.ok) {
      const reason =
        data?.error?.message ||
        `${providerLabel} responded with status ${response.status}. ${raw.slice(0, 120)}`;
      return NextResponse.json(
        { ok: false, reason, upstreamStatus: response.status },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          reason: `${providerLabel} 返回了无法识别的内容，请稍后重试或联系支持。`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      latency: elapsed,
      model,
      provider,
      message: `${providerLabel} responded successfully.`,
    });
  } catch (error) {
    console.error("[trial-summarize][health]", { provider, error });
    return NextResponse.json(
      { ok: false, reason: `Unable to reach ${providerLabel}.` },
      { status: 503 }
    );
  }
}
