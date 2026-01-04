import {
  ChatProviderId,
  getDefaultChatProvider,
  isChatProviderId,
} from "@/config/chat-providers";

type ProviderConfig = {
  endpoint: string | (() => string);
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
  devdove: {
    endpoint: () => {
      const configured = process.env.DEVDOVE_BASE_URL?.trim();
      if (!configured) return "https://api.devdove.site/v1/chat/completions";
      const normalized = configured.replace(/\/+$/, "");
      if (normalized.endsWith("/v1/chat/completions")) return normalized;
      if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
      return `${normalized}/v1/chat/completions`;
    },
    apiKeyEnv: "DEVDOVE_API_KEY",
    resolveModel: () => {
      const configured = process.env.DEVDOVE_MODEL?.trim();
      return configured && configured.length > 0
        ? configured
        : "gemini-2.5-flash";
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
  const endpoint = PROVIDER_CONFIG[provider].endpoint;
  return typeof endpoint === "function" ? endpoint() : endpoint;
}

export function getChatProviderApiKey(provider: ChatProviderId) {
  const envKey = PROVIDER_CONFIG[provider].apiKeyEnv;
  return process.env[envKey];
}

export function getChatProviderModel(provider: ChatProviderId) {
  return PROVIDER_CONFIG[provider].resolveModel();
}
