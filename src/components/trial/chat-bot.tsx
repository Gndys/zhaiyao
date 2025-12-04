"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
      "你好，我是 ZhaiYao 小助手。可以帮你排查 AI 连通性、逐字稿摘要或转写流程中的常见问题。",
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

  const renderedMessages = useMemo(() => {
    return messages.map((message) => (
      <div
        key={message.id}
        className={cn(
          "rounded-2xl px-4 py-2 text-sm leading-relaxed",
          message.role === "assistant"
            ? "self-start bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
            : "self-end bg-primary text-primary-foreground shadow-md"
        )}
      >
        {message.content}
      </div>
    ));
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const sendMessage = async (content: string) => {
    const nextMessages = [...messages, { id: `${Date.now()}-user`, role: "user", content }];
    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);
    setError(null);
    textareaRef.current?.focus();

    try {
      const trimmedContext = hasTranscriptContext
        ? transcript.slice(
            Math.max(0, transcript.length - TRANSCRIPT_CONTEXT_LIMIT)
          )
        : "";
      const response = await fetch("/api/trial-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          contextTranscript: trimmedContext || undefined,
          messages: nextMessages.map(({ role, content: text }) => ({
            role,
            content: text,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "AI 服务暂时不可用，请稍后再试。");
      }
      const assistantMessage: Message = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: data.reply || "我收到你的消息了！",
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "AI 服务暂时不可用，请稍后再试。";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant-error`,
          role: "assistant",
          content: `⚠️ ${message}`,
        },
      ]);
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
            <div>
              <CardTitle className="text-base font-semibold">
                小助手（实时）
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                当前模型：{providerLabel}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {hasTranscriptContext
                  ? "已加载逐字稿上下文，回答更贴合会议内容。"
                  : "尚未输入逐字稿，上下文为空。"}
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
                  正在思考...
                </div>
              )}
            </div>
            <form onSubmit={handleSubmit} className="space-y-2">
              <Textarea
                ref={textareaRef}
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="输入你的问题，按 Enter 发送"
                className="text-sm"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {error ? <span className="text-destructive">{error}</span> : <span>AI 实时回答</span>}
                <Button type="submit" size="sm" disabled={isSending}>
                  {isSending ? "发送中..." : "发送"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button
          onClick={() => setIsOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full shadow-xl"
          size="icon"
        >
          🤖
        </Button>
      )}
    </div>
  );
}
