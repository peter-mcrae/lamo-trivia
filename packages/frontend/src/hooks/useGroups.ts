import { useState, useCallback } from 'react';

interface SavedGroup {
  groupId: string;
  name: string;
  joinedAt: number;
  memberId?: string;
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

function saveGroupsToStorage(groups: SavedGroup[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

/**
 * The member token this device holds for a group, for callers outside React.
 * It is what proves to the server that a member record is ours, so the API
 * layer needs it when linking a membership to the signed-in account.
 */
export function getStoredMemberId(groupId: string): string | null {
  return loadGroups().find((g) => g.groupId === groupId)?.memberId ?? null;
}

export function useGroups() {
  const [groups, setGroups] = useState<SavedGroup[]>(loadGroups);

  const addGroup = useCallback((groupId: string, name: string) => {
    setGroups((prev) => {
      // Don't duplicate
      if (prev.some((g) => g.groupId === groupId)) return prev;
      const updated = [...prev, { groupId, name, joinedAt: Date.now() }];
      saveGroupsToStorage(updated);
      return updated;
    });
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setGroups((prev) => {
      const updated = prev.filter((g) => g.groupId !== groupId);
      saveGroupsToStorage(updated);
      return updated;
    });
  }, []);

  const hasGroup = useCallback(
    (groupId: string) => groups.some((g) => g.groupId === groupId),
    [groups],
  );

  const setMemberId = useCallback((groupId: string, memberId: string) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.groupId === groupId ? { ...g, memberId } : g,
      );
      saveGroupsToStorage(updated);
      return updated;
    });
  }, []);

  const getMemberId = useCallback(
    (groupId: string): string | null =>
      groups.find((g) => g.groupId === groupId)?.memberId ?? null,
    [groups],
  );

  return { groups, addGroup, removeGroup, hasGroup, setMemberId, getMemberId };
}
