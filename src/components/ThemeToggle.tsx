import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './Icons';

type Theme = 'dark' | 'light';

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(systemTheme);
  const [hasManualChoice, setHasManualChoice] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', theme === 'dark' ? '#0b1110' : '#f5f2ea');
    });
  }, [theme]);

  useEffect(() => {
    if (hasManualChoice || !window.matchMedia) return;
    const preference = window.matchMedia('(prefers-color-scheme: light)');
    const syncWithSystem = () => setTheme(preference.matches ? 'light' : 'dark');
    preference.addEventListener?.('change', syncWithSystem);
    return () => preference.removeEventListener?.('change', syncWithSystem);
  }, [hasManualChoice]);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      onClick={() => {
        setHasManualChoice(true);
        setTheme(nextTheme);
      }}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
