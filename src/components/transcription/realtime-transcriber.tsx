"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  { value: "zh-CN", label: "中文（普通话）" },
  { value: "zh-TW", label: "中文（粤语）" },
  { value: "en-US", label: "English (US)" },
  { value: "ja-JP", label: "日本語" },
  { value: "es-ES", label: "Español" },
] as const;

const ENGINE_MODEL_MAP: Record<string, string> = {
  "zh-CN": "16k_zh",
  "zh-TW": "16k_yue",
  "en-US": "16k_en",
  "ja-JP": "16k_ja",
  "es-ES": "16k_es",
};

const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 2048; // ~40ms at 48k

export function RealtimeTranscriber() {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const finalSentencesRef = useRef<string[]>([]);
  const [language, setLanguage] = useState("zh-CN");
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimText, setInterimText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hostname = window.location.hostname;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";

    if (!window.isSecureContext && !isLocalhost) {
      setIsSupported(false);
      setError("实时转写需要在 HTTPS 或 localhost 环境下使用，请切换到安全连接。");
      return;
    }

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setIsSupported(false);
      setError("当前浏览器不支持音频采集，建议使用最新版 Chrome 或 Edge。");
      return;
    }

    return () => {
      stopListening();
    };
  }, []);

  const startListening = async () => {
    if (isListening) return;
    setError(null);
    setInterimText("");

    try {
      const model = ENGINE_MODEL_MAP[language] || "16k_zh";
      const signResp = await fetch("/api/tencent-asr/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine_model_type: model,
          voice_format: 1,
          needvad: 1,
          filter_empty_result: 0,
        }),
      });
      const signData = await signResp.json().catch(() => ({}));
      if (!signResp.ok || !signData?.url) {
        throw new Error(
          signData?.error || "获取实时转写签名失败，请稍后再试。"
        );
      }

      await startWebSocket(signData.url, signData.voice_id);
      setIsListening(true);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "无法启动实时转写，请检查麦克风权限或网络。";
      setError(message);
      stopListening();
    }
  };

  const stopListening = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: "end" }));
      } catch {
        // ignore
      }
      wsRef.current.close();
    }
    wsRef.current = null;

    cleanupAudio();
    setIsListening(false);
    setInterimText("");
  };

  const cleanupAudio = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
    }
    processorRef.current = null;
    sourceRef.current = null;
    audioContextRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
  };

  const startWebSocket = async (url: string, voiceId?: string) => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = async () => {
        try {
          await startAudioCapture();
          finalSentencesRef.current = [];
          setTranscript("");
          setInterimText("正在聆听...");
          setError(null);
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      ws.onmessage = (event) => {
        handleWsMessage(event.data, voiceId);
      };

      ws.onerror = () => {
        setError("实时连接出错，请重试。");
        stopListening();
      };

      ws.onclose = () => {
        cleanupAudio();
        setIsListening(false);
        setInterimText("");
      };
    });
  };

  const handleWsMessage = (data: any, expectedVoiceId?: string) => {
    try {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      const payload = JSON.parse(text);
      if (payload.code && payload.code !== 0) {
        setError(payload.message || "实时转写出错。");
        return;
      }
      if (expectedVoiceId && payload.voice_id && payload.voice_id !== expectedVoiceId) {
        return;
      }
      if (payload.final === 1) {
        setIsListening(false);
        setInterimText("");
        return;
      }
      const result = payload.result;
      if (!result) return;

      const textStr = typeof result.voice_text_str === "string" ? result.voice_text_str.trim() : "";
      if (!textStr) {
        return;
      }

      if (result.slice_type === 1 || result.slice_type === 0) {
        setInterimText(textStr);
      }

      if (result.slice_type === 2) {
        finalSentencesRef.current[result.index ?? finalSentencesRef.current.length] =
          textStr;
        const merged = finalSentencesRef.current.filter(Boolean).join("\n");
        setTranscript(merged);
        setLastUpdated(Date.now());
        setInterimText("");
      }
    } catch (err) {
      console.error("[realtime] parse message failed", err);
    }
  };

  const startAudioCapture = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: TARGET_SAMPLE_RATE },
    });
    streamRef.current = stream;

    const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    sourceRef.current = source;
    const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = downsampleToInt16(input, context.sampleRate, TARGET_SAMPLE_RATE);
      if (!pcm16 || pcm16.length === 0) return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(pcm16.buffer);
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
  };

  function downsampleToInt16(
    buffer: Float32Array,
    inputRate: number,
    targetRate: number
  ) {
    if (targetRate === inputRate) {
      return floatTo16(buffer);
    }
    const ratio = inputRate / targetRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Int16Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffset = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffset && i < buffer.length; i += 1) {
        accum += buffer[i];
        count += 1;
      }
      result[offsetResult] = clampToInt16(accum / count);
      offsetResult += 1;
      offsetBuffer = nextOffset;
    }
    return result;
  }

  function floatTo16(buffer: Float32Array) {
    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 1) {
      result[i] = clampToInt16(buffer[i]);
    }
    return result;
  }

  function clampToInt16(value: number) {
    const s = Math.max(-1, Math.min(1, value));
    return s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const clearTranscript = () => {
    setTranscript("");
    setInterimText("");
    setLastUpdated(null);
    finalSentencesRef.current = [];
  };

  const statusLabel = isListening ? "采集中" : "未开始";
  const statusTone = isListening ? "bg-green-500/20 text-green-700" : "bg-muted";

  const compatibilityNote = useMemo(() => {
    if (isSupported) {
      return "麦克风音频会在本地降采样后直连腾讯实时 ASR（WebSocket），不依赖浏览器自带语音识别。";
    }
    return "当前浏览器不支持麦克风录制或未运行在安全连接下，请在 HTTPS/localhost 的 Chrome 或 Edge 中使用。";
  }, [isSupported]);

  return (
    <div className="space-y-6">
      <Card className="shadow-lg">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>实时采集控制台</CardTitle>
            <Badge className={cn(statusTone)}>{statusLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{compatibilityNote}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>选择语言</Label>
              <Select
                value={language}
                onValueChange={setLanguage}
                disabled={isListening}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择识别语言" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isListening && (
                <p className="text-xs text-muted-foreground">
                  变更语言前请先停止录音。
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>最近更新时间</Label>
              <p className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                {lastUpdated
                  ? new Date(lastUpdated).toLocaleTimeString()
                  : "尚无数据"}
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={startListening} disabled={!isSupported || isListening}>
              {isListening ? "正在转写..." : "开始实时转写"}
            </Button>
            <Button
              variant="outline"
              onClick={stopListening}
              disabled={!isListening}
            >
              暂停
            </Button>
            <Button
              variant="ghost"
              onClick={clearTranscript}
              disabled={!transcript && !interimText}
            >
              清空内容
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-inner">
        <CardHeader>
          <CardTitle>实时文本</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 p-4">
            <p className="text-xs uppercase text-muted-foreground">当前识别</p>
            <p className="mt-2 min-h-[80px] whitespace-pre-wrap text-lg font-semibold text-primary">
              {interimText || (isListening ? "正在聆听..." : "等待开始")}
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">逐字稿结果</Label>
            <Textarea value={transcript} rows={10} readOnly />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
