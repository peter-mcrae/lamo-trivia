import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RematchModal } from '../RematchModal';
import type { GameConfig } from '@lamo-trivia/shared';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    createGame: vi.fn(),
    getCategories: vi.fn().mockResolvedValue({
      categories: [
        { id: 'general', name: 'General Knowledge', icon: '🧠', questionCount: 50 },
      ],
    }),
  },
}));

import { api } from '@/lib/api';

const mockConfig: GameConfig = {
  name: 'Test Game',
  categoryIds: ['general'],
  questionCount: 10,
  minPlayers: 1,
  maxPlayers: 8,
  timePerQuestion: 15,
  scoringMethod: 'speed-bonus',
  streakBonus: false,
  showAnswers: true,
  timeBetweenQuestions: 5,
  isPrivate: false,
};

describe('RematchModal', () => {
  const onRematchCreated = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Play Again title', () => {
    render(
      <RematchModal
        currentConfig={mockConfig}
        onRematchCreated={onRematchCreated}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Play Again')).toBeInTheDocument();
  });

  it('renders close button that calls onClose', () => {
    render(
      <RematchModal
        currentConfig={mockConfig}
        onRematchCreated={onRematchCreated}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls api.createGame and onRematchCreated on successful submit', async () => {
    vi.mocked(api.createGame).mockResolvedValue({ gameId: 'NEW-GAME-1' });

    render(
      <RematchModal
        currentConfig={mockConfig}
        onRematchCreated={onRematchCreated}
        onClose={onClose}
      />,
    );

    // Wait for async categories to load into form state
    await waitFor(() => {
      expect(screen.getByText('General Knowledge')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /start new game/i }));

    await waitFor(() => {
      expect(api.createGame).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(onRematchCreated).toHaveBeenCalledWith('NEW-GAME-1');
    });
  });

  it('shows error message when api.createGame fails', async () => {
    vi.mocked(api.createGame).mockRejectedValue(new Error('Server error'));

    render(
      <RematchModal
        currentConfig={mockConfig}
        onRematchCreated={onRematchCreated}
        onClose={onClose}
      />,
    );

    // Wait for async categories to load into form state
    await waitFor(() => {
      expect(screen.getByText('General Knowledge')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /start new game/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to create game. Try again.')).toBeInTheDocument();
    });

    expect(onRematchCreated).not.toHaveBeenCalled();
  });
});
