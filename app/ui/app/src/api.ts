import {
  ChatResponse,
  ChatsResponse,
  ChatEvent,
  DownloadEvent,
  ErrorEvent,
  InferenceComputeResponse,
  ModelCapabilitiesResponse,
  Model,
  Message,
  ChatRequest,
  Settings,
  User,
} from "@/gotypes";
import { parseJsonlFromResponse } from "./util/jsonl-parsing";
import { ollamaClient as ollama } from "./lib/ollama-client";
import type { ModelResponse } from "ollama/browser";
import {
  IS_BROWSER_DEV,
  desktopApiPath,
  engineApiPath,
  OLLAMA_DOT_COM,
} from "./lib/config";

// Extend Model class with utility methods
declare module "@/gotypes" {
  interface Model {
    isCloud(): boolean;
  }
}

Model.prototype.isCloud = function (): boolean {
  return this.model.endsWith("cloud");
};

export type CloudStatusSource = "env" | "config" | "both" | "none";
export interface CloudStatusResponse {
  disabled: boolean;
  source: CloudStatusSource;
}

const BROWSER_DEV_SETTINGS_KEY = "ollama.browserDev.settings";
const BROWSER_DEV_CHATS_KEY = "ollama.browserDev.chats";
const BROWSER_DEV_CLOUD_DISABLED_KEY = "ollama.browserDev.cloudDisabled";

type BrowserDevChatRecord = {
  id: string;
  title: string;
  userExcerpt: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

const defaultSettings = new Settings({
  Expose: false,
  Browser: false,
  Survey: false,
  Models: "",
  Agent: false,
  Tools: false,
  WorkingDir: "",
  ContextLength: 0,
  TurboEnabled: false,
  WebSearchEnabled: false,
  ThinkEnabled: false,
  ThinkLevel: "none",
  SelectedModel: "",
  SidebarOpen: false,
  LastHomeView: "chat",
  AutoUpdateEnabled: true,
});


function isClient(): boolean {
  return typeof window !== "undefined";
}

function loadBrowserDevSettings(): Settings {
  if (!isClient()) {
    return new Settings(defaultSettings);
  }
  const raw = localStorage.getItem(BROWSER_DEV_SETTINGS_KEY);
  if (!raw) {
    return new Settings(defaultSettings);
  }
  try {
    return new Settings(JSON.parse(raw));
  } catch {
    return new Settings(defaultSettings);
  }
}

function persistBrowserDevSettings(settings: Settings): void {
  if (!isClient()) return;
  localStorage.setItem(BROWSER_DEV_SETTINGS_KEY, JSON.stringify(settings));
}

function loadBrowserDevCloudDisabled(): boolean {
  if (!isClient()) {
    return true;
  }
  const raw = localStorage.getItem(BROWSER_DEV_CLOUD_DISABLED_KEY);
  return raw === null ? true : raw === "true";
}

function persistBrowserDevCloudDisabled(disabled: boolean): void {
  if (!isClient()) return;
  localStorage.setItem(BROWSER_DEV_CLOUD_DISABLED_KEY, String(disabled));
}

function loadBrowserDevChats(): BrowserDevChatRecord[] {
  if (!isClient()) {
    return [];
  }
  const raw = localStorage.getItem(BROWSER_DEV_CHATS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((chat: any) => ({
      id: chat.id,
      title: chat.title,
      userExcerpt: chat.userExcerpt,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: (chat.messages || []).map((m: any) => new Message(m)),
    }));
  } catch {
    return [];
  }
}

function persistBrowserDevChats(chats: BrowserDevChatRecord[]): void {
  if (!isClient()) return;
  localStorage.setItem(BROWSER_DEV_CHATS_KEY, JSON.stringify(chats));
}

function buildChatTitle(content: string): string {
  const trimmed = content.trim();
  return (trimmed || "New chat").slice(0, 60);
}

function upsertBrowserDevChat(chat: BrowserDevChatRecord): void {
  const chats = loadBrowserDevChats();
  const index = chats.findIndex((c) => c.id === chat.id);
  if (index === -1) {
    chats.push(chat);
  } else {
    chats[index] = chat;
  }
  persistBrowserDevChats(chats);
}

let browserDevSettings = loadBrowserDevSettings();

function normalizeApiPath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  if (withLeadingSlash === "/api") {
    return "/";
  }
  return withLeadingSlash.startsWith("/api/")
    ? withLeadingSlash.slice(4)
    : withLeadingSlash;
}

function apiUrl(path: string): string {
  return desktopApiPath(normalizeApiPath(path));
}

function engineUrl(path: string): string {
  return engineApiPath(normalizeApiPath(path));
}
// Helper function to convert Uint8Array to base64
function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
  let binary = "";

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function fetchUser(): Promise<User | null> {
  const response = await fetch(apiUrl("/me"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (response.ok) {
    const userData: User = await response.json();

    if (userData.avatarurl && !userData.avatarurl.startsWith("http")) {
      userData.avatarurl = `${OLLAMA_DOT_COM}${userData.avatarurl}`;
    }

    return userData;
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (IS_BROWSER_DEV && response.status === 404) {
    return null;
  }

  throw new Error(`Failed to fetch user: ${response.status}`);
}

export async function fetchConnectUrl(): Promise<string> {
  const response = await fetch(apiUrl("/me"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    const data = await response.json();
    if (data.signin_url) {
      return data.signin_url;
    }
  }

  throw new Error("Failed to fetch connect URL");
}

export async function disconnectUser(): Promise<void> {
  const response = await fetch(apiUrl("/signout"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to disconnect user");
  }
}

export async function getChats(): Promise<ChatsResponse> {
  if (IS_BROWSER_DEV) {
    const chatInfos = loadBrowserDevChats()
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        userExcerpt: chat.userExcerpt,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }));
    return new ChatsResponse({ chatInfos });
  }

  const response = await fetch(apiUrl("/v1/chats"));
  const data = await response.json();
  return new ChatsResponse(data);
}

export async function getChat(chatId: string): Promise<ChatResponse> {
  if (IS_BROWSER_DEV) {
    const chat = loadBrowserDevChats().find((c) => c.id === chatId);
    if (!chat) {
      return new ChatResponse({
        chat: {
          id: chatId,
          messages: [],
          title: "New chat",
        },
      });
    }
    return new ChatResponse({
      chat: {
        id: chat.id,
        title: chat.title,
        messages: chat.messages,
      },
    });
  }

  const response = await fetch(apiUrl(`/v1/chat/${chatId}`));
  const data = await response.json();
  return new ChatResponse(data);
}

export async function getModels(query?: string): Promise<Model[]> {
  try {
    const { models: modelsResponse } = await ollama.list();

    let models: Model[] = modelsResponse
      .filter((m: ModelResponse) => {
        const families = m.details?.families;

        if (!families || families.length === 0) {
          return true;
        }

        const isBertOnly = families.every((family: string) =>
          family.toLowerCase().includes("bert"),
        );

        return !isBertOnly;
      })
      .map((m: ModelResponse) => {
        // Remove the latest tag from the returned model
        const modelName = m.name.replace(/:latest$/, "");

        return new Model({
          model: modelName,
          digest: m.digest,
          modified_at: m.modified_at ? new Date(m.modified_at) : undefined,
        });
      });

    // Filter by query if provided
    if (query) {
      const normalizedQuery = query.toLowerCase().trim();

      const filteredModels = models.filter((m: Model) => {
        return m.model.toLowerCase().startsWith(normalizedQuery);
      });

      let exactMatch = false;
      for (const m of filteredModels) {
        if (m.model.toLowerCase() === normalizedQuery) {
          exactMatch = true;
          break;
        }
      }

      // Add query if it's in the registry and not already in the list
      if (!exactMatch) {
        const result = await getModelUpstreamInfo(new Model({ model: query }));
        const existsUpstream = result.exists;
        if (existsUpstream) {
          filteredModels.push(new Model({ model: query }));
        }
      }

      models = filteredModels;
    }

    return models;
  } catch (err) {
    throw new Error(`Failed to fetch models: ${err}`);
  }
}



export interface DetailedModel {
  name: string;
  sizeLabel: string;
  tagsLabel: string;
  modifiedAt: number;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export async function getDetailedModels(): Promise<DetailedModel[]> {
  const { models } = await ollama.list();
  return (models || []).map((m: any) => ({
    name: m.name?.replace(/:latest$/, "") || "unknown",
    sizeLabel: formatBytes(Number(m.size || 0)),
    tagsLabel: Array.isArray(m.details?.families) && m.details.families.length > 0
      ? m.details.families.join(", ")
      : "No tags",
    modifiedAt: m.modified_at ? new Date(m.modified_at).getTime() : 0,
  }));
}

export async function deleteModel(modelName: string): Promise<void> {
  await (ollama as any).delete({ model: modelName });
}
export async function getModelCapabilities(
  modelName: string,
): Promise<ModelCapabilitiesResponse> {
  try {
    const showResponse = await ollama.show({ model: modelName });

    return new ModelCapabilitiesResponse({
      capabilities: Array.isArray(showResponse.capabilities)
        ? showResponse.capabilities
        : [],
    });
  } catch (error) {
    // Model might not be downloaded yet, return empty capabilities
    console.error(`Failed to get capabilities for ${modelName}:`, error);
    return new ModelCapabilitiesResponse({ capabilities: [] });
  }
}

export type ChatEventUnion = ChatEvent | DownloadEvent | ErrorEvent;

export async function* sendMessage(
  chatId: string,
  message: string,
  model: Model,
  attachments?: Array<{ filename: string; data: Uint8Array }>,
  signal?: AbortSignal,
  index?: number,
  webSearch?: boolean,
  fileTools?: boolean,
  forceUpdate?: boolean,
  think?: boolean | string,
): AsyncGenerator<ChatEventUnion> {
  if (IS_BROWSER_DEV) {
    const now = new Date().toISOString();
    const activeChatId =
      chatId === "new"
        ? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : chatId;
    const chats = loadBrowserDevChats();
    const existing = chats.find((c) => c.id === activeChatId);
    const existingMessages = existing?.messages || [];
    const nextMessages =
      index !== undefined && index >= 0 && index < existingMessages.length
        ? existingMessages.slice(0, index)
        : [...existingMessages];

    if (message.trim() !== "") {
      nextMessages.push(
        new Message({
          role: "user",
          content: message,
          model: model.model,
          attachments,
        }),
      );
    }

    const initialChat: BrowserDevChatRecord = {
      id: activeChatId,
      title: existing?.title || buildChatTitle(message),
      userExcerpt: message.trim().slice(0, 120),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      messages: nextMessages,
    };

    upsertBrowserDevChat(initialChat);

    if (chatId === "new") {
      yield new ChatEvent({ eventName: "chat_created", chatId: activeChatId });
    }

    const ollamaMessages = nextMessages
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
      .map((m) => ({
        role: m.role,
        content: m.content || "",
      }));

    const response = await fetch(engineUrl("/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.model,
        messages: ollamaMessages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield new ErrorEvent({
        eventName: "error",
        error: errorText || `Chat request failed (${response.status})`,
      });
      return;
    }

    let assistantContent = "";
    for await (const chunk of parseJsonlFromResponse<any>(response)) {
      const token = chunk?.message?.content || "";
      if (token) {
        assistantContent += token;
        yield new ChatEvent({ eventName: "chat", content: token });
      }
      if (chunk?.done) {
        break;
      }
    }

    const finalChats = loadBrowserDevChats();
    const finalExisting = finalChats.find((c) => c.id === activeChatId);
    if (finalExisting) {
      finalExisting.messages = [
        ...finalExisting.messages,
        new Message({
          role: "assistant",
          content: assistantContent,
          model: model.model,
        }),
      ];
      finalExisting.updatedAt = new Date().toISOString();
      if (!finalExisting.title || finalExisting.title === "New chat") {
        finalExisting.title = buildChatTitle(message);
      }
      if (!finalExisting.userExcerpt) {
        finalExisting.userExcerpt = message.trim().slice(0, 120);
      }
      persistBrowserDevChats(finalChats);
    }

    yield new ChatEvent({ eventName: "done" });
    return;
  }

  // Convert Uint8Array to base64 for JSON serialization
  const serializedAttachments = attachments?.map((att) => ({
    filename: att.filename,
    data: uint8ArrayToBase64(att.data),
  }));

  // Send think parameter when it's explicitly set (true, false, or a non-empty string).
  const shouldSendThink =
    think !== undefined &&
    (typeof think === "boolean" || (typeof think === "string" && think !== ""));

  const response = await fetch(apiUrl(`/v1/chat/${chatId}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      new ChatRequest({
        model: model.model,
        prompt: message,
        ...(index !== undefined ? { index } : {}),
        ...(serializedAttachments !== undefined
          ? { attachments: serializedAttachments }
          : {}),
        // Always send web_search as a boolean value (default to false)
        web_search: webSearch ?? false,
        file_tools: fileTools ?? false,
        ...(forceUpdate !== undefined ? { forceUpdate } : {}),
        ...(shouldSendThink ? { think } : {}),
      }),
    ),
    signal,
  });

  for await (const event of parseJsonlFromResponse<ChatEventUnion>(response)) {
    switch (event.eventName) {
      case "download":
        yield new DownloadEvent(event);
        break;
      case "error":
        yield new ErrorEvent(event);
        break;
      default:
        yield new ChatEvent(event);
        break;
    }
  }
}

export async function getSettings(): Promise<{
  settings: Settings;
}> {
  if (IS_BROWSER_DEV) {
    return { settings: browserDevSettings };
  }

  try {
    const response = await fetch(apiUrl("/v1/settings"));
    if (!response.ok) {
      if (IS_BROWSER_DEV && response.status === 404) {
        return { settings: browserDevSettings };
      }
      throw new Error("Failed to fetch settings");
    }
    const data = await response.json();
    return {
      settings: new Settings(data.settings),
    };
  } catch (error) {
    if (IS_BROWSER_DEV) {
      return { settings: browserDevSettings };
    }
    throw error;
  }
}

export async function updateSettings(settings: Settings): Promise<{
  settings: Settings;
}> {
  if (IS_BROWSER_DEV) {
    browserDevSettings = new Settings(settings);
    persistBrowserDevSettings(browserDevSettings);
    return {
      settings: browserDevSettings,
    };
  }

  const response = await fetch(apiUrl("/v1/settings"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to update settings");
  }
  const data = await response.json();
  return {
    settings: new Settings(data.settings),
  };
}

export async function updateCloudSetting(
  enabled: boolean,
): Promise<CloudStatusResponse> {
  if (IS_BROWSER_DEV) {
    persistBrowserDevCloudDisabled(!enabled);
    return {
      disabled: !enabled,
      source: "config",
    };
  }

  const response = await fetch(apiUrl("/v1/cloud"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to update cloud setting");
  }

  const data = await response.json();
  return {
    disabled: Boolean(data.disabled),
    source: (data.source as CloudStatusSource) || "none",
  };
}

export async function renameChat(chatId: string, title: string): Promise<void> {
  if (IS_BROWSER_DEV) {
    const chats = loadBrowserDevChats();
    const chat = chats.find((c) => c.id === chatId);
    if (chat) {
      chat.title = title.trim();
      chat.updatedAt = new Date().toISOString();
      persistBrowserDevChats(chats);
    }
    return;
  }

  const response = await fetch(apiUrl(`/v1/chat/${chatId}/rename`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: title.trim() }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to rename chat");
  }
}

export async function deleteChat(chatId: string): Promise<void> {
  if (IS_BROWSER_DEV) {
    persistBrowserDevChats(loadBrowserDevChats().filter((c) => c.id !== chatId));
    return;
  }

  const response = await fetch(apiUrl(`/v1/chat/${chatId}`), {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to delete chat");
  }
}

// Get upstream information for model staleness checking
export async function getModelUpstreamInfo(
  model: Model,
): Promise<{ stale: boolean; exists: boolean; error?: string }> {
  try {
    const response = await fetch(apiUrl("/v1/model/upstream"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.model,
      }),
    });

    if (!response.ok) {
      console.warn(
        `Failed to check upstream for ${model.model}: ${response.status}`,
      );
      return { stale: false, exists: false };
    }

    const data = await response.json();

    if (data.error) {
      console.warn(`Upstream check: ${data.error}`);
      return { stale: false, exists: false, error: data.error };
    }

    return { stale: !!data.stale, exists: true };
  } catch (error) {
    console.warn(`Error checking model staleness:`, error);
    return { stale: false, exists: false };
  }
}

export async function* pullModel(
  modelName: string,
  signal?: AbortSignal,
): AsyncGenerator<{
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  done?: boolean;
}> {
  const response = await fetch(apiUrl("/v1/models/pull"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: modelName }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to pull model: ${response.statusText}`);
  }

  for await (const event of parseJsonlFromResponse<{
    status: string;
    digest?: string;
    total?: number;
    completed?: number;
    done?: boolean;
  }>(response)) {
    yield event;
  }
}

export async function getInferenceCompute(): Promise<InferenceComputeResponse> {
  if (IS_BROWSER_DEV) {
    return new InferenceComputeResponse({ inferenceComputes: [] });
  }

  try {
    const response = await fetch(apiUrl("/v1/inference-compute"));
    if (!response.ok) {
      if (IS_BROWSER_DEV && response.status === 404) {
        return new InferenceComputeResponse({ inferenceComputes: [] });
      }
      throw new Error(
        `Failed to fetch inference compute: ${response.statusText}`,
      );
    }

    const data = await response.json();
    return new InferenceComputeResponse(data);
  } catch (error) {
    if (IS_BROWSER_DEV) {
      return new InferenceComputeResponse({ inferenceComputes: [] });
    }
    throw error;
  }
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const [versionResponse, tagsResponse] = await Promise.all([
      fetch(engineUrl("/version"), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }),
      fetch(engineUrl("/tags"), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    ]);

    if (!versionResponse.ok || !tagsResponse.ok) {
      return false;
    }

    const [versionData, tagsData] = await Promise.all([
      versionResponse.json(),
      tagsResponse.json(),
    ]);

    return Boolean(versionData?.version && Array.isArray(tagsData?.models));
  } catch (error) {
    console.error("Error checking health:", error);
    return false;
  }
}

export async function getCloudStatus(): Promise<CloudStatusResponse | null> {
  if (IS_BROWSER_DEV) {
    return {
      disabled: loadBrowserDevCloudDisabled(),
      source: "config",
    };
  }

  try {
    const response = await fetch(apiUrl("/v1/cloud"));
    if (!response.ok) {
      if (IS_BROWSER_DEV && response.status === 404) {
        return {
          disabled: true,
          source: "none",
        };
      }
      throw new Error(`Failed to fetch cloud status: ${response.status}`);
    }

    const data = await response.json();
    return {
      disabled: Boolean(data.disabled),
      source: (data.source as CloudStatusSource) || "none",
    };
  } catch (error) {
    if (IS_BROWSER_DEV) {
      return {
        disabled: true,
        source: "none",
      };
    }
    throw error;
  }
}
