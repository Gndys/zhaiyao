"use client";

import {
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import MarkdownIt from "markdown-it/dist/markdown-it.js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { ChatProviderId, getChatProviderOptions } from "@/config/chat-providers";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTrialContext } from "@/components/trial/trial-context";

const MAX_CHARACTERS = 20000;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const CHAT_PROVIDER_OPTIONS = getChatProviderOptions();

export type TrialFormCopy = {
  formTitle: string;
  formDescription: string;
  transcriptLabel: string;
  transcriptPlaceholder: string;
  promptLabel: string;
  promptPlaceholder: string;
  promptHint: string;
  uploadLabel: string;
  uploadHint: string;
  submitLabel: string;
  summaryTitle: string;
  summaryDescription: string;
  summaryPlaceholder: string;
  summaryHint: string;
  copyLabel: string;
  copiedLabel: string;
  exportLabel: string;
  exportingLabel: string;
  warningTitle: string;
  errors: {
    empty: string;
    general: string;
    fileSize: string;
    upload: string;
  };
  modelSelector: {
    label: string;
    description: string;
    hint: string;
  };
  healthCheck: {
    title: string;
    description: string;
    actionLabel: string;
    actionLoadingLabel: string;
    successLabel: string;
    failureLabel: string;
  };
  dropzone: {
    title: string;
    description: string;
    actionLabel: string;
    secondaryLabel: string;
    selectedLabel: string;
    emptyLabel: string;
  };
};

type TrialPlaygroundProps = {
  copy: TrialFormCopy;
};

export function TrialPlayground({ copy }: TrialPlaygroundProps) {
  const { provider, setProvider, transcript, setTranscript } =
    useTrialContext();
  const [customPrompt, setCustomPrompt] = useState("");
  const [summary, setSummary] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [submissionPhase, setSubmissionPhase] =
    useState<"input" | "sending" | "waiting" | "rendering">("input");
  const [isExporting, setIsExporting] = useState(false);
  const mdRef = useRef<MarkdownIt>();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const providerMeta =
    CHAT_PROVIDER_OPTIONS.find((option) => option.id === provider) ??
    CHAT_PROVIDER_OPTIONS[0];
  const providerLabel = providerMeta.label;
  const providerModelHint = providerMeta.modelHint;

  if (!mdRef.current) {
    mdRef.current = new MarkdownIt({ linkify: true, breaks: true });
  }

  const renderedSummary = useMemo(() => {
    if (!summary) return "";
    return mdRef.current!.render(summary);
  }, [summary]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setHealthStatus(null);
    setHealthError(null);
  }, [provider]);

  const handleFileChange = async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];

    if (file.size > MAX_FILE_SIZE) {
      setError(copy.errors.fileSize);
      return;
    }

    try {
      const text = await file.text();
      setTranscript(text.slice(0, MAX_CHARACTERS));
      setUploadedFileName(file.name);
      setError(null);
    } catch {
      setUploadedFileName(null);
      setError(copy.errors.upload);
    }
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
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

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const files = event.dataTransfer?.files;
    if (files?.length) {
      handleFileChange(files);
    }
  };

  const handleDropZoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleDropZoneClick();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTranscript = transcript.trim();
    const trimmedPrompt = customPrompt.trim();

    if (!trimmedTranscript) {
      setError(copy.errors.empty);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSummary("");
    setWarning(null);
    setElapsedMs(0);
    setSubmissionPhase("sending");
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => {
      setElapsedMs((prev) => prev + 100);
    }, 100);

    try {
      setSubmissionPhase("sending");
      const response = await fetch("/api/trial-summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: trimmedTranscript,
          prompt: trimmedPrompt.length ? trimmedPrompt : undefined,
          provider,
        }),
      });
      setSubmissionPhase("waiting");

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || copy.errors.general);
      }

      setSubmissionPhase("rendering");
      setSummary(data.summary);
      setWarning(data.warning ?? null);
      setSubmissionPhase("input");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : copy.errors.general;
      setError(message);
      setSubmissionPhase("input");
    } finally {
      setIsSubmitting(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  };

  const handleHealthCheck = async () => {
    setIsCheckingHealth(true);
    setHealthStatus(null);
    setHealthError(null);

    try {
      const response = await fetch(
        `/api/trial-summarize/health?provider=${encodeURIComponent(
          provider
        )}`
      );
      const data = await response.json();

      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.reason || copy.healthCheck.failureLabel
        );
      }

      const parts = [providerLabel, copy.healthCheck.successLabel];
      if (data.model) {
        parts.push(data.model as string);
      }
      if (typeof data.latency === "number") {
        parts.push(`${data.latency}ms`);
      }
      setHealthStatus(parts.join(" · "));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : copy.healthCheck.failureLabel;
      setHealthError(`${providerLabel} · ${message}`);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const handleCopy = async () => {
    if (!summary) return;

    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore copy errors
    }
  };

  const handleExportPdf = async () => {
    if (!summaryRef.current || !summary) return;
    setIsExporting(true);
    try {
      const html = summaryRef.current.innerHTML;
      const printWindow = window.open("", "_blank", "width=1024,height=768");
      if (!printWindow) {
        throw new Error("无法打开打印窗口，请允许浏览器弹窗。");
      }
      printWindow.document.write(`
        <html>
          <head>
            <title>${copy.summaryTitle}</title>
            <style>
              body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding: 24px; background: #f1f5f9; }
              .summary-wrapper { background: #ffffff; border-radius: 18px; padding: 32px; box-shadow: 0 20px 60px rgba(15,23,42,0.08); line-height: 1.7; }
              h1,h2,h3,h4 { color: #0f172a; margin-top: 1.4em; }
              p,li { color: #1f2937; }
              table { width: 100%; border-collapse: collapse; margin: 18px 0; }
              table th, table td { border: 1px solid #e2e8f0; padding: 10px 14px; }
              blockquote { border-left: 4px solid #6366f1; margin: 16px 0; padding-left: 16px; color: #334155; background: #eef2ff; border-radius: 4px; }
              code { background: #f8fafc; padding: 2px 6px; border-radius: 4px; }
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
    } catch (error) {
      console.error("[trial-summarize][export]", error);
      setError("导出 PDF 失败，请稍后再试或允许浏览器弹窗。");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{copy.formTitle}</CardTitle>
          <CardDescription>{copy.formDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <input
              ref={fileInputRef}
              id="transcript-file"
              type="file"
              accept=".txt,.md,.srt,.vtt,.json"
              className="hidden"
              onChange={(event) => handleFileChange(event.target.files)}
            />

            <div
              role="button"
              tabIndex={0}
              onKeyDown={handleDropZoneKeyDown}
              onClick={handleDropZoneClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "rounded-3xl border-2 border-dashed bg-gradient-to-br from-primary/5 via-white to-indigo-50 p-8 text-center shadow-sm transition-all duration-200 hover:border-primary hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                isDragActive &&
                  "border-primary bg-primary/10 shadow-lg dark:bg-primary/20"
              )}
            >
              <div className="inline-flex items-center rounded-full bg-white/80 px-4 py-1 text-xs font-semibold text-primary shadow-sm dark:bg-slate-900/60">
                {copy.uploadLabel}
              </div>
              <p className="mt-4 text-2xl font-semibold text-slate-900 dark:text-white">
                {copy.dropzone.title}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {copy.dropzone.description}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {copy.uploadHint}
              </p>
              <p className="mt-4 text-xs font-medium text-primary">
                {uploadedFileName
                  ? `${copy.dropzone.selectedLabel}: ${uploadedFileName}`
                  : copy.dropzone.emptyLabel}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button type="button" size="lg" onClick={handleDropZoneClick}>
                  {copy.dropzone.actionLabel}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {copy.dropzone.secondaryLabel}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transcript">{copy.transcriptLabel}</Label>
              <Textarea
                id="transcript"
                placeholder={copy.transcriptPlaceholder}
                value={transcript}
                onChange={(event) =>
                  setTranscript(
                    event.target.value.slice(0, MAX_CHARACTERS)
                  )
                }
                rows={10}
                className="font-mono text-sm"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{copy.dropzone.secondaryLabel}</span>
                <span>
                  {transcript.length}/{MAX_CHARACTERS}
                </span>
              </div>
            </div>

            <Accordion
              type="multiple"
              className="rounded-2xl border border-border/80 bg-muted/10"
            >
              <AccordionItem value="model" className="border-none">
                <AccordionTrigger className="px-4 text-left text-base font-semibold hover:no-underline">
                  {copy.modelSelector.label}
                </AccordionTrigger>
                <AccordionContent className="space-y-4 border-t border-border/60 px-4 pb-4 pt-4">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {copy.modelSelector.description}
                    </p>
                    <Select
                      value={provider}
                      onValueChange={(value) =>
                        setProvider(value as ChatProviderId)
                      }
                    >
                      <SelectTrigger id="model-provider">
                        <SelectValue placeholder={copy.modelSelector.label} />
                      </SelectTrigger>
                      <SelectContent>
                        {CHAT_PROVIDER_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                            {option.modelHint ? ` (${option.modelHint})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {copy.modelSelector.hint.replace(
                        "{{model}}",
                        providerModelHint
                      )}
                    </p>
                  </div>

                  <div className="space-y-3 rounded-xl border bg-background/80 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">
                          {copy.healthCheck.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {copy.healthCheck.description}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleHealthCheck}
                        disabled={isCheckingHealth}
                      >
                        {isCheckingHealth
                          ? copy.healthCheck.actionLoadingLabel
                          : copy.healthCheck.actionLabel}
                      </Button>
                    </div>
                    {healthStatus && (
                      <p className="text-sm text-green-600">{healthStatus}</p>
                    )}
                    {healthError && (
                      <p className="text-sm text-destructive">
                        {copy.healthCheck.failureLabel}: {healthError}
                      </p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="prompt" className="border-none">
                <AccordionTrigger className="px-4 text-left text-base font-semibold hover:no-underline">
                  {copy.promptLabel}
                </AccordionTrigger>
                <AccordionContent className="space-y-2 border-t border-border/60 px-4 pb-4 pt-4">
                  <Textarea
                    id="custom-prompt"
                    placeholder={copy.promptPlaceholder}
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    {copy.promptHint}
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}

            <div className="space-y-2">
              {isSubmitting && (
                <div className="rounded-xl border border-dashed border-primary/60 bg-primary/5 px-4 py-3 text-sm">
                  <p className="font-semibold text-primary">
                    {submissionPhase === "sending"
                      ? "正在发送请求..."
                      : submissionPhase === "waiting"
                      ? `等待 ${providerLabel} 响应...`
                      : "渲染摘要..."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    已用时 {(elapsedMs / 1000).toFixed(1)} 秒
                  </p>
                </div>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "生成中..." : copy.submitLabel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-lg rounded-2xl overflow-hidden bg-white">
        <CardHeader
          className={cn(
            "rounded-t-2xl transition-colors items-center",
            summary
              ? "border-b border-primary/20 bg-gradient-to-r from-indigo-50 via-indigo-100 to-indigo-200 text-slate-900"
              : "border-b border-border/60 bg-white"
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col justify-center">
              <CardTitle>{copy.summaryTitle}</CardTitle>
              <CardDescription>{copy.summaryDescription}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-center">
              <Button
                type="button"
                variant="outline"
                className="border-white/40 bg-white/30 text-slate-900 hover:bg-white/40 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                size="sm"
                disabled={!summary}
                onClick={handleCopy}
              >
                {copied ? copy.copiedLabel : copy.copyLabel}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-white/40 bg-white/30 text-slate-900 hover:bg-white/40 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                size="sm"
                disabled={!summary || isExporting}
                onClick={handleExportPdf}
              >
                {isExporting ? copy.exportingLabel : copy.exportLabel}
              </Button>
            </div>
          </div>
          {warning && (
            <Alert className="mt-4 border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTitle>{copy.warningTitle}</AlertTitle>
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          )}
        </CardHeader>
        <CardContent className="prose max-w-none rounded-b-2xl bg-white p-6 text-slate-800 shadow-inner dark:bg-slate-900 dark:text-slate-100">
          {summary ? (
            <article
              ref={summaryRef}
              className="summary-content space-y-5"
              dangerouslySetInnerHTML={{ __html: renderedSummary }}
            />
          ) : (
            <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
              <p className="text-sm text-muted-foreground">
                {copy.summaryPlaceholder}
              </p>
            </div>
          )}
        </CardContent>
        {summary && (
          <CardFooter className="text-xs text-muted-foreground">
            {copy.summaryHint}
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
