/** Shared account identity used by Host synchronization and renderer model menus. */
export function runtimeProviderKey(type: string, id: string): string {
  if (type === 'custom' || type === 'ollama') {
    const prefix = `${type}-`;
    const suffix = id.startsWith(prefix) ? id.slice(prefix.length) : '';
    if (suffix.length === 8 && !suffix.includes('-')) return id;
    return `${type}-${id.replace(/-/g, '').slice(0, 8)}`;
  }
  return type === 'minimax-portal-cn' ? 'minimax-portal' : type;
}

export function runtimeAccountProviderKey(account: { vendorId: string; id: string; authMode?: string }): string {
  if (account.vendorId === 'openai' && account.authMode === 'oauth_browser') return 'openai-codex';
  return runtimeProviderKey(account.vendorId, account.id);
}
