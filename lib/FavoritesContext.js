import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { favoritesService } from './supabase';

const FavoritesContext = createContext();

export const useFavorites = () => {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
};

export const FavoritesProvider = ({ children }) => {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load favorites when user changes
  useEffect(() => {
    if (user) {
      loadFavorites();
    } else {
      setFavorites([]);
    }
  }, [user]);

  const loadFavorites = async () => {
    // Favorites feature disabled - don't load anything
    setFavorites([]);
    setLoading(false);
    return;
  };

  const toggleFavorite = async (foodItemId) => {
    // Favorites feature disabled - do nothing
    return;
  };

  const removeFromFavorites = async (foodItemId) => {
    // Favorites feature disabled - do nothing
    return;
  };

  const isFavorite = (foodItemId) => {
    return favorites.some(fav => fav.food_item_id === foodItemId);
  };

  const getFavoriteCount = () => {
    return favorites.length;
  };

  // Alias for compatibility with existing code
  const getFavoritesCount = () => {
    return favorites.length;
  };

  const value = {
    favorites,
    loading,
    error,
    toggleFavorite,
    removeFromFavorites,
    isFavorite,
    getFavoriteCount,
    getFavoritesCount, // Add alias for compatibility
    loadFavorites,
  };

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}; 