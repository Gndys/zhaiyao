import { NextResponse } from "next/server";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { insertAudioUpload } from "@/models/audio-upload";
import { getUserUuid } from "@/services/user";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const AUDIO_FILE_EXTENSIONS =
  /\.(mp3|m4a|wav|flac|aac|ogg|wma|webm)$/i;
const VIDEO_FILE_EXTENSIONS = /\.(mp4|mkv|mov|avi|flv|webm)$/i;

const AUDIO_OPTIMIZATION_ENABLED =
  process.env.AUDIO_OPTIMIZATION_ENABLED !== "false";
const AUDIO_OPTIMIZATION_THRESHOLD = Number(
  process.env.AUDIO_OPTIMIZATION_THRESHOLD ?? 15 * 1024 * 1024
);
const AUDIO_OPTIMIZATION_BITRATE =
  process.env.AUDIO_OPTIMIZATION_TARGET_BITRATE || "48k";
const AUDIO_OPTIMIZATION_SAMPLE_RATE =
  process.env.AUDIO_OPTIMIZATION_TARGET_SAMPLE_RATE || "16000";
const AUDIO_OPTIMIZATION_OUTPUT_FORMAT =
  process.env.AUDIO_OPTIMIZATION_OUTPUT_FORMAT || "mp3";
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const AUDIO_SEGMENT_ENABLED =
  process.env.AUDIO_SEGMENT_ENABLED === "true";
const AUDIO_SEGMENT_MIN_SIZE = Number(
  process.env.AUDIO_SEGMENT_MIN_SIZE ?? 18 * 1024 * 1024
);
const AUDIO_SEGMENT_DURATION = Number(
  process.env.AUDIO_SEGMENT_DURATION ?? 600
);
const AUDIO_SEGMENT_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUDIO_SEGMENT_CONCURRENCY ?? 4)
);

type TranscriptionVendor = "tencent" | "apimart";
const TRANSCRIPTION_VENDOR = (process.env.TRANSCRIPTION_VENDOR ||
  "tencent") as TranscriptionVendor;

const APIMART_TRANSCRIPTION_ENDPOINT =
  process.env.APIMART_WHISPER_ENDPOINT?.replace(/\/$/, "") ||
  "https://api.apimart.ai/v1/audio/transcriptions";
const APIMART_TRANSCRIPTION_MODEL =
  process.env.APIMART_WHISPER_MODEL || "openai/whisper-1";
const APIMART_TRANSCRIPTION_LANGUAGE =
  process.env.APIMART_WHISPER_LANGUAGE || "";
const APIMART_TRANSCRIPTION_PROMPT =
  process.env.APIMART_WHISPER_PROMPT || "";

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
  let uploadResult: { url: string; key: string } | undefined;
  let user_uuid = "";
  let recordedHistory = false;
  let safeFilename = "audio-file";

  const recordUpload = async (status: string, errorMessage?: string) => {
    if (!isHistoryEnabled()) {
      return;
    }
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
    const vendor = getTranscriptionVendor();
    validateEnv(vendor);
    user_uuid = await getUserUuid();
    const formData = await req.formData();
    const fileEntry = formData.get("file");
    const remoteUrlEntry = formData.get("fileUrl");
    const remoteUrl =
      typeof remoteUrlEntry === "string" ? remoteUrlEntry.trim() : "";

    let fileSource: "upload" | "url" = "upload";
    let file: File | null = null;

    if (fileEntry && fileEntry instanceof File) {
      file = fileEntry;
    } else if (remoteUrl) {
      fileSource = "url";
      file = await fetchRemoteFile(remoteUrl);
    }

    console.log("[transcription] incoming request");

    if (!file) {
      return NextResponse.json(
        { error: "请上传音频文件或提供一个可访问的音频链接。" },
        { status: 400 }
      );
    }

    let transcriptionFile: File = file;
    let convertedFromVideo = false;

    if (!isAudioFile(transcriptionFile) && isVideoFile(transcriptionFile)) {
      transcriptionFile = await convertVideoToWav(transcriptionFile);
      convertedFromVideo = true;
    }

    if (!isAudioFile(transcriptionFile)) {
      return NextResponse.json(
        { error: "仅支持音频文件，请重新选择或检查链接。" },
        { status: 400 }
      );
    }

    if (transcriptionFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "文件体积超出限制，请压缩到 50MB 以内再试。" },
        { status: 400 }
      );
    }

    transcriptionFile = await optimizeAudioForTranscription(transcriptionFile);
    safeFilename = transcriptionFile.name || safeFilename;

    console.log("[transcription] file validated", {
      filename: transcriptionFile.name,
      size: transcriptionFile.size,
      type: transcriptionFile.type,
      source: fileSource,
      convertedFromVideo,
    });

    if (fileSource === "upload") {
      uploadResult = await uploadToOSS(transcriptionFile);
      console.log("[transcription] uploaded to OSS", uploadResult);
    } else {
      uploadResult = buildUploadResultFromUrl(remoteUrl);
      console.log("[transcription] using remote OSS object", uploadResult);
    }
    let transcription:
      | Awaited<ReturnType<typeof transcribeWithTencent>>
      | Awaited<ReturnType<typeof transcribeSegmentsWithApimart>>;

    if (vendor === "tencent") {
      transcription = await transcribeWithTencent(uploadResult.url);
    } else {
      const segmentedFiles = await segmentAudioFile(transcriptionFile);
      transcription = await transcribeSegmentsWithApimart(segmentedFiles);
    }
    console.log("[transcription] transcription response", {
      vendor: transcription.vendor,
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

function isHistoryEnabled() {
  if (process.env.DISABLE_AUDIO_UPLOAD_HISTORY === "true") {
    return false;
  }
  return Boolean(process.env.DATABASE_URL);
}

function getTranscriptionVendor(): TranscriptionVendor {
  const value = (TRANSCRIPTION_VENDOR || "tencent").toLowerCase();
  return value === "apimart" ? "apimart" : "tencent";
}

export async function GET() {
  return NextResponse.json(
    { error: "转写接口为同步模式，无需查询任务状态。" },
    { status: 405 }
  );
}

function validateEnv(vendor: TranscriptionVendor) {
  const baseVars = [
    "OSS_REGION",
    "OSS_BUCKET",
    "OSS_ACCESS_KEY_ID",
    "OSS_ACCESS_KEY_SECRET",
  ];
  const vendorVars =
    vendor === "tencent"
      ? ["TENCENT_SECRET_ID", "TENCENT_SECRET_KEY"]
      : ["APIMART_API_KEY"];
  const missing = [...baseVars, ...vendorVars].filter(
    (key) => !process.env[key]
  );
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
    transcript: normalizeTranscriptText(transcript),
    vendor: "apimart-whisper",
    raw: data,
  };
}

async function transcribeSegmentsWithApimart(files: File[]) {
  if (files.length === 0) {
    throw new Error("没有可用的音频片段。");
  }
  if (files.length === 1) {
    return transcribeWithApimart(files[0]);
  }

  console.log("[transcription] processing segments", {
    segments: files.length,
    concurrency: AUDIO_SEGMENT_CONCURRENCY,
  });

  const results: Awaited<ReturnType<typeof transcribeWithApimart>>[] =
    new Array(files.length);
  let cursor = 0;
  const concurrency = Math.min(AUDIO_SEGMENT_CONCURRENCY, files.length);

  const worker = async (workerIndex: number) => {
    while (true) {
      const current = cursor++;
      if (current >= files.length) break;

      const segmentFile = files[current];
      console.log("[transcription] segment start", {
        index: current + 1,
        total: files.length,
        worker: workerIndex,
      });
      const result = await transcribeWithApimart(segmentFile);
      results[current] = result;
      console.log("[transcription] segment done", {
        index: current + 1,
        total: files.length,
        worker: workerIndex,
        hasTranscript: Boolean(result.transcript),
      });
    }
  };

  await Promise.all(
    Array.from({ length: concurrency }, (_, index) => worker(index + 1))
  );

  const transcript = results
    .map((result) => result?.transcript || "")
    .filter(Boolean)
    .join("\n\n");

  return {
    transcript: normalizeTranscriptText(transcript),
    vendor: "apimart-whisper",
    raw: results.map((result) => result?.raw),
  };
}

async function transcribeWithTencent(url: string) {
  const taskId = await createTencentRecTask(url);
  const data = await pollTencentTaskResult(taskId);
  const transcript = extractTencentTranscript(data);
  if (!transcript) {
    throw new Error("腾讯云语音识别未返回文本结果。");
  }

  return {
    transcript: normalizeTranscriptText(transcript),
    vendor: "tencent-asr",
    raw: data,
  };
}

async function createTencentRecTask(url: string) {
  const payload = {
    EngineModelType: TENCENT_ASR_ENGINE_MODEL,
    ChannelNum: 1,
    ResTextFormat: 0,
    SourceType: 0,
    Url: url,
    // SubServiceType: 2, // 可通过环境变量扩展
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

function isAudioFile(file: File) {
  const type = file.type || "";
  if (type.startsWith("audio/")) {
    return true;
  }
  const name = file.name || "";
  return AUDIO_FILE_EXTENSIONS.test(name);
}

function isVideoFile(file: File) {
  const type = file.type || "";
  if (type.startsWith("video/")) {
    return true;
  }
  const name = file.name || "";
  return VIDEO_FILE_EXTENSIONS.test(name);
}

function normalizeTranscriptText(text: string) {
  if (!text) return text;
  if (process.env.TRANSCRIPT_SIMPLIFY !== "true") {
    return text;
  }
  return convertTraditionalToSimplified(text);
}

function convertTraditionalToSimplified(input: string) {
  // Minimal mapping covering常见繁体；可替换为更完整方案
  const map: Record<string, string> = {
    體: "体",
    頭: "头",
    鬧: "闹",
    愛: "爱",
    說: "说",
    觀: "观",
    視: "视",
    願: "愿",
    變: "变",
    讓: "让",
    會: "会",
    開: "开",
    對: "对",
    這: "这",
    那: "那",
    為: "为",
    於: "于",
    風: "风",
    雲: "云",
    課: "课",
    將: "将",
    夢: "梦",
    餘: "余",
    電: "电",
    錄: "录",
    樂: "乐",
    醫: "医",
  };

  return input.replace(/./g, (char) => map[char] || char);
}

async function segmentAudioFile(file: File) {
  if (!AUDIO_SEGMENT_ENABLED) {
    return [file];
  }
  if (file.size <= AUDIO_SEGMENT_MIN_SIZE) {
    return [file];
  }
  if (!AUDIO_SEGMENT_DURATION || AUDIO_SEGMENT_DURATION <= 0) {
    return [file];
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const isWavSegment =
    file.type === "audio/wav" || file.name?.toLowerCase().endsWith(".wav");
  const segmentExt = isWavSegment ? "wav" : "mp3";
  const segmentMime = isWavSegment ? "audio/wav" : "audio/mpeg";
  const tempDir = await mkdtemp(path.join(tmpdir(), "transcription-segments-"));
  const outputTemplate = path.join(tempDir, `segment-%03d.${segmentExt}`);

  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        "-i",
        "pipe:0",
        "-f",
        "segment",
        "-segment_time",
        String(AUDIO_SEGMENT_DURATION),
        "-reset_timestamps",
        "1",
        "-ac",
        "1",
        "-ar",
        AUDIO_OPTIMIZATION_SAMPLE_RATE,
        ...(isWavSegment
          ? ["-c:a", "pcm_s16le"]
          : ["-c:a", "libmp3lame", "-b:a", AUDIO_OPTIMIZATION_BITRATE]),
        outputTemplate,
      ];

      const ffmpeg = spawn(FFMPEG_PATH, args);
      const errors: Buffer[] = [];

      ffmpeg.stderr.on("data", (chunk) => errors.push(chunk));
      ffmpeg.on("error", (error) => {
        reject(error);
      });
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `[ffmpeg] segment exit code ${code}: ${Buffer.concat(errors).toString()}`
            )
          );
        }
      });

      ffmpeg.stdin.on("error", (error) => {
        console.error("[transcription] segment stdin error", error);
      });

      ffmpeg.stdin.write(buffer);
      ffmpeg.stdin.end();
    });

    const files = (await readdir(tempDir))
      .filter((name) => name.startsWith("segment-"))
      .sort();

    if (files.length <= 1) {
      return [file];
    }

    console.log("[transcription] audio segmented", {
      count: files.length,
      duration: AUDIO_SEGMENT_DURATION,
    });

    const segments: File[] = [];
    for (const name of files) {
      const segBuffer = await readFile(path.join(tempDir, name));
      segments.push(new File([segBuffer], name, { type: segmentMime }));
    }

    return segments;
  } catch (error) {
    console.error("[transcription] segment audio failed", error);
    return [file];
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function convertVideoToWav(file: File) {
  console.log("[transcription] converting video to audio", {
    filename: file.name,
    type: file.type,
    size: file.size,
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const audio = await extractAudioAsWav(buffer);
  if (!audio) {
    throw new Error("无法从视频中提取音频，请检查文件格式。");
  }
  const filename = ensureWavExtension(file.name || "video-audio");
  return new File([audio], filename, { type: "audio/wav" });
}

async function optimizeAudioForTranscription(file: File) {
  if (!AUDIO_OPTIMIZATION_ENABLED) {
    return file;
  }
  if (file.size <= AUDIO_OPTIMIZATION_THRESHOLD) {
    return file;
  }

  try {
    console.log("[transcription] optimizing audio", {
      filename: file.name,
      size: file.size,
      threshold: AUDIO_OPTIMIZATION_THRESHOLD,
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    const optimized = await transcodeAudio(buffer);
    if (!optimized) {
      return file;
    }
    const optimizedName = ensureOptimizedExtension(file.name || "audio-file");
    return new File([optimized.buffer], optimizedName, {
      type: optimized.mime,
    });
  } catch (error) {
    console.error("[transcription] audio optimization failed", error);
    return file;
  }
}

function ensureMp3Extension(name: string) {
  if (name.toLowerCase().endsWith(".mp3")) return name;
  return `${name.replace(/\.[^/.]+$/, "") || "audio"}.mp3`;
}

function ensureWavExtension(name: string) {
  if (name.toLowerCase().endsWith(".wav")) return name;
  return `${name.replace(/\.[^/.]+$/, "") || "audio"}.wav`;
}

function ensureOptimizedExtension(name: string) {
  if (AUDIO_OPTIMIZATION_OUTPUT_FORMAT === "wav") {
    return ensureWavExtension(name);
  }
  return ensureMp3Extension(name);
}

function buildUploadResultFromUrl(url: string) {
  return {
    url,
    key: deriveObjectKeyFromUrl(url),
  };
}

async function transcodeAudio(buffer: Buffer) {
  return new Promise<{ buffer: Buffer; mime: string } | null>((resolve) => {
    const format = AUDIO_OPTIMIZATION_OUTPUT_FORMAT;
    const isWav = format === "wav";
    const args = [
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      AUDIO_OPTIMIZATION_SAMPLE_RATE,
      ...(isWav
        ? ["-f", "wav"]
        : ["-b:a", AUDIO_OPTIMIZATION_BITRATE, "-f", format || "mp3"]),
      "pipe:1",
    ];

    const ffmpeg = spawn(FFMPEG_PATH, args);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => errors.push(chunk));
    ffmpeg.on("error", (error) => {
      console.error("[transcription] ffmpeg spawn failed", error);
      resolve(null);
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve({
          buffer: Buffer.concat(chunks),
          mime: isWav ? "audio/wav" : "audio/mpeg",
        });
      } else {
        console.error("[transcription] ffmpeg exited", {
          code,
          stderr: Buffer.concat(errors).toString(),
        });
        resolve(null);
      }
    });

    ffmpeg.stdin.on("error", (error) => {
      console.error("[transcription] ffmpeg stdin error", error);
    });

    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
  });
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
      AUDIO_OPTIMIZATION_SAMPLE_RATE,
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
      console.error("[transcription] ffmpeg spawn failed", error);
      resolve(null);
    });
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        console.error("[transcription] ffmpeg exited", {
          code,
          stderr: Buffer.concat(errors).toString(),
        });
        resolve(null);
      }
    });

    ffmpeg.stdin.on("error", (error) => {
      console.error("[transcription] ffmpeg stdin error", error);
    });

    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
  });
}

function deriveObjectKeyFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return value;
  }
}

async function fetchRemoteFile(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `无法下载音频链接：${response.status} ${response.statusText}`
    );
  }

  const contentType =
    response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filename = getFilenameFromUrl(url);
  return new File([buffer], filename, { type: contentType });
}

function getFilenameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const basename = parsed.pathname.split("/").filter(Boolean).pop();
    return basename ? decodeURIComponent(basename) : "remote-audio";
  } catch {
    return "remote-audio";
  }
}
