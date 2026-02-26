import { useState, useCallback } from 'react';

interface SavedGroup {
  groupId: string;
  name: string;
  joinedAt: number;
}

const STORAGE_KEY = 'lamo-trivia-groups';

function loadGroups(): SavedGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveGroups(groups: SavedGroup[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

export function useGroups() {
  const [groups, setGroups] = useState<SavedGroup[]>(loadGroups);

  const addGroup = useCallback((groupId: string, name: string) => {
    setGroups((prev) => {
      // Don't duplicate
      if (prev.some((g) => g.groupId === groupId)) return prev;
      const updated = [...prev, { groupId, name, joinedAt: Date.now() }];
      saveGroups(updated);
      return updated;
    });
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setGroups((prev) => {
      const updated = prev.filter((g) => g.groupId !== groupId);
      saveGroups(updated);
      return updated;
    });
  }, []);

  const hasGroup = useCallback(
    (groupId: string) => groups.some((g) => g.groupId === groupId),
    [groups],
  );

  return { groups, addGroup, removeGroup, hasGroup };
}
