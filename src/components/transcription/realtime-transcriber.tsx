"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
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
import { readSSE } from "@/lib/sse";
import { getDefaultChatProvider } from "@/config/chat-providers";

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
  const sessionStartRef = useRef<number | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const mdRef = useRef<MarkdownIt | null>(null);
  const streamedSummaryRef = useRef("");
  const flushRafRef = useRef<number | null>(null);
  const [language, setLanguage] = useState("zh-CN");
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimText, setInterimText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [exportingDoc, setExportingDoc] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [isExportingSummary, setIsExportingSummary] = useState(false);
  const [summaryPrompt, setSummaryPrompt] = useState("");

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
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
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

    flushInterimToFinal();
    cleanupAudio();
    setIsListening(false);
    setInterimText("");
    sessionStartRef.current = null;
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
          sessionStartRef.current = Date.now();
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
    sessionStartRef.current = null;
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
        const now = Date.now();
        const start = sessionStartRef.current ?? now;
        const elapsedMs = Math.max(0, now - start);
        const timestamp = formatElapsed(elapsedMs);
        finalSentencesRef.current[result.index ?? finalSentencesRef.current.length] =
          `[${timestamp}] ${textStr}`;
        const merged = finalSentencesRef.current.filter(Boolean).join("\n");
        setTranscript(merged);
        setLastUpdated(now);
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
    setExportError(null);
    setSummary("");
    setSummaryError(null);
    setShowSummary(false);
    setIsExportingSummary(false);
    sessionStartRef.current = null;
  };

  const statusLabel = isListening ? "采集中" : "未开始";
  const statusTone = isListening ? "bg-green-500/20 text-green-700" : "bg-muted";

  const compatibilityNote = useMemo(() => {
    if (isSupported) return null;
    return "当前浏览器不支持麦克风录制或未运行在安全连接下，请在 HTTPS/localhost 的 Chrome 或 Edge 中使用。";
  }, [isSupported]);

  const handleExportWord = async () => {
    const exportText = [transcript.trim(), interimText.trim()]
      .filter(Boolean)
      .join("\n\n");
    if (!exportText || exportingDoc) return;

    setExportError(null);
    setExportingDoc(true);
    try {
      const { Document, Packer, Paragraph } = await import("docx");
      const lines = exportText.split(/\r?\n/);
      const doc = new Document({
        sections: [
          {
            children:
              lines.length > 0
                ? lines.map((line) => new Paragraph(line || " "))
                : [new Paragraph(" ")],
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `zhaiyao-realtime-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error("[realtime] export word failed", err);
      setExportError("导出 Word 文件失败，请稍后再试。");
    } finally {
      setExportingDoc(false);
    }
  };

  const canExport = Boolean(transcript.trim() || interimText.trim());
  const canSummarize = Boolean(transcript.trim()) && !isListening && !isSummarizing;
  const canExportSummaryPdf = Boolean(summary.trim()) && !isExportingSummary;

  const flushStreamedSummary = (immediate = false) => {
    if (immediate) {
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      setSummary(streamedSummaryRef.current);
      return;
    }

    if (flushRafRef.current) return;
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = null;
      setSummary(streamedSummaryRef.current);
    });
  };

  const handleSummarize = async () => {
    const content = transcript.trim();
    if (!content || isListening || isSummarizing) return;
    setShowSummary(true);
    setSummaryError(null);
    setIsSummarizing(true);
    setSummary("");
    streamedSummaryRef.current = "";
    let sseAbortController: AbortController | null = null;
    let sseHardTimeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const response = await fetch("/api/trial-summarize?stream=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          transcript: content,
          provider: getDefaultChatProvider(),
          prompt: summaryPrompt.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "生成摘要失败，请稍后重试。");
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await response.json().catch(() => ({}));
        setSummary(typeof data.summary === "string" ? data.summary : "");
        if (!data.summary) {
          setSummaryError("生成摘要为空，请重试。");
        }
        return;
      }

      sseAbortController = new AbortController();
      sseHardTimeoutId = setTimeout(() => {
        setSummaryError("本次生成耗时过长，已停止等待（上游未正确结束流式输出）。");
        sseAbortController?.abort();
      }, 5 * 60_000);

      await readSSE(
        response,
        (message) => {
          let payload: any = null;
          try {
            payload = message.data ? JSON.parse(message.data) : null;
          } catch {
            payload = null;
          }

          if (message.event === "delta") {
            const text = payload?.text as string | undefined;
            if (typeof text === "string" && text.length) {
              streamedSummaryRef.current += text;
              flushStreamedSummary(false);
            }
            return;
          }

          if (message.event === "done") {
            flushStreamedSummary(true);
            sseAbortController?.abort();
            return;
          }

          if (message.event === "error") {
            const text = payload?.message;
            if (typeof text === "string" && text.trim()) {
              setSummaryError(text);
            }
            sseAbortController?.abort();
          }
        },
        { signal: sseAbortController.signal }
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "生成摘要失败，请稍后重试。";
      setSummaryError(message);
    } finally {
      setIsSummarizing(false);
      flushStreamedSummary(true);
      if (sseHardTimeoutId) {
        clearTimeout(sseHardTimeoutId);
      }
      sseAbortController?.abort();
    }
  };

  const handleExportSummaryPdf = async () => {
    if (!summaryRef.current || !summary.trim() || isExportingSummary) return;
    setIsExportingSummary(true);
    try {
      const html = summaryRef.current.innerHTML;
      const printWindow = window.open("", "_blank", "width=1024,height=768");
      if (!printWindow) {
        throw new Error("无法打开打印窗口，请允许浏览器弹窗。");
      }
      printWindow.document.write(`
        <html>
          <head>
            <title>逐字稿摘要</title>
            <style>
              body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding: 24px; background: #f1f5f9; }
              .summary-wrapper { background: #ffffff; border-radius: 18px; padding: 32px; box-shadow: 0 20px 60px rgba(15,23,42,0.08); line-height: 1.7; }
              h1,h2,h3,h4 { color: #0f172a; margin-top: 1.4em; }
              p,li { color: #1f2937; }
              ul,ol { padding-left: 24px; }
            </style>
          </head>
          <body>
            <div class="summary-wrapper">${html}</div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      await new Promise((resolve) => setTimeout(resolve, 400));
      printWindow.print();
      printWindow.close();
    } catch (err) {
      console.error("[realtime][summary-pdf]", err);
      setSummaryError("导出摘要 PDF 失败，请稍后再试。");
    } finally {
      setIsExportingSummary(false);
    }
  };

  function formatElapsed(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  function formatSummaryHtml(text: string) {
    const value = text.trim();
    if (!value) return "";
    if (!mdRef.current) {
      mdRef.current = new MarkdownIt({
        html: false,
        linkify: true,
        breaks: true,
      });
    }
    return mdRef.current.render(value);
  }

  function flushInterimToFinal() {
    const text = interimText.trim();
    if (!text) return;
    const now = Date.now();
    const start = sessionStartRef.current ?? now;
    const elapsedMs = Math.max(0, now - start);
    const timestamp = formatElapsed(elapsedMs);
    finalSentencesRef.current.push(`[${timestamp}] ${text}`);
    const merged = finalSentencesRef.current.filter(Boolean).join("\n");
    setTranscript(merged);
    setLastUpdated(now);
    setInterimText("");
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="text-foreground dark:text-slate-100">
              实时采集控制台
            </CardTitle>
            <Badge className={cn(statusTone)}>{statusLabel}</Badge>
          </div>
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
              <p className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-2 text-sm text-muted-foreground dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200">
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
          {exportError && (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
              {exportError}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={startListening} disabled={!isSupported || isListening}>
              {isListening ? "正在转写..." : "开始实时转写"}
            </Button>
            <Button
              variant="destructive"
              onClick={stopListening}
              disabled={!isListening}
            >
              结束转写
            </Button>
            <Button
              variant="secondary"
              onClick={handleSummarize}
              disabled={!canSummarize}
            >
              {isSummarizing ? "摘要生成中..." : "生成摘要"}
            </Button>
            <Button
              variant="outline"
              onClick={handleExportWord}
              disabled={!canExport || exportingDoc}
            >
              {exportingDoc ? "导出中..." : "导出 Word"}
            </Button>
            <Button
              variant="ghost"
              onClick={clearTranscript}
              disabled={!transcript && !interimText}
            >
              清空内容
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">摘要提示词（可选）</Label>
            <Textarea
              value={summaryPrompt}
              onChange={(event) => setSummaryPrompt(event.target.value)}
              rows={4}
              placeholder="留空则使用默认会议摘要提示词。这里填写可覆盖默认输出结构/风格。"
              className="bg-background text-foreground dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          {compatibilityNote && (
            <p className="text-xs text-muted-foreground">{compatibilityNote}</p>
          )}
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
              <Textarea
                value={transcript}
                rows={10}
                readOnly
                className="bg-background text-foreground dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
          </div>
          {showSummary && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label className="text-sm">摘要</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportSummaryPdf}
                  disabled={!canExportSummaryPdf}
                >
                  {isExportingSummary ? "导出中..." : "导出摘要 PDF"}
                </Button>
              </div>
              {summaryError && (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                  {summaryError}
                </p>
              )}
              <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 p-4 dark:border-slate-700 dark:bg-slate-800/80">
                <div
                  ref={summaryRef}
                  className="min-h-[120px] whitespace-pre-wrap text-sm leading-6 text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: formatSummaryHtml(summary || (isSummarizing ? "摘要生成中..." : "")) }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
