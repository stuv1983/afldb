'use client';

import { THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

/**
 * Light/dark switch.
 *
 * The reader's choice is stored under {@link THEME_STORAGE_KEY} and stamped
 * on `<html data-theme>`; with nothing stored the palette follows the
 * operating system, which is what a first-time visitor gets.
 *
 * Which face of the button is showing is decided entirely in CSS, by the
 * same rules that pick the palette. That matters: the control is already
 * correct in the server-rendered HTML, so it cannot flash the wrong icon
 * or mismatch on hydration, and only the click needs JavaScript. Both
 * faces are in the DOM and the inactive one is `display: none`, which
 * hides it from assistive technology as well as from view — so a screen
 * reader announces exactly one label.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;

    // An explicit choice wins; otherwise read what the OS is currently
    // giving us, so the first click always visibly flips the page.
    const current: Theme = root.dataset.theme === 'dark' || root.dataset.theme === 'light'
      ? root.dataset.theme
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';

    const next: Theme = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing or a full quota: the page still switches for
      // this visit, it simply will not be remembered.
    }
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle}>
      <span className="when-light">
        <MoonIcon />
        <span className="visually-hidden">Switch to dark mode</span>
      </span>
      <span className="when-dark">
        <SunIcon />
        <span className="visually-hidden">Switch to light mode</span>
      </span>
    </button>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3Z" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1"
        strokeLinecap="round" />
    </svg>
  );
}
