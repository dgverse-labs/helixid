// Copyright 2026 DgVerse LLP
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../src/theme/ThemeContext';
import { ThemeToggle } from '../../src/components/layout/ThemeToggle';

const STORAGE_KEY = 'helixid.console.theme';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('Theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light on first load', () => {
    renderToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles to dark and persists the choice', async () => {
    renderToggle();

    await userEvent.click(screen.getByRole('switch'));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('toggles back to light', async () => {
    renderToggle();
    const toggle = screen.getByRole('switch');

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('restores the persisted theme on reload (remount)', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    renderToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});
