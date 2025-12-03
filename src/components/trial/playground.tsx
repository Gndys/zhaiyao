"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it/dist/markdown-it.js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

const MAX_CHARACTERS = 20000;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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
  warningTitle: string;
  errors: {
    empty: string;
    general: string;
    fileSize: string;
    upload: string;
  };
};

type TrialPlaygroundProps = {
  copy: TrialFormCopy;
};

export function TrialPlayground({ copy }: TrialPlaygroundProps) {
  const [transcript, setTranscript] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [summary, setSummary] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const mdRef = useRef<MarkdownIt>();

  if (!mdRef.current) {
    mdRef.current = new MarkdownIt({ linkify: true, breaks: true });
  }

  const renderedSummary = useMemo(() => {
    if (!summary) return "";
    return mdRef.current!.render(summary);
  }, [summary]);

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
      setError(null);
    } catch {
      setError(copy.errors.upload);
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

    try {
      const response = await fetch("/api/trial-summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: trimmedTranscript,
          prompt: trimmedPrompt.length ? trimmedPrompt : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || copy.errors.general);
      }

      setSummary(data.summary);
      setWarning(data.warning ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : copy.errors.general;
      setError(message);
    } finally {
      setIsSubmitting(false);
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{copy.formTitle}</CardTitle>
          <CardDescription>{copy.formDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
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
                <span>{copy.uploadHint}</span>
                <span>
                  {transcript.length}/{MAX_CHARACTERS}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="transcript-file">{copy.uploadLabel}</Label>
              <Input
                id="transcript-file"
                type="file"
                accept=".txt,.md,.srt,.vtt,.json"
                onChange={(event) => handleFileChange(event.target.files)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-prompt">{copy.promptLabel}</Label>
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
            </div>

            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "..." : copy.submitLabel}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className={cn(summary && "border-b border-border/60")}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>{copy.summaryTitle}</CardTitle>
              <CardDescription>{copy.summaryDescription}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!summary}
              onClick={handleCopy}
            >
              {copied ? copy.copiedLabel : copy.copyLabel}
            </Button>
          </div>
          {warning && (
            <Alert className="mt-4 border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTitle>{copy.warningTitle}</AlertTitle>
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          )}
        </CardHeader>
        <CardContent className="prose max-w-none dark:prose-invert">
          {summary ? (
            <div dangerouslySetInnerHTML={{ __html: renderedSummary }} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {copy.summaryPlaceholder}
            </p>
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
