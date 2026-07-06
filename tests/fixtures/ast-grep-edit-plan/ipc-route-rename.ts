export function send(payload: unknown) {
  return ipcRenderer.invoke("old-route", payload);
}
