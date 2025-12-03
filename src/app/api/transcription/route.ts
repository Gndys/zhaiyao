import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";
import { insertAudioUpload } from "@/models/audio-upload";
import { getUserUuid } from "@/services/user";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const REQUIRED_ENV_VARS = [
  "APIMART_API_KEY",
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
];

const APIMART_TRANSCRIPTION_ENDPOINT =
  process.env.APIMART_WHISPER_ENDPOINT?.replace(/\/$/, "") ||
  "https://api.apimart.ai/v1/audio/transcriptions";
const APIMART_TRANSCRIPTION_MODEL =
  process.env.APIMART_WHISPER_MODEL || "openai/whisper-1";
const APIMART_TRANSCRIPTION_LANGUAGE =
  process.env.APIMART_WHISPER_LANGUAGE || "";
const APIMART_TRANSCRIPTION_PROMPT =
  process.env.APIMART_WHISPER_PROMPT || "";

export async function POST(req: Request) {
  let uploadResult: { url: string; key: string } | undefined;
  let user_uuid = "";
  let recordedHistory = false;
  let safeFilename = "audio-file";

  const recordUpload = async (status: string, errorMessage?: string) => {
    if (!uploadResult || recordedHistory) {
      return;
    }

    recordedHistory = true;

    try {
      await insertAudioUpload({
        user_uuid: user_uuid || "",
        filename: safeFilename,
        audio_url: uploadResult.url,
        object_key: uploadResult.key,
        status,
        error_message: errorMessage,
      });
    } catch (recordError) {
      console.error("[transcription] record upload history failed", recordError);
    }
  };

  try {
    validateEnv();
    user_uuid = await getUserUuid();
    const formData = await req.formData();
    const file = formData.get("file");
    console.log("[transcription] incoming request");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "请选择一个音频文件后再上传。" },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("audio/")) {
      return NextResponse.json(
        { error: "仅支持音频文件，请重新选择。" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "文件体积超出限制，请压缩到 50MB 以内再试。" },
        { status: 400 }
      );
    }

    safeFilename = file.name || safeFilename;

    console.log("[transcription] file validated", {
      filename: file.name,
      size: file.size,
      type: file.type,
    });

    uploadResult = await uploadToOSS(file);
    console.log("[transcription] uploaded to OSS", uploadResult);
    const transcription = await transcribeWithApimart(file);
    console.log("[transcription] apimart response", {
      hasTranscript: Boolean(transcription.transcript),
    });

    await recordUpload("completed");

    return NextResponse.json({
      ...transcription,
      audioUrl: uploadResult.url,
      objectKey: uploadResult.key,
    });
  } catch (error) {
    console.error("[transcription] error", error);
    const message =
      error instanceof Error
        ? error.message
        : "转写失败，请稍后重试或联系管理员。";

    await recordUpload("failed", message);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "转写接口为同步模式，无需查询任务状态。" },
    { status: 405 }
  );
}

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`缺少必填环境变量：${missing.join(", ")}`);
  }
}

async function uploadToOSS(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const key = buildObjectKey(file.name);
  const contentType = file.type || "application/octet-stream";
  const bucket = process.env.OSS_BUCKET!;
  const region = process.env.OSS_REGION!;
  const endpoint = `https://${bucket}.${region}.aliyuncs.com/${encodeURI(
    key
  )}`;
  const date = new Date().toUTCString();

  const headers: Record<string, string> = {
    Date: date,
    "Content-Type": contentType,
    "Content-Length": buffer.length.toString(),
  };

  if (
    !process.env.OSS_DISABLE_PUBLIC_ACL &&
    !process.env.OSS_PUBLIC_BASE_URL
  ) {
    headers["x-oss-object-acl"] =
      process.env.OSS_OBJECT_ACL || "public-read";
  }

  const canonicalResource = `/${bucket}/${key}`;
  const canonicalHeaders = Object.keys(headers)
    .filter((key) => key.toLowerCase().startsWith("x-oss-"))
    .sort()
    .map((key) => `${key.toLowerCase()}:${headers[key]}`)
    .join("\n");

  const canonicalString = [
    "PUT",
    "",
    contentType,
    date,
    canonicalHeaders ? `${canonicalHeaders}\n${canonicalResource}` : canonicalResource,
  ].join("\n");

  const signature = createHmac(
    "sha1",
    process.env.OSS_ACCESS_KEY_SECRET!
  )
    .update(canonicalString)
    .digest("base64");

  headers.Authorization = `OSS ${process.env.OSS_ACCESS_KEY_ID!}:${signature}`;

  console.log("[transcription] uploading to OSS", {
    key,
    bucket,
    endpoint,
    acl: headers["x-oss-object-acl"] || "bucket-default",
  });

  const response = await fetch(endpoint, {
    method: "PUT",
    headers,
    body: buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `音频上传失败：${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const publicBase =
    process.env.OSS_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    `https://${bucket}.${region}.aliyuncs.com`;

  const result = {
    key,
    url: `${publicBase}/${key}`,
  };

  return result;
}

function buildObjectKey(filename: string) {
  const ext = filename.split(".").pop();
  const safeBase = filename
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const timestamp = Date.now();
  const randomId = randomUUID().replace(/-/g, "").slice(0, 8);
  return `uploads/audio/${timestamp}-${randomId}${
    safeBase ? `-${safeBase}` : ""
  }${ext ? `.${ext}` : ""}`;
}

async function transcribeWithApimart(file: File) {
  const apiKey = process.env.APIMART_API_KEY!;
  const formData = new FormData();
  formData.append("file", file, file.name || "audio-file");
  formData.append("model", APIMART_TRANSCRIPTION_MODEL);
  formData.append("response_format", "json");

  if (APIMART_TRANSCRIPTION_LANGUAGE) {
    formData.append("language", APIMART_TRANSCRIPTION_LANGUAGE);
  }

  if (APIMART_TRANSCRIPTION_PROMPT) {
    formData.append("prompt", APIMART_TRANSCRIPTION_PROMPT);
  }

  const response = await fetch(APIMART_TRANSCRIPTION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    const message =
      data?.message ||
      data?.error ||
      data?.detail ||
      response.statusText ||
      "Apimart Whisper 请求失败";
    console.error("[transcription] apimart error", {
      status: response.status,
      body: data,
    });
    throw new Error(
      typeof message === "string" ? message : JSON.stringify(message)
    );
  }

  const transcript = extractApimartTranscript(data);
  if (!transcript) {
    throw new Error("Apimart Whisper 未返回文本结果。");
  }

  return {
    transcript,
    vendor: "apimart-whisper",
    raw: data,
  };
}

type ApimartSegment = {
  text?: string;
  content?: string;
};

function extractApimartTranscript(data: any) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data.text === "string") return data.text;
  if (typeof data.transcription === "string") return data.transcription;
  if (typeof data.result === "string") return data.result;

  if (data?.data) {
    if (typeof data.data === "string") return data.data;
    if (typeof data.data.text === "string") return data.data.text;
    if (typeof data.data.transcription === "string") {
      return data.data.transcription;
    }
  }

  const choices = data?.choices;
  if (Array.isArray(choices) && choices.length) {
    const message = choices[0]?.message;
    if (typeof message?.content === "string") {
      return message.content;
    }
  }

  if (Array.isArray(data?.segments)) {
    return (data.segments as ApimartSegment[])
      .map((segment) => segment?.text || segment?.content)
      .filter(Boolean)
      .join("\n");
  }

  return "";
}
