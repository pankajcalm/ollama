import MessageList from "./MessageList";
import ChatForm from "./ChatForm";
import { FileUpload } from "./FileUpload";
import { DisplayUpgrade } from "./DisplayUpgrade";
import { DisplayStale } from "./DisplayStale";
import { DisplayLogin } from "./DisplayLogin";
import {
  useChat,
  useSendMessage,
  useIsStreaming,
  useIsWaitingForLoad,
  useDownloadProgress,
  useChatError,
  useShouldShowStaleDisplay,
  useDismissStaleModel,
} from "@/hooks/useChats";
import { useHealth } from "@/hooks/useHealth";
import { useMessageAutoscroll } from "@/hooks/useMessageAutoscroll";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { useUser } from "@/hooks/useUser";
import { useHasVisionCapability } from "@/hooks/useModelCapabilities";
import { Message } from "@/gotypes";
import { ModelPicker } from "@/components/ModelPicker";

export default function Chat({ chatId }: { chatId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const chatQuery = useChat(chatId === "new" ? "" : chatId);
  const chatErrorQuery = useChatError(chatId === "new" ? "" : chatId);
  const { selectedModel, models, loading: modelsLoading } = useSelectedModel(chatId);
  const { user } = useUser();
  const hasVisionCapability = useHasVisionCapability(selectedModel?.model);
  const shouldShowStaleDisplay = useShouldShowStaleDisplay(selectedModel);
  const dismissStaleModel = useDismissStaleModel();
  const { isHealthy } = useHealth();

  const [editingMessage, setEditingMessage] = useState<{
    content: string;
    index: number;
    originalMessage: Message;
  } | null>(null);
  const prevChatIdRef = useRef<string>(chatId);

  const chatFormCallbackRef = useRef<
    | ((
        files: Array<{ filename: string; data: Uint8Array; type?: string }>,
        errors: Array<{ filename: string; error: string }>,
      ) => void)
    | null
  >(null);

  const handleFilesReceived = useCallback(
    (
      callback: (
        files: Array<{
          filename: string;
          data: Uint8Array;
          type?: string;
        }>,
        errors: Array<{ filename: string; error: string }>,
      ) => void,
    ) => {
      chatFormCallbackRef.current = callback;
    },
    [],
  );

  const handleFilesProcessed = useCallback(
    (
      files: Array<{ filename: string; data: Uint8Array; type?: string }>,
      errors: Array<{ filename: string; error: string }> = [],
    ) => {
      chatFormCallbackRef.current?.(files, errors);
    },
    [],
  );

  const allMessages = chatQuery?.data?.chat?.messages ?? [];
  // TODO(parthsareen): will need to consolidate when used with more tools with state
  const browserToolResult = chatQuery?.data?.chat?.browser_state;
  const chatError = chatErrorQuery.data;

  const messages = allMessages;
  const isStreaming = useIsStreaming(chatId);
  const isWaitingForLoad = useIsWaitingForLoad(chatId);
  const downloadProgress = useDownloadProgress(chatId);
  const isDownloadingModel = downloadProgress && !downloadProgress.done;
  const isDisabled = !isHealthy;

  // Clear editing state when navigating to a different chat
  useEffect(() => {
    setEditingMessage(null);
  }, [chatId]);

  const sendMessageMutation = useSendMessage(chatId);

  const { containerRef, handleNewUserMessage, spacerHeight } =
    useMessageAutoscroll({
      messages,
      isStreaming,
      chatId,
    });

  // Scroll to bottom only when switching to a different existing chat
  useLayoutEffect(() => {
    // Only scroll if the chatId actually changed (not just messages updating)
    if (
      prevChatIdRef.current !== chatId &&
      containerRef.current &&
      messages.length > 0 &&
      chatId !== "new"
    ) {
      // Always scroll to the bottom when opening a chat
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevChatIdRef.current = chatId;
  }, [chatId, messages.length]);

  // Simplified submit handler - ChatForm handles all the attachment logic
  const handleChatFormSubmit = (
    message: string,
    options: {
      attachments?: Array<{ filename: string; data: Uint8Array }>;
      index?: number;
      webSearch?: boolean;
      fileTools?: boolean;
      think?: boolean | string;
    },
  ) => {
    // Clear any existing errors when sending a new message
    sendMessageMutation.reset();
    if (chatError) {
      clearChatError();
    }

    // Prepare attachments for backend
    const allAttachments = (options.attachments || []).map((att) => ({
      filename: att.filename,
      data: att.data.length === 0 ? new Uint8Array(0) : att.data,
    }));

    sendMessageMutation.mutate({
      message,
      attachments: allAttachments,
      index: editingMessage ? editingMessage.index : options.index,
      webSearch: options.webSearch,
      fileTools: options.fileTools,
      think: options.think,
      onChatEvent: (event: { eventName?: string; chatId?: string }) => {
        if (event.eventName === "chat_created" && event.chatId) {
          navigate({
            to: "/c/$chatId",
            params: {
              chatId: event.chatId,
            },
          });
        }
      },
    });

    // Clear edit mode after submission
    setEditingMessage(null);
    handleNewUserMessage();
  };

  const handleEditMessage = (content: string, index: number) => {
    setEditingMessage({
      content,
      index,
      originalMessage: messages[index],
    });
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    if (chatError) {
      clearChatError();
    }
  };

  const clearChatError = () => {
    queryClient.setQueryData(
      ["chatError", chatId === "new" ? "" : chatId],
      null,
    );
  };

  const isWindows = navigator.platform.toLowerCase().includes("win");

  return chatId === "new" || chatQuery ? (
    <FileUpload
      onFilesAdded={handleFilesProcessed}
      selectedModel={selectedModel}
      hasVisionCapability={hasVisionCapability}
    >
      {chatId === "new" ? (
        <div className="flex flex-col h-full justify-center relative bg-[var(--app-bg)]">
          {!modelsLoading && models.length === 0 && (
            <div className="mx-auto mb-4 w-full max-w-[768px] rounded-xl border border-[var(--app-border)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--muted-fg)]">
              No local models found. Pull a model from <strong>/models</strong> to start a new chat.
            </div>
          )}
          <div className="px-6">
            <ChatForm
              hasMessages={false}
              onSubmit={handleChatFormSubmit}
              chatId={chatId}
              autoFocus={true}
              editingMessage={editingMessage}
              onCancelEdit={handleCancelEdit}
              isDownloadingModel={isDownloadingModel}
              isDisabled={isDisabled}
              onFilesReceived={handleFilesReceived}
            />
          </div>
        </div>
      ) : (
        <main className="flex h-full w-full flex-col relative allow-context-menu select-none bg-[var(--app-bg)]">
          <div className="sticky top-0 z-10 border-b border-[var(--app-border)] bg-[var(--panel-bg)]/95 px-4 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <ModelPicker chatId={chatId} isDisabled={isDisabled} />
              <span className={`rounded-full px-2 py-1 text-xs ${isHealthy ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                {isHealthy ? "Engine connected" : "Engine offline"}
              </span>
              <span className="rounded-full bg-[var(--hover-bg)] px-2 py-1 text-xs text-[var(--muted-fg)]">Streaming {isStreaming ? "on" : "idle"}</span>
              <details className="group ml-auto">
                <summary className="cursor-pointer rounded-md px-2 py-1 text-xs text-[var(--muted-fg)] hover:bg-[var(--hover-bg)]">Advanced</summary>
                <div className="absolute right-4 mt-2 w-64 rounded-xl border border-[var(--app-border)] bg-[var(--panel-bg)] p-3 text-xs shadow-lg">
                  <p className="text-[var(--muted-fg)]">Per-chat advanced controls are available through model capabilities and settings.</p>
                  <p className="mt-2 text-[var(--muted-fg)]">Use settings for defaults (temperature, top_p, context length, seed).</p>
                </div>
              </details>
            </div>
            {!isHealthy && (
              <p className="mt-2 rounded-md border border-amber-300/50 bg-amber-100/60 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                Ollama backend is unreachable. Start the local engine and keep this window open to reconnect automatically.
              </p>
            )}
          </div>
          <section
            key={chatId} // This key forces React to recreate the element when chatId changes
            ref={containerRef}
            className={`flex-1 overflow-y-auto overscroll-contain relative min-h-0 select-none ${isWindows ? "pt-2" : "pt-3"}`}
          >
            <MessageList
              messages={messages}
              spacerHeight={spacerHeight}
              isWaitingForLoad={isWaitingForLoad}
              isStreaming={isStreaming}
              downloadProgress={downloadProgress}
              onEditMessage={(content: string, index: number) => {
                handleEditMessage(content, index);
              }}
              editingMessageIndex={editingMessage?.index}
              error={chatError}
              browserToolResult={browserToolResult}
            />
          </section>

          <div className="flex-shrink-0 sticky bottom-0 z-20">
            {selectedModel && shouldShowStaleDisplay && (
              <div className="pb-2">
                <DisplayStale
                  model={selectedModel}
                  onDismiss={() =>
                    dismissStaleModel(selectedModel?.model || "")
                  }
                  chatId={chatId}
                  onScrollToBottom={() => {
                    if (containerRef.current) {
                      containerRef.current.scrollTo({
                        top: containerRef.current.scrollHeight,
                        behavior: "smooth",
                      });
                    }
                  }}
                />
              </div>
            )}
            {chatError && chatError.code === "usage_limit_upgrade" && (
              <div className="pb-2">
                <DisplayUpgrade
                  error={chatError}
                  onDismiss={clearChatError}
                  href={
                    user?.plan === "pro"
                      ? "https://ollama.com/settings/billing"
                      : "https://ollama.com/upgrade"
                  }
                />
              </div>
            )}
            {chatError && chatError.code === "cloud_unauthorized" && (
              <div className="pb-2">
                <DisplayLogin error={chatError} />
              </div>
            )}
            <ChatForm
              hasMessages={messages.length > 0}
              onSubmit={handleChatFormSubmit}
              chatId={chatId}
              autoFocus={true}
              editingMessage={editingMessage}
              onCancelEdit={handleCancelEdit}
              isDisabled={isDisabled}
              isDownloadingModel={isDownloadingModel}
              onFilesReceived={handleFilesReceived}
            />
          </div>
        </main>
      )}
    </FileUpload>
  ) : (
    <div>Loading...</div>
  );
}
