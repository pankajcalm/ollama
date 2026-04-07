import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/shell/AppShell";
import { ChatSidebar } from "@/components/ChatSidebar";
import ModelLibrary from "@/components/models/ModelLibrary";

export const Route = createFileRoute("/models")({
  component: ModelsRoute,
});

function ModelsRoute() {
  return (
    <AppShell sidebar={<ChatSidebar />}>
      <ModelLibrary />
    </AppShell>
  );
}
