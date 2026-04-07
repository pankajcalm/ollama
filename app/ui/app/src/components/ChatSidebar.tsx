import { useChats } from "@/hooks/useChats";
import { useRenameChat } from "@/hooks/useRenameChat";
import { useDeleteChat } from "@/hooks/useDeleteChat";
import { useQueryClient } from "@tanstack/react-query";
import { getChat } from "@/api";
import { Link } from "@/components/ui/link";
import { useState, useRef, useEffect, useCallback, useMemo, type MouseEvent } from "react";
import { ChatsResponse } from "@/gotypes";
import {
  Cog6ToothIcon,
  RocketLaunchIcon,
  MagnifyingGlassIcon,
  BookOpenIcon,
} from "@heroicons/react/24/outline";

const DEBUG_SHIFT_CLICKS_REQUIRED = 5;
const DEBUG_SHIFT_CLICK_WINDOW_MS = 7000;

interface ChatSidebarProps {
  currentChatId?: string;
}

export function ChatSidebar({ currentChatId }: ChatSidebarProps) {
  const { data, isLoading, error } = useChats();
  const queryClient = useQueryClient();
  const renameMutation = useRenameChat();
  const deleteMutation = useDeleteChat();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [shiftClicks, setShiftClicks] = useState<Record<string, number[]>>({});

  const handleMouseEnter = useCallback(
    (chatId: string) => {
      queryClient.prefetchQuery({
        queryKey: ["chat", chatId],
        queryFn: () => getChat(chatId),
        staleTime: 1500,
      });
    },
    [queryClient],
  );

  const saveRename = useCallback(async () => {
    if (!editingChatId || !editValue.trim()) {
      setEditingChatId(null);
      return;
    }

    const newTitle = editValue.trim();
    const chatId = editingChatId;
    setEditingChatId(null);
    setEditValue("");

    queryClient.setQueryData(["chats"], (oldData: ChatsResponse | undefined) => {
      if (!oldData?.chatInfos) return oldData;
      return {
        ...oldData,
        chatInfos: oldData.chatInfos.map((chat) =>
          chat.id === chatId ? { ...chat, title: newTitle } : chat,
        ),
      };
    });

    try {
      await renameMutation.mutateAsync({ chatId, title: newTitle });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    }
  }, [editingChatId, editValue, renameMutation, queryClient]);

  useEffect(() => {
    if (editingChatId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingChatId]);

  const sortedChats = useMemo(() => {
    if (!data?.chatInfos) return [];
    return [...data.chatInfos].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }, [data?.chatInfos]);

  const filteredChats = useMemo(() => {
    type ChatInfo = NonNullable<ChatsResponse["chatInfos"]>[number];
    const query = search.toLowerCase().trim();
    if (!query) return sortedChats;
    return sortedChats.filter((chat: ChatInfo) =>
      `${chat.title || ""} ${chat.userExcerpt || ""}`.toLowerCase().includes(query),
    );
  }, [search, sortedChats]);

  const pinnedChats = filteredChats.slice(0, 3);
  const recentChats = filteredChats.slice(3);

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      if (!window.confirm("Delete this chat?")) return;
      try {
        await deleteMutation.mutateAsync(chatId);
      } catch (err) {
        console.error("Failed to delete chat", err);
      }
    },
    [deleteMutation],
  );

  const handleShiftClick = useCallback(
    async (e: MouseEvent, chatId: string) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      const now = Date.now();
      const clicks = shiftClicks[chatId] || [];
      const recentClicks = clicks.filter((timestamp: number) => now - timestamp < DEBUG_SHIFT_CLICK_WINDOW_MS);
      recentClicks.push(now);
      setShiftClicks((prev: Record<string, number[]>) => ({ ...prev, [chatId]: recentClicks }));
      if (recentClicks.length >= DEBUG_SHIFT_CLICKS_REQUIRED) {
        const chatData = await getChat(chatId);
        await navigator.clipboard.writeText(JSON.stringify(chatData, null, 2));
        setShiftClicks((prev: Record<string, number[]>) => ({ ...prev, [chatId]: [] }));
      }
    },
    [shiftClicks],
  );

  const handleContextMenu = useCallback(
    async (_: MouseEvent, chatId: string, chatTitle: string) => {
      const selectedAction = await window.menu([
        { label: "Rename", enabled: true },
        { label: "Delete", enabled: true },
      ]);

      if (selectedAction === "Rename") {
        setEditingChatId(chatId);
        setEditValue(chatTitle);
      }
      if (selectedAction === "Delete") {
        handleDeleteChat(chatId);
      }
    },
    [handleDeleteChat],
  );

  const renderSection = (title: string, chats: typeof filteredChats) => (
    <section className="space-y-1" aria-label={title}>
      <h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-fg)]">{title}</h3>
      {chats.length === 0 ? (
        <p className="px-2 text-sm text-[var(--muted-fg)]">No chats</p>
      ) : (
        chats.map((chat: NonNullable<ChatsResponse["chatInfos"]>[number]) => {
          const label = chat.title || chat.userExcerpt || chat.createdAt.toLocaleString();
          return (
            <div
              key={chat.id}
              className={`rounded-lg ${chat.id === currentChatId ? "bg-[var(--hover-bg)]" : "hover:bg-[var(--hover-bg)]"}`}
              onMouseEnter={() => handleMouseEnter(chat.id)}
              onContextMenu={(e) => handleContextMenu(e, chat.id, label)}
            >
              {editingChatId === chat.id ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") setEditingChatId(null);
                  }}
                  className="w-full rounded-lg bg-transparent px-3 py-2 text-sm focus:outline-none"
                />
              ) : (
                <Link
                  to="/c/$chatId"
                  params={{ chatId: chat.id }}
                  className="block truncate px-3 py-2 text-sm"
                  onClick={(e) => handleShiftClick(e, chat.id)}
                >
                  {label}
                </Link>
              )}
            </div>
          );
        })
      )}
    </section>
  );

  return (
    <nav className="flex min-h-0 flex-1 flex-col p-3">
      <Link href="/c/new" mask={{ to: "/" }} className="mb-3 rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-500">
        + New chat
      </Link>

      <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5">
        <MagnifyingGlassIcon className="h-4 w-4 text-[var(--muted-fg)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats"
          className="w-full bg-transparent text-sm outline-none"
          aria-label="Search chats"
        />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-1">
        <Link to="/c/$chatId" params={{ chatId: "launch" }} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--hover-bg)]">
          <RocketLaunchIcon className="h-4 w-4" /> Launch
        </Link>
        <Link href="/models" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--hover-bg)]">
          <BookOpenIcon className="h-4 w-4" /> Model Library
        </Link>
        <Link href="/settings" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--hover-bg)]">
          <Cog6ToothIcon className="h-4 w-4" /> Settings
        </Link>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {isLoading && <p className="text-sm text-[var(--muted-fg)]">Loading chats...</p>}
        {error && <p className="text-sm text-red-500">Could not load chats.</p>}
        {!isLoading && !error && (
          <>
            {renderSection("Pinned", pinnedChats)}
            {renderSection("Recent", recentChats)}
          </>
        )}
      </div>
    </nav>
  );
}
