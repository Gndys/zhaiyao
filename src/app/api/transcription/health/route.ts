import { NextResponse } from "next/server";
import { APIMART_ENDPOINT, resolveApimartModel } from "@/lib/apimart";

const REQUIRED_ENV_VARS = [
  "APIMART_API_KEY",
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
];

type IssueType = "code" | "config" | "service" | "network";

type LinkStatus = {
  ok: boolean;
  latency?: number;
  reason?: string;
  issue?: IssueType;
};

const PROBE_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? 5000);

export async function GET() {
  const envStatus = checkEnvironment();
  const envOk = envStatus.ok;

  const [ossStatus, apimartStatus] = await Promise.all([
    envOk
      ? checkOssConnectivity()
      : Promise.resolve<LinkStatus>({
          ok: false,
          issue: "config",
          reason: "缺少 OSS 配置",
        }),
    envOk
      ? checkApimartConnectivity()
      : Promise.resolve<LinkStatus>({
          ok: false,
          issue: "config",
          reason: "缺少 APIMart 配置",
        }),
  ]);

  const overallOk = envStatus.ok && ossStatus.ok && apimartStatus.ok;

  return NextResponse.json({
    ok: overallOk,
    env: envStatus,
    oss: ossStatus,
    apimart: apimartStatus,
    timestamp: Date.now(),
  });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = PROBE_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function checkEnvironment(): LinkStatus {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length) {
    return {
      ok: false,
      issue: "config",
      reason: `缺少环境变量：${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

async function checkOssConnectivity(): Promise<LinkStatus> {
  const bucket = process.env.OSS_BUCKET!;
  const region = process.env.OSS_REGION!;
  const base =
    process.env.OSS_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    `https://${bucket}.${region}.aliyuncs.com`;
  const probeUrl = `${base}/?x-oss-process=meta&ts=${Date.now()}`;

  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      probeUrl,
      { method: "HEAD", cache: "no-store" },
      PROBE_TIMEOUT_MS
    );
    const latency = Date.now() - start;
    if (!response.ok) {
      return {
        ok: false,
        latency,
        issue: "service",
        reason: `OSS 响应状态 ${response.status}`,
      };
    }
    return { ok: true, latency };
  } catch (error) {
    console.error("[transcription][health] OSS check failed", error);
    const timeout =
      error instanceof Error && error.name === "AbortError"
        ? "（超时）"
        : "";
    return {
      ok: false,
      issue: "service",
      reason: `无法连接 OSS 域名${timeout}，请检查网络或白名单。`,
    };
  }
}

async function checkApimartConnectivity(): Promise<LinkStatus> {
  const apiKey = process.env.APIMART_API_KEY!;
  const model = resolveApimartModel();
  const payload = {
    model,
    temperature: 0,
    stream: false,
    messages: [
      {
        role: "system",
        content: "You are a lightweight probe. Reply with PONG.",
      },
      { role: "user", content: "ping" },
    ],
  };

  const start = Date.now();
  try {
    const response = await fetchWithTimeout(APIMART_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    const latency = Date.now() - start;
    const raw = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        latency,
        issue: "service",
        reason:
          raw.slice(0, 120) ||
          `APIMart 返回状态 ${response.status}`,
      };
    }

    return { ok: true, latency };
  } catch (error) {
    console.error("[transcription][health] APIMart check failed", error);
    const timeout =
      error instanceof Error && error.name === "AbortError"
        ? "（超时）"
        : "";
    return {
      ok: false,
      issue: "service",
      reason: `无法连接 APIMart${timeout}，请检查网络或密钥。`,
    };
  }
}
