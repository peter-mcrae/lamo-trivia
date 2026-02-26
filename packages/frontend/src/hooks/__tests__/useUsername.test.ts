import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUsername } from '../useUsername';

describe('useUsername', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null username when localStorage is empty', () => {
    const { result } = renderHook(() => useUsername());

    expect(result.current.username).toBeNull();
    expect(result.current.hasUsername).toBe(false);
  });

  it('returns stored username from localStorage', () => {
    localStorage.setItem('lamo-trivia-username', 'TestUser');

    const { result } = renderHook(() => useUsername());

    expect(result.current.username).toBe('TestUser');
    expect(result.current.hasUsername).toBe(true);
  });

  it('setUsername stores value in localStorage and updates state', () => {
    const { result } = renderHook(() => useUsername());

    act(() => {
      result.current.setUsername('NewPlayer');
    });

    expect(result.current.username).toBe('NewPlayer');
    expect(result.current.hasUsername).toBe(true);
    expect(localStorage.getItem('lamo-trivia-username')).toBe('NewPlayer');
  });

  it('clearUsername removes from localStorage and sets state to null', () => {
    localStorage.setItem('lamo-trivia-username', 'ExistingUser');

    const { result } = renderHook(() => useUsername());
    expect(result.current.username).toBe('ExistingUser');

    act(() => {
      result.current.clearUsername();
    });

    expect(result.current.username).toBeNull();
    expect(result.current.hasUsername).toBe(false);
    expect(localStorage.getItem('lamo-trivia-username')).toBeNull();
  });

  it('hasUsername reflects current state correctly', () => {
    const { result } = renderHook(() => useUsername());

    expect(result.current.hasUsername).toBe(false);

    act(() => {
      result.current.setUsername('Player');
    });
    expect(result.current.hasUsername).toBe(true);

    act(() => {
      result.current.clearUsername();
    });
    expect(result.current.hasUsername).toBe(false);
  });
});
