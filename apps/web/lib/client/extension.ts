type ChromeRuntime = {
  sendMessage(extensionId: string, message: unknown, callback: (reply: unknown) => void): void;
  lastError?: { message?: string };
};

function runtime(): ChromeRuntime | undefined {
  return (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
}

/**
 * Sends a message to the focal extension through externally_connectable.
 * Resolves null when the extension isn't installed or doesn't answer.
 */
export function sendToExtension<T = { ok?: boolean }>(extensionId: string, message: unknown): Promise<T | null> {
  const rt = runtime();
  if (!extensionId || !rt?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(extensionId, message, (reply) => resolve(rt.lastError ? null : ((reply as T) ?? null)));
    } catch {
      resolve(null);
    }
  });
}
