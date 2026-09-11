import { describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import resolveConfig from 'tailwindcss/resolveConfig';
import { Timer } from '../Timer';
import tailwindConfig from '../../../tailwind.config';

/**
 * The bug this guards was a *contrast* failure, not a naming one: a palette
 * change turned `lamo-lime` into a near-white pale blue and the timer fill
 * measured ~1.1:1 against its track — effectively invisible. Asserting the
 * class name cannot catch that again, because the next palette edit that
 * washes a colour out keeps every class name identical. So resolve the real
 * colours out of the Tailwind config and measure.
 */
const palette = (
  resolveConfig(tailwindConfig) as unknown as {
    theme: { colors: Record<string, string | Record<string, string>> };
  }
).theme.colors;

/** WCAG 2.1 SC 1.4.11 — non-text contrast for UI components. */
const MIN_CONTRAST = 3;

function resolveColor(token: string): string {
  const direct = palette[token];
  if (typeof direct === 'string') return direct;

  // `lamo-blue` -> palette.lamo.blue, `red-500` -> palette.red['500']
  const [group, ...rest] = token.split('-');
  const scale = palette[group];
  const value = typeof scale === 'object' && scale !== null ? scale[rest.join('-')] : undefined;
  if (typeof value !== 'string') throw new Error(`No palette entry for "${token}"`);
  return value;
}

/** The hex the element's `bg-*` utility actually paints. */
function background(el: Element): { token: string; hex: string } {
  const token = el.className
    .split(/\s+/)
    .find((c) => c.startsWith('bg-'))
    ?.slice('bg-'.length);
  if (!token) throw new Error(`No bg-* class on "${el.className}"`);
  return { token, hex: resolveColor(token) };
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(match[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Render, then measure the fill against the track it sits in. */
function measureFill(seconds: number) {
  render(<Timer seconds={seconds} total={20} />);
  const fill = screen.getByTestId('timer-fill');
  const track = fill.parentElement;
  if (!track) throw new Error('timer fill has no track to sit in');

  const fillBg = background(fill);
  const trackBg = background(track);
  return {
    fill,
    fillBg,
    trackBg,
    ratio: contrastRatio(fillBg.hex, trackBg.hex),
    describe: () =>
      `bg-${fillBg.token} (${fillBg.hex}) on bg-${trackBg.token} (${trackBg.hex})`,
  };
}

describe('Timer', () => {
  it('fills with a colour that still reads against the track', () => {
    const { ratio, describe: why } = measureFill(20);

    expect(ratio, `${why()} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('keeps the urgent fill readable too, and distinct from the normal one', () => {
    const normal = measureFill(20).fillBg.hex;
    cleanup();
    const urgent = measureFill(3);

    expect(
      urgent.ratio,
      `${urgent.describe()} = ${urgent.ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // The last-5-seconds state has to be visibly different, not just differently named
    expect(urgent.fillBg.hex).not.toBe(normal);
  });

  it('sizes the fill width from the seconds/total ratio', () => {
    render(<Timer seconds={10} total={20} />);

    const fill = screen.getByTestId('timer-fill');
    expect(fill.style.width).toBe('50%');
  });

  it('exposes the remaining time to assistive tech via the progressbar role', () => {
    render(<Timer seconds={12} total={20} />);

    const progressbar = screen.getByRole('progressbar', { name: 'Time remaining' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '12');
    expect(progressbar).toHaveAttribute('aria-valuemax', '20');
  });
});
