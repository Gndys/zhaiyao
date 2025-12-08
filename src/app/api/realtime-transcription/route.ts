import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";

const TENCENT_ASR_ENDPOINT = "asr.tencentcloudapi.com";
const TENCENT_ASR_VERSION = "2019-06-14";
const TENCENT_ASR_REGION = process.env.TENCENT_ASR_REGION || "ap-beijing";
const TENCENT_ASR_ENGINE_MODEL =
  process.env.TENCENT_ASR_ENGINE_MODEL || "16k_zh";
const TENCENT_ASR_POLL_INTERVAL_MS = Number(
  process.env.TENCENT_ASR_POLL_INTERVAL_MS || 3000
);
const TENCENT_ASR_POLL_TIMEOUT_MS = Number(
  process.env.TENCENT_ASR_POLL_TIMEOUT_MS || 45000
);

export async function POST(req: Request) {
  try {
    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;
    const bucket = process.env.OSS_BUCKET;
    const region = process.env.OSS_REGION;
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;

    if (!secretId || !secretKey) {
      return NextResponse.json(
        { error: "缺少腾讯云凭证，请先配置 TENCENT_SECRET_ID/SECRET_KEY。" },
        { status: 500 }
      );
    }

    if (!bucket || !region || !accessKeyId || !accessKeySecret) {
      return NextResponse.json(
        { error: "缺少 OSS 配置，请填写 OSS_BUCKET/OSS_REGION/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET。" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "请上传一段音频片段再开始转写。" },
        { status: 400 }
      );
    }

    if (file.size > MAX_CHUNK_SIZE) {
      return NextResponse.json(
        { error: "单段音频不能超过 8MB，请缩短分段长度后再试。" },
        { status: 400 }
      );
    }

    let uploadFile = file;

    if (!isWavFile(file)) {
      const converted = await transcodeToWav(file);
      if (!converted) {
        console.error("[realtime-transcription] transcode failed", {
          type: file.type,
          size: file.size,
        });
        return NextResponse.json(
          { error: "音频格式解析失败，请重试或更换浏览器。" },
          { status: 400 }
        );
      }
      uploadFile = converted;
    }

    const upload = await uploadToOSS(uploadFile);
    const transcript = await transcribeWithTencent(upload.url);

    return NextResponse.json({
      transcript: transcript || "",
      audioUrl: upload.url,
      objectKey: upload.key,
      vendor: "tencent-asr",
    });
  } catch (error) {
    console.error("[realtime-transcription] error", error);
    const message =
      error instanceof Error
        ? error.message
        : "实时转写失败，请稍后再试或联系管理员。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isWavFile(file: File) {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return type.includes("wav") || name.endsWith(".wav");
}

async function transcodeToWav(file: File) {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wavBuffer = await extractAudioAsWav(buffer);
    if (!wavBuffer) return null;

    const filename = ensureWavExtension(file.name || "chunk-audio");
    return new File([wavBuffer], filename, { type: "audio/wav" });
  } catch (error) {
    console.error("[realtime-transcription] transcode failed", error);
    return null;
  }
}

function ensureWavExtension(name: string) {
  if (name.toLowerCase().endsWith(".wav")) return name;
  return `${name.replace(/\.[^.]+$/, "")}.wav`;
}

async function extractAudioAsWav(buffer: Buffer) {
  return new Promise<Buffer | null>((resolve) => {
    const args = [
      "-i",
      "pipe:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      "pipe:1",
    ];

    const ffmpeg = spawn(FFMPEG_PATH, args);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => errors.push(chunk));
    ffmpeg.on("error", (error) => {
      console.error("[realtime-transcription] ffmpeg spawn failed", error);
      resolve(null);
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        console.error("[realtime-transcription] ffmpeg exited", {
          code,
          stderr: Buffer.concat(errors).toString(),
        });
        resolve(null);
      }
    });

    ffmpeg.stdin.on("error", (error) => {
      console.error("[realtime-transcription] ffmpeg stdin error", error);
    });

    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
  });
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

  return {
    key,
    url: `${publicBase}/${key}`,
  };
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

async function transcribeWithTencent(url: string) {
  const taskId = await createTencentRecTask(url);
  const data = await pollTencentTaskResult(taskId);
  const transcript = extractTencentTranscript(data);
  if (!transcript) {
    throw new Error("腾讯云语音识别未返回文本结果。");
  }

  return transcript;
}

async function createTencentRecTask(url: string) {
  const payload = {
    EngineModelType: TENCENT_ASR_ENGINE_MODEL,
    ChannelNum: 1,
    ResTextFormat: 0,
    SourceType: 0,
    Url: url,
  };

  const data = await tencentApiRequest("CreateRecTask", payload);
  const taskId =
    data?.Response?.Data?.TaskId ??
    data?.Response?.TaskId ??
    data?.TaskId ??
    data?.Data?.TaskId;

  if (taskId === undefined || taskId === null) {
    throw new Error("腾讯云创建转写任务失败：未返回 TaskId。");
  }
  return taskId;
}

async function pollTencentTaskResult(taskId: number | string) {
  const start = Date.now();
  while (true) {
    const data = await describeTencentTaskStatus(taskId);
    const resp = data?.Response || data;
    const status =
      resp?.Data?.Status ??
      resp?.Status ??
      resp?.StatusStr ??
      resp?.Data?.StatusStr;

    if (status === 2 || status === "success") {
      return data;
    }
    if (status === 3 || status === "failed" || status === "error") {
      const message =
        resp?.Data?.ErrorMsg ||
        resp?.Error?.Message ||
        resp?.ErrorMsg ||
        "腾讯云转写任务失败。";
      throw new Error(message);
    }

    if (Date.now() - start > TENCENT_ASR_POLL_TIMEOUT_MS) {
      throw new Error("腾讯云转写超时，请稍后重试。");
    }

    await wait(TENCENT_ASR_POLL_INTERVAL_MS);
  }
}

async function describeTencentTaskStatus(taskId: number | string) {
  const payload = {
    TaskId: Number(taskId),
  };
  return tencentApiRequest("DescribeTaskStatus", payload);
}

async function tencentApiRequest(
  action: string,
  payload: Record<string, any>
) {
  const secretId = process.env.TENCENT_SECRET_ID!;
  const secretKey = process.env.TENCENT_SECRET_KEY!;
  const sessionToken = process.env.TENCENT_SESSION_TOKEN;
  const body = JSON.stringify(payload);
  const { authorization, timestamp } = signTencentRequest(
    action,
    body,
    secretId,
    secretKey
  );

  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": "application/json; charset=utf-8",
    Host: TENCENT_ASR_ENDPOINT,
    "X-TC-Action": action,
    "X-TC-Version": TENCENT_ASR_VERSION,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Region": TENCENT_ASR_REGION,
  };

  if (sessionToken) {
    headers["X-TC-Token"] = sessionToken;
  }

  const response = await fetch(`https://${TENCENT_ASR_ENDPOINT}`, {
    method: "POST",
    headers,
    body,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    throw new Error(
      `腾讯云 ASR 请求失败：${response.status} ${response.statusText}`
    );
  }

  const error =
    data?.Response?.Error || data?.Error || data?.Response?.Data?.Error;
  if (error) {
    throw new Error(
      typeof error?.Message === "string"
        ? error.Message
        : JSON.stringify(error)
    );
  }

  return data;
}

function signTencentRequest(
  action: string,
  body: string,
  secretId: string,
  secretKey: string
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:application/json; charset=utf-8\nhost:${TENCENT_ASR_ENDPOINT}\n`,
    "content-type;host",
    hashSha256(body),
  ].join("\n");

  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    `${date}/asr/tc3_request`,
    hashSha256(canonicalRequest),
  ].join("\n");

  const secretDate = hmacSha256(`TC3${secretKey}`, date, "buffer");
  const secretService = hmacSha256(secretDate, "asr", "buffer");
  const secretSigning = hmacSha256(secretService, "tc3_request", "buffer");
  const signature = hmacSha256(secretSigning, stringToSign, "hex");

  const authorization = [
    "TC3-HMAC-SHA256 Credential=",
    `${secretId}/${date}/asr/tc3_request`,
    ", SignedHeaders=content-type;host, Signature=",
    signature,
  ].join("");

  return { authorization, timestamp };
}

function hashSha256(payload: string) {
  return createHash("sha256").update(payload).digest("hex");
}

function hmacSha256(
  key: string | Buffer,
  payload: string,
  encoding: "hex" | "buffer" = "hex"
) {
  const digest = createHmac("sha256", key).update(payload);
  return encoding === "buffer" ? digest.digest() : digest.digest("hex");
}

function extractTencentTranscript(data: any) {
  if (!data) return "";
  const resp = data.Response || data;
  const result =
    resp?.Data?.Result ||
    resp?.Result ||
    resp?.Data?.ResultText ||
    resp?.ResultText;
  return typeof result === "string" ? result : "";
}

function wait(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
