# Ollama UI Redesign Plan

## Screens
1. **Chat**: Conversational center with sticky header (model + status), streaming thread, resilient composer.
2. **Sidebar**: Collapsible navigation with New Chat, search, Pinned/Recent, Launch, Settings, Model Library.
3. **Model Picker**: In-chat selector for per-chat model choice with search + keyboard navigation.
4. **Settings**: Existing route retained; refined to act as source of defaults and system prompt settings.
5. **Model Library**: Dedicated page to inspect local models, pull new models, and remove unused models.
6. **File Attachments**: First-class inside composer, with chips/previews/removal and validation feedback.

## Component inventory
- `components/shell/AppShell`: global shell layout, sidebar collapse, top utility bar.
- `components/ChatSidebar`: chat navigation, search, grouped conversation lists.
- `components/Chat`: orchestration layer for health, header controls, stale/error banners.
- `components/chat/*` (existing): message list/thread, bubbles, streaming states, tool cards.
- `components/ChatForm`: composer, uploads, send/stop controls, auth prompts.
- `components/models/ModelLibrary`: local model inventory, pull progress, delete actions.
- `components/ModelPicker`: per-chat model selection and discoverability.

## Interaction states
- **Loading**: skeleton/placeholder text in sidebar, model library, and chats.
- **Empty**: clear zero-state messages for chats and models.
- **Error**: visible banners/toasts for failed fetches and chat send errors.
- **Offline/Unreachable backend**: persistent status chip + actionable banner with “start Ollama engine” guidance.

## Theme strategy
- Use CSS variables for app surface/text/border/hover primitives.
- Respect system dark mode, while keeping manual theme controls in Settings.
- Keep contrast-safe neutrals and semantic status colors for accessibility.

## Conversion-oriented UX notes
- Keep “New chat” highly visible.
- Surface local-first privacy value in model library and settings copy.
- Reduce friction with quick model switching and immediate backend status feedback.
