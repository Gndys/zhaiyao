import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";
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
    validateEnv();
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
      transcriptionFile = await convertVideoToAudio(transcriptionFile);
      convertedFromVideo = true;
    }

    if (!isAudioFile(transcriptionFile)) {
      return NextResponse.json(
        { error: "仅支持音频文件，请重新选择或检查链接。" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "文件体积超出限制，请压缩到 50MB 以内再试。" },
        { status: 400 }
      );
    }

    safeFilename = transcriptionFile.name || safeFilename;

    console.log("[transcription] file validated", {
      filename: file.name,
      size: file.size,
      type: file.type,
      source: fileSource,
      convertedFromVideo,
    });

    if (fileSource === "upload") {
      uploadResult = await uploadToOSS(file);
      console.log("[transcription] uploaded to OSS", uploadResult);
    } else {
      uploadResult = buildUploadResultFromUrl(remoteUrl);
      console.log("[transcription] using remote OSS object", uploadResult);
    }
    const optimizedFile = await optimizeAudioForTranscription(transcriptionFile);
    const segmentedFiles = await segmentAudioFile(optimizedFile);
    const transcription = await transcribeSegments(segmentedFiles);
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

function isHistoryEnabled() {
  if (process.env.DISABLE_AUDIO_UPLOAD_HISTORY === "true") {
    return false;
  }
  return Boolean(process.env.DATABASE_URL);
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
    transcript: normalizeTranscriptText(transcript),
    vendor: "apimart-whisper",
    raw: data,
  };
}

async function transcribeSegments(files: File[]) {
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
  const tempDir = await mkdtemp(path.join(tmpdir(), "transcription-segments-"));
  const outputTemplate = path.join(tempDir, "segment-%03d.mp3");

  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        "-i",
        "pipe:0",
        "-f",
        "segment",
        "-segment_time",
        String(AUDIO_SEGMENT_DURATION),
        "-c",
        "copy",
        "-reset_timestamps",
        "1",
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
      segments.push(new File([segBuffer], name, { type: "audio/mpeg" }));
    }

    return segments;
  } catch (error) {
    console.error("[transcription] segment audio failed", error);
    return [file];
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function convertVideoToAudio(file: File) {
  console.log("[transcription] converting video to audio", {
    filename: file.name,
    type: file.type,
    size: file.size,
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const audio = await transcodeToMp3(buffer);
  if (!audio) {
    throw new Error("无法从视频中提取音频，请检查文件格式。");
  }
  const filename = ensureMp3Extension(file.name || "video-audio");
  return new File([audio], filename, { type: "audio/mpeg" });
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
    const optimized = await transcodeToMp3(buffer);
    if (!optimized) {
      return file;
    }
    const optimizedName = ensureMp3Extension(file.name || "audio-file");
    return new File([optimized], optimizedName, {
      type: "audio/mpeg",
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

function buildUploadResultFromUrl(url: string) {
  return {
    url,
    key: deriveObjectKeyFromUrl(url),
  };
}

async function transcodeToMp3(buffer: Buffer) {
  return new Promise<Buffer | null>((resolve) => {
    const args = [
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      AUDIO_OPTIMIZATION_SAMPLE_RATE,
      "-b:a",
      AUDIO_OPTIMIZATION_BITRATE,
      "-f",
      "mp3",
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
