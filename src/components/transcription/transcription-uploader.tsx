"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Status = "idle" | "uploading" | "done" | "error";

type LinkStatus = {
  ok: boolean;
  reason?: string;
  latency?: number;
  issue?: "code" | "config" | "service" | "network";
};

type HealthSnapshot = {
  env: LinkStatus;
  oss: LinkStatus;
  apimart: LinkStatus;
  timestamp: number;
};

type WorkflowStage =
  | "idle"
  | "uploading"
  | "transcribing"
  | "done"
  | "error-upload"
  | "error-api";

const ISSUE_LABELS: Record<
  NonNullable<LinkStatus["issue"]>,
  string
> = {
  code: "代码异常",
  config: "配置异常",
  service: "依赖服务异常",
  network: "网络异常",
};

const workflowSteps = [
  {
    key: "oss",
    title: "上传 OSS",
    description: "签名上传音频到阿里云对象存储。",
  },
  {
    key: "apimart",
    title: "调用 Whisper",
    description: "将音频发送到 APIMart Whisper 生成逐字稿。",
  },
  {
    key: "result",
    title: "输出逐字稿",
    description: "返回可复制文本，并保存 OSS 地址。",
  },
] as const;

type WorkflowKey = (typeof workflowSteps)[number]["key"];

export function TranscriptionUploader() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [stage, setStage] = useState<WorkflowStage>("idle");
  const [failureStep, setFailureStep] = useState<WorkflowKey | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const isUploading = status === "uploading";
  const showReset = !isUploading;
  const readyForUpload = Boolean(
    health && health.env?.ok && health.oss?.ok && health.apimart?.ok
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs((prev) => prev + 1000);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleHealthCheck = async () => {
    setCheckingHealth(true);
    setHealth(null);
    try {
      const response = await fetch("/api/transcription/health");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "链路检测失败，请稍后重试。");
      }
      setHealth({
        env: data.env,
        oss: data.oss,
        apimart: data.apimart,
        timestamp: Date.now(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "链路检测失败，请稍后重试。";
      setHealth({
        env: { ok: false, reason: message, issue: "code" },
        oss: { ok: false, reason: "等待重新检测", issue: "service" },
        apimart: { ok: false, reason: "等待重新检测", issue: "service" },
        timestamp: Date.now(),
      });
      setError(message);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setTranscript("");
    setAudioUrl("");
    setObjectKey("");
    setFailureStep(null);

    if (!readyForUpload) {
      setError("请先完成链路检测，确认 OSS 与 APIMart 均可用。");
      return;
    }

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("请先选择一个音频文件。");
      return;
    }

    setStatus("uploading");
    setStage("uploading");
    startTimer();

    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch("/api/transcription", {
        method: "POST",
        body,
      });

      setStage("transcribing");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error || "转写失败，请稍后再试。");
      }

      setAudioUrl(result.audioUrl);
      setObjectKey(result.objectKey);
      setTranscript(result.transcript || "");
      setStatus("done");
      setStage("done");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "出现异常，请稍后再试。";
      setStatus("error");
      if (message.includes("上传") || message.toLowerCase().includes("oss")) {
        setStage("error-upload");
        setFailureStep("oss");
      } else {
        setStage("error-api");
        setFailureStep("apimart");
      }
      setError(message);
    } finally {
      stopTimer();
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setStage("idle");
    setFailureStep(null);
    setError(null);
    setTranscript("");
    setAudioUrl("");
    setObjectKey("");
    setElapsedMs(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
  };

  const timeline = useMemo(() => {
    return workflowSteps.map((step) => {
      return {
        ...step,
        state: getStepState(stage, step.key, failureStep),
      };
    });
  }, [stage, failureStep]);

  return (
    <div className="space-y-8">
      <div className="space-y-4 rounded-3xl border border-border/60 bg-card/50 p-6 shadow-inner">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold">链路自检</p>
            <p className="text-xs text-muted-foreground">
              确保 OSS 上传和 APIMart Whisper 端口均可访问
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleHealthCheck}
            disabled={checkingHealth}
          >
            {checkingHealth ? "检测中..." : "检测链路"}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {renderLinkStatus("环境配置", health?.env, checkingHealth)}
          {renderLinkStatus("OSS 上传", health?.oss, checkingHealth)}
          {renderLinkStatus("APIMart API", health?.apimart, checkingHealth)}
        </div>
        {health?.timestamp && (
          <p className="text-xs text-muted-foreground">
            上次检测：{new Date(health.timestamp).toLocaleTimeString()}{" "}
            {readyForUpload ? "（已通过）" : "（未通过）"}
          </p>
        )}
        {!readyForUpload && (
          <p className="text-xs text-amber-600">
            提交转写前请先完成一次链路检测。
          </p>
        )}
      </div>

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
            <Button type="submit" disabled={isUploading || !readyForUpload}>
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
          {!readyForUpload && (
            <p className="text-xs text-muted-foreground">
              * 链路检测通过后按钮才会启用。
            </p>
          )}
        </form>

        <div className="space-y-3 rounded-2xl bg-muted/40 p-4">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>任务进度</span>
            {stage !== "idle" && (
              <span className="text-xs text-muted-foreground">
                已用时 {(elapsedMs / 1000).toFixed(1)} 秒
              </span>
            )}
          </div>
          <ol className="flex flex-col gap-3">
            {timeline.map((step) => (
              <li
                key={step.key}
                className="flex items-start gap-3 rounded-xl border border-dashed border-slate-200/60 p-3 text-sm"
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                    step.state === "done" && "bg-green-500/80 text-white",
                    step.state === "active" && "bg-primary/80 text-primary-foreground",
                    step.state === "error" && "bg-rose-500/80 text-white",
                    step.state === "pending" && "bg-muted text-muted-foreground"
                  )}
                >
                  {step.state === "done"
                    ? "✓"
                    : step.state === "error"
                    ? "!"
                    : step.state === "active"
                    ? "•"
                    : "…"}
                </span>
                <div>
                  <p className="font-medium text-foreground">{step.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {status === "done" && (
          <div className="space-y-4 rounded-2xl border border-border/80 bg-background/70 p-4">
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
              <p className="text-xs text-muted-foreground">
                OSS Key: {objectKey}
              </p>
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
    </div>
  );
}

function renderLinkStatus(
  label: string,
  status?: LinkStatus,
  checking?: boolean
) {
  const state = status
    ? status.ok
      ? "ok"
      : "error"
    : checking
    ? "loading"
    : "idle";
  const issueLabel = status?.issue ? ISSUE_LABELS[status.issue] : null;

  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 p-3 text-sm shadow-sm">
      <p className="font-semibold text-foreground">{label}</p>
      <p
        className={cn(
          "text-xs",
          state === "ok" && "text-green-600",
          state === "error" && "text-rose-500",
          state === "loading" && "text-primary",
          state === "idle" && "text-muted-foreground"
        )}
      >
        {state === "ok"
          ? `已就绪${status?.latency ? ` · ${status.latency}ms` : ""}`
          : state === "error"
          ? `${issueLabel ? `${issueLabel} · ` : ""}${
              status?.reason || "检测失败"
            }`
          : state === "loading"
          ? "检测中..."
          : "尚未检测"}
      </p>
    </div>
  );
}

function getStepState(
  stage: WorkflowStage,
  key: WorkflowKey,
  failure?: WorkflowKey | null
) {
  if (stage === "idle") return "pending";
  if (stage === "uploading") {
    return key === "oss" ? "active" : "pending";
  }
  if (stage === "transcribing") {
    if (key === "oss") return "done";
    if (key === "apimart") return "active";
    return "pending";
  }
  if (stage === "done") {
    return "done";
  }
  if (stage === "error-upload") {
    if (key === "oss") return "error";
    return "pending";
  }
  if (stage === "error-api") {
    if (key === "oss") return "done";
    if (key === "apimart") return "error";
    return "pending";
  }
  if (failure === key) return "error";
  return "pending";
}
