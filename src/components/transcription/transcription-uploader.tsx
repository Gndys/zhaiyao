"use client";

import { FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Status = "idle" | "uploading" | "done" | "error";

export function TranscriptionUploader() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [taskStatus, setTaskStatus] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setTranscript("");
    setAudioUrl("");
    setObjectKey("");
    setTaskStatus("");

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("请先选择一个音频文件。");
      return;
    }

    setStatus("uploading");
    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch("/api/transcription", {
        method: "POST",
        body,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error || "转写失败，请稍后再试。");
      }

      setAudioUrl(result.audioUrl);
      setObjectKey(result.objectKey);
      setTranscript(result.transcript || "");
      setTaskStatus("COMPLETED");
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "出现异常，请稍后再试。"
      );
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setError(null);
    setTranscript("");
    setAudioUrl("");
    setObjectKey("");
    setTaskStatus("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
  };

  const isUploading = status === "uploading";
  const showReset = !isUploading;

  return (
    <div className="space-y-8 rounded-3xl border border-border/60 bg-card/50 p-8 shadow-lg shadow-black/5">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="audio-file" className="text-base font-medium">
            选择音频
          </Label>
          <Input
            ref={fileInputRef}
            id="audio-file"
            type="file"
            accept="audio/*"
            required
          />
          <p className="text-sm text-muted-foreground">
            支持 mp3、m4a、wav 等常见格式，单个文件上限 50MB。
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isUploading}>
            {isUploading ? "上传中..." : "开始转写"}
          </Button>
          {showReset && (
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={isUploading}
            >
              重新选择
            </Button>
          )}
        </div>
      </form>

      {(isUploading || status === "done") && (
        <div className="space-y-2 rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
          <p>
            任务状态：
            <span className="font-medium">
              {taskStatus || (isUploading ? "处理音频中" : "完成")}
            </span>
          </p>
          {isUploading && (
            <p>音频已上传至 OSS，正在调用 Apimart Whisper，请稍候。</p>
          )}
        </div>
      )}

      {status === "done" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">音频地址</p>
            <a
              className="break-all text-sm text-primary underline underline-offset-2"
              href={audioUrl}
              target="_blank"
              rel="noreferrer"
            >
              {audioUrl}
            </a>
            <p className="text-xs text-muted-foreground">OSS Key: {objectKey}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">逐字稿</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopy}
              >
                复制内容
              </Button>
            </div>
            <Textarea value={transcript} readOnly rows={10} />
          </div>
        </div>
      )}
    </div>
  );
}
