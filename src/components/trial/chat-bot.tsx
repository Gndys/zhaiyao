"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import MarkdownIt from "markdown-it/dist/markdown-it.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChatProviderId,
  getChatProviderOptions,
} from "@/config/chat-providers";
import { useTrialContext } from "@/components/trial/trial-context";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const CHAT_PROVIDER_OPTIONS = getChatProviderOptions();

const TRANSCRIPT_CONTEXT_LIMIT = 8000;

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "你好，我是 ZhaiYao 助手。先聊也行，粘贴逐字稿后我能更精准回答。",
  },
];

export function TrialChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { provider, setProvider, transcript } = useTrialContext();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const providerLabel =
    CHAT_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ||
    provider;
  const hasTranscriptContext = Boolean(transcript.trim().length);
  const contextBadge = hasTranscriptContext ? "使用逐字稿" : "未加载逐字稿";
  const mdRef = useRef<MarkdownIt>();
  if (!mdRef.current) {
    mdRef.current = new MarkdownIt({ linkify: true, breaks: true });
  }

  const renderedMessages = useMemo(() => {
    return messages.map((message) => {
      const isAssistant = message.role === "assistant";
      const html = isAssistant
        ? mdRef.current!.render(message.content || "")
        : null;
      return (
        <div
          key={message.id}
          className={cn(
            "rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm max-w-full",
            isAssistant
              ? "self-start bg-slate-50 text-slate-900 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
              : "self-end bg-primary text-primary-foreground ring-1 ring-primary/20"
          )}
        >
          {isAssistant ? (
            <div
              className="prose prose-sm max-w-none text-slate-900 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: html || "" }}
            />
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>
      );
    });
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const sendMessage = async (content: string) => {
    const nextMessages: Message[] = [
      ...messages,
      { id: `${Date.now()}-user`, role: "user", content },
    ];
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    textareaRef.current?.focus();

    setIsSending(true);

    const assistantId = `${Date.now()}-assistant`;
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const trimmedContext = hasTranscriptContext
        ? transcript.slice(
            Math.max(0, transcript.length - TRANSCRIPT_CONTEXT_LIMIT)
          )
        : undefined;
      const response = await fetch("/api/trial-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          stream: true,
          contextTranscript: trimmedContext,
          hasTranscriptContext,
          messages: nextMessages.map(({ role, content: text }) => ({
            role,
            content: text,
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "AI 服务暂时不可用，请稍后再试。");
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: acc } : m
            )
          );
        }
        // flush decoder remainder
        const rest = decoder.decode();
        if (rest) {
          acc += rest;
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
        );
      } else {
        const data = await response.json();
        const reply = data?.reply || "我收到你的消息了！";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: reply } : m
          )
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "AI 服务暂时不可用，请稍后再试。";
      setError(message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `⚠️ ${message}`,
              }
            : m
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending) return;
    sendMessage(content);
  };

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {isOpen ? (
        <Card className="w-80 shadow-2xl sm:w-96">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div className="space-y-1">
              <CardTitle className="text-base font-semibold">
                ZhaiYao AI 助手
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {providerLabel} · {contextBadge}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={provider}
                onValueChange={(value) =>
                  setProvider(value as ChatProviderId)
                }
              >
                <SelectTrigger className="h-8 w-32">
                  <SelectValue placeholder="模型" />
                </SelectTrigger>
                <SelectContent>
                  {CHAT_PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setIsOpen(false)}
              >
                ✕
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              ref={scrollRef}
              className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-2xl border bg-muted/40 p-3"
            >
              {renderedMessages}
              {isSending && (
                <div className="self-start rounded-2xl bg-slate-200 px-4 py-2 text-sm text-slate-700 dark:bg-slate-700 dark:text-white">
                  正在生成…
                </div>
              )}
            </div>
            <form onSubmit={handleSubmit} className="space-y-2">
              <Textarea
                ref={textareaRef}
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  hasTranscriptContext
                    ? "基于逐字稿提问，按 Enter 发送"
                    : "先粘贴逐字稿，再提问"
                }
                className="text-sm"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {error ? <span className="text-destructive">{error}</span> : <span>实时回答</span>}
                <Button type="submit" size="sm" disabled={isSending}>
                  {isSending ? "发送中…" : "发送"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button
          onClick={() => setIsOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-white text-primary shadow-[0_12px_40px_rgba(59,130,246,0.25)] transition hover:translate-y-[-1px] hover:shadow-[0_16px_50px_rgba(59,130,246,0.35)]"
          size="icon"
        >
          <span className="text-xl" aria-hidden>
            💬
          </span>
          <span className="sr-only">打开 AI 助手</span>
        </Button>
      )}
    </div>
  );
}
