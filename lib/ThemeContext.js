import React, { createContext, useContext, useState, useEffect } from 'react';
import { darkThemeColors, lightThemeColors, appTypography } from './darkThemeConfig';
import { getThemePreference, setThemePreference } from './settingsCache';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(false); // Default to light theme for a Zomato-like look

  // Load theme preference from AsyncStorage settings cache
  useEffect(() => {
    loadThemePreference();
  }, []);

  const loadThemePreference = async () => {
    try {
      const savedTheme = await getThemePreference();
      setIsDarkMode(savedTheme === 'dark');
      if (savedTheme !== 'dark' && savedTheme !== 'light') {
        await setThemePreference(false);
      }
    } catch (error) {
      console.log('Error loading theme preference:', error);
    }
  };

  const toggleTheme = async () => {
    try {
      const newTheme = !isDarkMode;
      setIsDarkMode(newTheme);
      await setThemePreference(newTheme);
    } catch (error) {
      console.log('Error saving theme preference:', error);
    }
  };

  // Theme colors
  const theme = {
    isDarkMode,
    toggleTheme,
    colors: isDarkMode ? darkThemeColors : lightThemeColors,
    typography: appTypography,
  };

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};
