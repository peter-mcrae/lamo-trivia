import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RiddleWordle from '../RiddleWordle';

vi.mock('@lamo-trivia/shared', () => ({
  RIDDLES: [{ id: 'frog', text: 'I hop and croak. What am I?', answer: 'FROG' }],
  RIDDLE_MAX_GUESSES: 5,
  isValidWord: () => true,
}));

function renderGame() {
  render(
    <MemoryRouter>
      <header><input aria-label="Game code" /></header>
      <RiddleWordle />
    </MemoryRouter>,
  );
}

describe('Riddle Guess keyboard integration', () => {
  it('keeps game-code typing out of the riddle guess', () => {
    renderGame();
    const code = screen.getByRole('textbox', { name: 'Game code' });
    code.focus();
    fireEvent.keyDown(code, { key: 'B' });
    code.blur();
    for (const key of 'FROG') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByText('You solved it!')).toBeInTheDocument();
  });

  it('supports physical letters after choosing an on-screen key', () => {
    renderGame();
    const firstLetter = screen.getByRole('button', { name: 'F' });
    firstLetter.focus();
    fireEvent.click(firstLetter);
    for (const key of 'ROG') fireEvent.keyDown(firstLetter, { key });
    fireEvent.click(screen.getByRole('button', { name: 'Submit guess' }));
    expect(screen.getByText('You solved it!')).toBeInTheDocument();
  });
});
