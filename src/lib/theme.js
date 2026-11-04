import { useEffect, useState } from 'react';

const KEY = 'fragio-theme';

function load() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(load);
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    try {
      if (theme) localStorage.setItem(KEY, theme);
      else localStorage.removeItem(KEY);
    } catch {
      /* Speicher nicht verfügbar – Einstellung gilt nur für diese Sitzung */
    }
  }, [theme]);

  const effective =
    theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const toggle = () => setTheme(effective === 'dark' ? 'light' : 'dark');
  return { effective, toggle };
}
