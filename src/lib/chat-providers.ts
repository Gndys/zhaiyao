import {
  ChatProviderId,
  getDefaultChatProvider,
  isChatProviderId,
} from "@/config/chat-providers";

type ProviderConfig = {
  endpoint: string;
  apiKeyEnv: keyof NodeJS.ProcessEnv;
  resolveModel(): string;
};

const PROVIDER_CONFIG: Record<ChatProviderId, ProviderConfig> = {
  apimart: {
    endpoint: "https://api.apimart.ai/v1/chat/completions",
    apiKeyEnv: "APIMART_API_KEY",
    resolveModel: () => {
      const configured = process.env.APIMART_MODEL?.trim();
      return configured && configured.length > 0
        ? configured
        : "gemini-3-pro-preview";
    },
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    resolveModel: () => {
      const configured = process.env.DEEPSEEK_MODEL?.trim();
      return configured && configured.length > 0
        ? configured
        : "deepseek-chat";
    },
  },
};

export function resolveChatProvider(input?: unknown): ChatProviderId {
  if (typeof input === "string") {
    const normalized = input.toLowerCase();
    if (isChatProviderId(normalized)) {
      return normalized;
    }
  }
  return getDefaultChatProvider();
}

export function getChatProviderEndpoint(provider: ChatProviderId) {
  return PROVIDER_CONFIG[provider].endpoint;
}

export function getChatProviderApiKey(provider: ChatProviderId) {
  const envKey = PROVIDER_CONFIG[provider].apiKeyEnv;
  return process.env[envKey];
}

export function getChatProviderModel(provider: ChatProviderId) {
  return PROVIDER_CONFIG[provider].resolveModel();
}
