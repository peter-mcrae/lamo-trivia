const STORAGE_KEY = 'lamo-hunt-host-secrets';

export function getHostSecret(huntId: string): string | null {
  try {
    const secrets = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return secrets[huntId] || null;
  } catch {
    return null;
  }
}

export function removeHostSecret(huntId: string): void {
  try {
    const secrets = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    delete secrets[huntId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(secrets));
  } catch {
    // localStorage unavailable
  }
}

export function saveHostSecret(huntId: string, secret: string): void {
  try {
    const secrets = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    secrets[huntId] = secret;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(secrets));
  } catch {
    // localStorage unavailable
  }
}
