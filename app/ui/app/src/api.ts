import {
  ChatResponse,
  ChatsResponse,
  ChatEvent,
  DownloadEvent,
  ErrorEvent,
  InferenceComputeResponse,
  ModelCapabilitiesResponse,
  Model,
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

let browserDevSettings = new Settings(defaultSettings);
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
  const response = await fetch(desktopApiPath("/api/me"), {
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
  const response = await fetch(desktopApiPath("/api/me"), {
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
  const response = await fetch(desktopApiPath("/api/signout"), {
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
  const response = await fetch(desktopApiPath("/api/v1/chats"));
  const data = await response.json();
  return new ChatsResponse(data);
}

export async function getChat(chatId: string): Promise<ChatResponse> {
  const response = await fetch(desktopApiPath(`/api/v1/chat/${chatId}`));
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
  // Convert Uint8Array to base64 for JSON serialization
  const serializedAttachments = attachments?.map((att) => ({
    filename: att.filename,
    data: uint8ArrayToBase64(att.data),
  }));

  // Send think parameter when it's explicitly set (true, false, or a non-empty string).
  const shouldSendThink =
    think !== undefined &&
    (typeof think === "boolean" || (typeof think === "string" && think !== ""));

  const response = await fetch(desktopApiPath(`/api/v1/chat/${chatId}`), {
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
  try {
    const response = await fetch(desktopApiPath("/api/v1/settings"));
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
    return {
      settings: browserDevSettings,
    };
  }

  const response = await fetch(desktopApiPath("/api/v1/settings"), {
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
    return {
      disabled: !enabled,
      source: "config",
    };
  }

  const response = await fetch(desktopApiPath("/api/v1/cloud"), {
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
  const response = await fetch(desktopApiPath(`/api/v1/chat/${chatId}/rename`), {
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
  const response = await fetch(desktopApiPath(`/api/v1/chat/${chatId}`), {
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
    const response = await fetch(desktopApiPath("/api/v1/model/upstream"), {
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
  const response = await fetch(desktopApiPath("/api/v1/models/pull"), {
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
  try {
    const response = await fetch(desktopApiPath("/api/v1/inference-compute"));
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
      fetch(engineApiPath("/version"), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }),
      fetch(engineApiPath("/tags"), {
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
  try {
    const response = await fetch(desktopApiPath("/api/v1/cloud"));
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
