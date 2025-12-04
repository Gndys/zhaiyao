"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Status = "idle" | "uploading" | "done" | "error";
const MAX_AUDIO_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function TranscriptionUploader() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [exportingDoc, setExportingDoc] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);

  const isUploading = status === "uploading";
  const showReset = !isUploading;

  const handleFileSelection = (files?: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (file.size > MAX_AUDIO_FILE_SIZE) {
      setError("音频文件不能超过 50MB。");
      return;
    }
    setSelectedFile(file);
    setFileUrl("");
    setError(null);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFileSelection(event.target.files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    handleFileSelection(event.dataTransfer?.files);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUrlChange = (value: string) => {
    setFileUrl(value);
    if (value && selectedFile) {
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const toggleLinkInput = () => {
    setShowLinkInput((prev) => !prev);
  };

  const enableLinkInput = () => {
    setShowLinkInput(true);
  };

  const uploadAndTranscribe = (formData: FormData) => {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/transcription");
      xhr.responseType = "text";

      xhr.onload = () => {
        try {
          const text = xhr.responseText || "{}";
          const data = text ? JSON.parse(text) : {};
          resolve({ status: xhr.status, body: data });
        } catch (error) {
          reject(new Error("解析转写结果失败。"));
        }
      };

      xhr.onerror = () => {
        reject(new Error("网络异常，无法连接服务器。"));
      };

      xhr.onabort = () => {
        reject(new Error("请求已取消。"));
      };

      xhr.send(formData);
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setTranscript("");
    setExportError(null);

    const file = selectedFile;
    const trimmedUrl = fileUrl.trim();
    const useRemoteUrl = Boolean(trimmedUrl);

    if (file && useRemoteUrl) {
      setError("请选择上传文件或输入链接中的一种方式。");
      return;
    }

    if (!file && !useRemoteUrl) {
      setError("请先选择音频文件或填写音频链接。");
      return;
    }

    setStatus("uploading");

    const body = new FormData();
    if (file) {
      body.append("file", file);
    }
    if (useRemoteUrl && !file) {
      body.append("fileUrl", trimmedUrl);
    }

    try {
      let result: any;
      if (useRemoteUrl && !file) {
        const response = await fetch("/api/transcription", {
          method: "POST",
          body,
        });
        result = await response.json();
        if (!response.ok) {
          throw new Error(result?.error || "转写失败，请稍后再试。");
        }
      } else {
        const { status: httpStatus, body: xhrResult } =
          await uploadAndTranscribe(body);

        if (httpStatus >= 400) {
          throw new Error(xhrResult?.error || "转写失败，请稍后再试。");
        }
        result = xhrResult;
      }

      setTranscript(result.transcript || "");
      setStatus("done");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "出现异常，请稍后再试。";
      setStatus("error");
      setError(message);
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setError(null);
    setTranscript("");
    setFileUrl("");
    setExportError(null);
    setSelectedFile(null);
    setIsDragActive(false);
    setShowLinkInput(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
  };

  const handleExportWord = async () => {
    if (!transcript.trim() || exportingDoc) {
      return;
    }
    setExportError(null);
    setExportingDoc(true);
    try {
      const { Document, Packer, Paragraph } = await import("docx");
      const lines = transcript.split(/\r?\n/);
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
      anchor.download = `zhaiyao-transcript-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error("[transcription] export word failed", err);
      setExportError("导出 Word 文件失败，请稍后再试。");
    } finally {
      setExportingDoc(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-8 rounded-3xl border border-border/60 bg-card/50 p-8 shadow-lg shadow-black/5">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <input
            ref={fileInputRef}
            id="audio-file"
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleDropZoneClick();
              }
            }}
            onClick={handleDropZoneClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "rounded-3xl border-2 border-dashed bg-gradient-to-br from-primary/5 via-white to-indigo-50 p-8 text-center shadow-sm transition-all duration-200 hover:border-primary hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              isDragActive &&
                "border-primary bg-primary/10 shadow-lg dark:bg-primary/20",
              isUploading && "pointer-events-none opacity-60"
            )}
          >
            <div className="inline-flex items-center rounded-full bg-white/90 px-4 py-1 text-xs font-semibold text-primary shadow-sm dark:bg-slate-900/60">
              选择音频文件
            </div>
            <p className="mt-4 text-2xl font-semibold text-slate-900 dark:text-white">
              拖拽或点击上传音频
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              支持 mp3、m4a、wav、mp4 等常见音视频格式（50MB 以内）。
            </p>
            <p className="mt-4 text-xs font-medium text-primary">
              {selectedFile
                ? `已选择文件：${selectedFile.name}`
                : "尚未选择文件"}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                size="lg"
                onClick={handleDropZoneClick}
                disabled={isUploading}
              >
                浏览本地文件
              </Button>
              <button
                type="button"
                className="text-sm text-primary underline-offset-2 hover:underline"
                onClick={enableLinkInput}
                disabled={isUploading}
              >
                或粘贴音频链接
              </button>
            </div>
          </div>

          {showLinkInput && (
            <div className="space-y-2 rounded-2xl border border-border/70 bg-background/70 p-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="audio-url" className="text-base font-medium">
                  输入音频链接
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={toggleLinkInput}
                >
                  收起
                </Button>
              </div>
              <Input
                id="audio-url"
                type="url"
                placeholder="https://example.com/audio.mp3"
                value={fileUrl}
                onChange={(event) => handleFileUrlChange(event.target.value)}
                disabled={isUploading}
              />
              <p className="text-xs text-muted-foreground">
                自动下载链接中的音/视频并在后台提取音频，随后进入逐字稿生成流程。
              </p>
              <p className="text-xs text-muted-foreground">
                填写链接会自动覆盖已选择的本地文件，主要用于测试。
              </p>
            </div>
          )}

          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <button
              type="button"
              onClick={toggleLinkInput}
              className={cn(
                "text-left rounded-2xl border border-dashed border-border/70 bg-white/70 p-4 shadow-sm transition hover:border-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                showLinkInput && "border-primary bg-primary/5"
              )}
              aria-pressed={showLinkInput}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                步骤 1
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                上传或粘贴链接
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                单个文件 50MB 内，支持音视频混合格式。点击展开填入链接。
              </p>
            </button>
            <div className="rounded-2xl border border-dashed border-border/70 bg-white/70 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                步骤 2
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                进入转写流程
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                后台自动执行语音识别，生成逐字稿。
              </p>
            </div>
            <div className="rounded-2xl border border-dashed border-border/70 bg-white/70 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                步骤 3
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                获取逐字稿
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                输出文本可复制、导出 Word 或直接粘贴到知识库。
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isUploading}>
              {isUploading ? "执行中..." : "开始转写"}
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

        {status === "done" && (
          <div className="space-y-4 rounded-2xl border border-border/80 bg-background/70 p-4">
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Label className="text-base font-medium">逐字稿</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    disabled={!transcript}
                  >
                    复制内容
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleExportWord}
                    disabled={!transcript || exportingDoc}
                  >
                    {exportingDoc ? "导出中..." : "导出 Word"}
                  </Button>
                </div>
              </div>
              {exportError && (
                <p className="text-xs text-red-500">{exportError}</p>
              )}
              <Textarea value={transcript} readOnly rows={10} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
