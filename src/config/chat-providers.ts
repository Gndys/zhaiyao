export type ChatProviderId = "apimart" | "devdove" | "deepseek";

const CHAT_PROVIDER_OPTIONS = [
  {
    id: "devdove",
    label: "DevDove · Gemini",
    modelHint: "gemini-2.5-flash",
  },
] as const satisfies ReadonlyArray<{
  id: ChatProviderId;
  label: string;
  modelHint: string;
}>;

export type ChatProviderOption = (typeof CHAT_PROVIDER_OPTIONS)[number];

const PROVIDER_SET = new Set<ChatProviderId>(
  CHAT_PROVIDER_OPTIONS.map((option) => option.id)
);

export function getChatProviderOptions() {
  return CHAT_PROVIDER_OPTIONS;
}

export function isChatProviderId(value: unknown): value is ChatProviderId {
  if (typeof value !== "string") return false;
  return PROVIDER_SET.has(value as ChatProviderId);
}

export function getChatProviderLabel(provider: ChatProviderId) {
  return (
    CHAT_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ||
    provider
  );
}

export function getDefaultChatProvider(): ChatProviderId {
  const envValue = process.env.NEXT_PUBLIC_DEFAULT_CHAT_PROVIDER?.toLowerCase();
  if (envValue && isChatProviderId(envValue)) {
    return envValue;
  }
  return CHAT_PROVIDER_OPTIONS[0].id;
}
