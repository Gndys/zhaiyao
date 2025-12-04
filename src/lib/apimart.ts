const DEFAULT_MODEL_FALLBACK = "gemini-3-pro-preview";

export const APIMART_ENDPOINT = "https://api.apimart.ai/v1/chat/completions";

export function resolveApimartModel() {
  const configured = process.env.APIMART_MODEL;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  return DEFAULT_MODEL_FALLBACK;
}
