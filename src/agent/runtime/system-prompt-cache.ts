let _cachedSystemPrompt: string | null = null;

export function getCachedSystemPrompt(): string | null {
  return _cachedSystemPrompt;
}

export function setCachedSystemPrompt(value: string): void {
  _cachedSystemPrompt = value;
}

export function invalidateSystemPromptCache(): void {
  _cachedSystemPrompt = null;
}
