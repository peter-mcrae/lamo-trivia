export function generatePlayerId(): string {
  return crypto.randomUUID();
}

export function timestamp(): number {
  return Date.now();
}
