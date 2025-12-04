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

type SpeechRecognitionAlternative = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultLike[];
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const LANGUAGES = [
  { value: "zh-CN", label: "中文（普通话）" },
  { value: "zh-TW", label: "中文（粤语）" },
  { value: "en-US", label: "English (US)" },
  { value: "ja-JP", label: "日本語" },
  { value: "es-ES", label: "Español" },
] as const;

export function RealtimeTranscriber() {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [language, setLanguage] = useState("zh-CN");
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [interimText, setInterimText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          finalChunk += `${text} `;
        } else {
          interimChunk += `${text} `;
        }
      }
      if (finalChunk) {
        setTranscript((prev) =>
          prev ? `${prev}\n${finalChunk.trim()}` : finalChunk.trim()
        );
        setInterimText("");
        setLastUpdated(Date.now());
      } else if (interimChunk) {
        setInterimText(interimChunk.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      setError(
        event.error === "not-allowed"
          ? "麦克风权限被拒绝，请在浏览器中允许后重试。"
          : `实时转写出错：${event.error}`
      );
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText("");
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = language;
    }
  }, [language]);

  const startListening = () => {
    if (!recognitionRef.current) {
      setError("当前浏览器不支持实时语音转写。");
      return;
    }
    if (isListening) return;
    setError(null);
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "无法启动实时转写。";
      setError(message);
    }
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  };

  const clearTranscript = () => {
    setTranscript("");
    setInterimText("");
    setLastUpdated(null);
  };

  const statusLabel = isListening ? "采集中" : "未开始";
  const statusTone = isListening ? "bg-green-500/20 text-green-700" : "bg-muted";

  const compatibilityNote = useMemo(() => {
    if (isSupported) {
      return "使用浏览器内置的语音识别能力完成实时转写。";
    }
    return "当前浏览器不支持 Web Speech API，建议使用最新版 Chrome 或 Edge。";
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
