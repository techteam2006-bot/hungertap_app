import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

  const loadFavorites = useCallback(async () => {
    if (!user?.id) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await favoritesService.getFavorites(user.id);
      if (loadError) {
        setError(loadError);
        setFavorites([]);
        return;
      }
      setFavorites(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || String(e));
      setFavorites([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      loadFavorites();
    } else {
      setFavorites([]);
      setError(null);
      setLoading(false);
    }
  }, [user?.id, loadFavorites]);

  const toggleFavorite = async (foodItemId, itemSnapshot = null) => {
    if (!user?.id || foodItemId == null) return;
    setError(null);
    try {
      const { error: toggleError } = await favoritesService.toggleFavorite(
        user.id,
        foodItemId,
        itemSnapshot
      );
      if (toggleError) {
        setError(toggleError);
        return;
      }
      await loadFavorites();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const removeFromFavorites = async (foodItemId) => {
    if (!user?.id || foodItemId == null) return;
    setError(null);
    const id = String(foodItemId);
    setFavorites((prev) => prev.filter((fav) => String(fav.food_item_id ?? fav.id) !== id));
    try {
      const { error: removeError } = await favoritesService.removeFromFavorites(user.id, id);
      if (removeError) {
        setError(removeError);
        await loadFavorites();
      }
    } catch (e) {
      setError(e?.message || String(e));
      await loadFavorites();
    }
  };

  const isFavorite = (foodItemId) => {
    if (foodItemId == null) return false;
    const id = String(foodItemId);
    return favorites.some((fav) => String(fav.food_item_id ?? fav.id) === id);
  };

  const getFavoriteCount = () => favorites.length;
  const getFavoritesCount = () => favorites.length;

  const value = {
    favorites,
    loading,
    error,
    toggleFavorite,
    removeFromFavorites,
    isFavorite,
    getFavoriteCount,
    getFavoritesCount,
    loadFavorites,
  };

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
};
