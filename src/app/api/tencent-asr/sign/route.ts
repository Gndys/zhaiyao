import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";

const HOST = "asr.cloud.tencent.com";

type SignRequestBody = {
  voice_id?: string;
  engine_model_type?: string;
  voice_format?: number;
  needvad?: number;
  filter_dirty?: number;
  filter_modal?: number;
  filter_punc?: number;
  filter_empty_result?: number;
  hotword_id?: string;
  hotword_list?: string;
  customization_id?: string;
  convert_num_mode?: number;
  word_info?: number;
  input_sample_rate?: number;
  max_speak_time?: number;
  vad_silence_time?: number;
  emotion_recognition?: number;
  replace_text_id?: string;
};

const ALLOWED_KEYS: (keyof SignRequestBody)[] = [
  "engine_model_type",
  "voice_format",
  "needvad",
  "filter_dirty",
  "filter_modal",
  "filter_punc",
  "filter_empty_result",
  "hotword_id",
  "hotword_list",
  "customization_id",
  "convert_num_mode",
  "word_info",
  "input_sample_rate",
  "max_speak_time",
  "vad_silence_time",
  "emotion_recognition",
  "replace_text_id",
];

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as SignRequestBody;
    const appId = process.env.TENCENT_APP_ID;
    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;

    if (!appId || !secretId || !secretKey) {
      return NextResponse.json(
        { error: "缺少腾讯云凭证，请先配置 TENCENT_APP_ID/SECRET_ID/SECRET_KEY。" },
        { status: 500 }
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 3600;
    const nonce = Math.floor(Math.random() * 1_0000_0000);
    const voiceId = body.voice_id || randomUUID();

    const params: Record<string, string | number> = {
      engine_model_type:
        body.engine_model_type ||
        process.env.TENCENT_ASR_ENGINE_MODEL ||
        "16k_zh",
      voice_format: body.voice_format ?? 1,
      needvad: body.needvad ?? 0,
      filter_empty_result: body.filter_empty_result ?? 1,
      expired,
      nonce,
      secretid: secretId,
      timestamp,
      voice_id: voiceId,
    };

    for (const key of ALLOWED_KEYS) {
      if (body[key] !== undefined && body[key] !== null) {
        params[key] = body[key] as any;
      }
    }

    const query = buildSortedQuery(params);
    const signPlain = `${HOST}/asr/v2/${appId}?${query}`;
    const signature = signWithHmacSha1(signPlain, secretKey);
    const url = `wss://${HOST}/asr/v2/${appId}?${query}&signature=${encodeURIComponent(
      signature
    )}`;

    return NextResponse.json({
      url,
      voice_id: voiceId,
      params,
      timestamp,
      expired,
    });
  } catch (error) {
    console.error("[tencent-asr-sign] error", error);
    const message =
      error instanceof Error ? error.message : "生成签名失败，请稍后再试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildSortedQuery(params: Record<string, string | number>) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function signWithHmacSha1(payload: string, secretKey: string) {
  return createHmac("sha1", secretKey).update(payload).digest("base64");
}
