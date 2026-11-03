export const agentProviders = {
  openai: { name: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  deepseek: { name: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  custom: { name: "Other OpenAI-compatible", baseURL: "", model: "" },
} as const;
export type AgentProvider = keyof typeof agentProviders;
// Credentials never belong in the renderer's saved-settings shape.
export type AgentProviderSettings = {
  provider: AgentProvider;
  baseURL: string;
  model: string;
  hasKey: boolean;
  revision: string;
};
export type AgentAutomationScope = "important" | "all";
// The user switches this per assistant. It runs only for new unread mail after
// a later sync, never for mail already in the cache.
export type AgentAutomationSettings = {
  agentId: string;
  enabled: boolean;
  scope: AgentAutomationScope;
  instruction: string;
  dailyLimit: number;
  revision: string;
  day?: string;
  count?: number;
  lastRunAt?: number;
  lastResult?: string;
};
