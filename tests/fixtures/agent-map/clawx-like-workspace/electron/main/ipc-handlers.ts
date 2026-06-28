import type { IpcMain } from "electron";
import type { ChatRequest } from "../../shared/types/chat";
import { dispatchRuntimeMessage } from "../../openclaw_runtime/src/runtime-core/chat-dispatch";

export const chatIpcChannel = "chat:send";

export function registerChatIpcHandlers(ipcMain: Pick<IpcMain, "handle">) {
  ipcMain.handle(chatIpcChannel, async (_event, request: ChatRequest) => {
    return dispatchRuntimeMessage(request);
  });
}
