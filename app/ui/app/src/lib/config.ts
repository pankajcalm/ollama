const DEV_DESKTOP_API_URL = "http://127.0.0.1:3001";

const browserDevEnv = String(import.meta.env.VITE_BROWSER_DEV || "").toLowerCase();
export const IS_BROWSER_DEV =
  import.meta.env.DEV && browserDevEnv !== "false" && browserDevEnv !== "0";

export const ENGINE_API_BASE = import.meta.env.DEV ? "/api" : "";
export const DESKTOP_API_BASE =
  import.meta.env.DEV && !IS_BROWSER_DEV ? DEV_DESKTOP_API_URL : ENGINE_API_BASE;

export function engineApiPath(path: string): string {
  return `${ENGINE_API_BASE}${path}`;
}

export function desktopApiPath(path: string): string {
  return `${DESKTOP_API_BASE}${path}`;
}

// Full host URL for Ollama client (needs full origin)
export const OLLAMA_HOST =
  import.meta.env.DEV && !IS_BROWSER_DEV
    ? DEV_DESKTOP_API_URL
    : window.location.origin;

export const OLLAMA_DOT_COM =
  import.meta.env.VITE_OLLAMA_DOT_COM_URL || "https://ollama.com";
