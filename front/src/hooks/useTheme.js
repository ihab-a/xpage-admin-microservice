import { useState } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const t = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    return t;
  });

  const toggle = () => setTheme((t) => {
    const next = t === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    return next;
  });

  return { theme, toggle };
}
