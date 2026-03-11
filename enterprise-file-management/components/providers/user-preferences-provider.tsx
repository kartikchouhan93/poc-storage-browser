'use client'

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

type ThemePreferences = {
  themeMode: string;
  themeColor: string;
  themeFont: string;
  themeRadius: string;
};

type UserPreferencesContextType = ThemePreferences & {
  setPreferences: (prefs: Partial<ThemePreferences>) => void;
};

const defaultPreferences: ThemePreferences = {
  themeMode: 'light',
  themeColor: 'blue',
  themeFont: 'inter',
  themeRadius: '0.3',
};

const STORAGE_KEY = 'userPreferences';

const UserPreferencesContext = createContext<UserPreferencesContextType>({
  ...defaultPreferences,
  setPreferences: () => {},
});

export function UserPreferencesProvider({
  children,
  initialPreferences,
}: {
  children: React.ReactNode;
  initialPreferences?: ThemePreferences;
}) {
  const { setTheme } = useTheme();

  const [preferences, setPreferencesState] = useState<ThemePreferences>(
    initialPreferences || defaultPreferences
  );

  // On mount, read from localStorage and apply
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ThemePreferences>;
        const merged: ThemePreferences = {
          themeMode: parsed.themeMode || defaultPreferences.themeMode,
          themeColor: parsed.themeColor || defaultPreferences.themeColor,
          themeFont: parsed.themeFont || defaultPreferences.themeFont,
          themeRadius: parsed.themeRadius || defaultPreferences.themeRadius,
        };
        setPreferencesState(merged);
        applyPreferences(merged);
      } else {
        // No stored prefs — apply defaults and persist them
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultPreferences));
        applyPreferences(defaultPreferences);
      }
    } catch {
      applyPreferences(defaultPreferences);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreferences = (prefs: ThemePreferences) => {
    setTheme(prefs.themeMode);

    const root = document.documentElement;
    root.className = root.className.replace(/\btheme-\S+/g, '');
    root.className = root.className.replace(/\bfont-\S+/g, '');
    root.className = root.className.replace(/\bradius-\S+/g, '');
    root.className = root.className.replace(/\s+/g, ' ').trim();

    root.classList.add(`theme-${prefs.themeColor}`);
    root.classList.add(`font-${prefs.themeFont}`);
    root.classList.add(`radius-${prefs.themeRadius.replace('.', '-')}`);
  };

  const setPreferences = (newPrefs: Partial<ThemePreferences>) => {
    const updatedPrefs = { ...preferences, ...newPrefs };
    setPreferencesState(updatedPrefs);
    applyPreferences(updatedPrefs);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedPrefs));
    } catch {
      console.error('Failed to save preferences to localStorage');
    }
  };

  return (
    <UserPreferencesContext.Provider value={{ ...preferences, setPreferences }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export const useUserPreferences = () => useContext(UserPreferencesContext);
