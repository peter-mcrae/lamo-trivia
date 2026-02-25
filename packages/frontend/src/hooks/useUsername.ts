import { useState, useCallback } from 'react';

const STORAGE_KEY = 'lamo-trivia-username';

export function useUsername() {
  const [username, setUsernameState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });

  const setUsername = useCallback((name: string) => {
    localStorage.setItem(STORAGE_KEY, name);
    setUsernameState(name);
  }, []);

  const clearUsername = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUsernameState(null);
  }, []);

  return { username, setUsername, clearUsername, hasUsername: !!username };
}
