/**
 * Cart recommendations utility
 * Suggests items based on what's already in the cart
 */

import { deriveItemIsAvailable } from '../itemAvailability';

/**
 * Get recommendations based on items in cart
 * @param {Array} cartItems - Array of items currently in cart
 * @param {Array} allItems - Array of all available items
 * @returns {Array} Array of recommended items
 */
export const getRecommendations = (cartItems, allItems) => {
  if (!cartItems || cartItems.length === 0 || !allItems || allItems.length === 0) {
    return [];
  }

  // Extract unique categories from cart items
  const cartCategories = [...new Set(
    cartItems.map(item => item.category?.toLowerCase() || '')
  )];

  // Define recommendation rules
  const recommendationRules = {
    'tiffin': ['tea', 'coffee', 'milk'],
    'meals': ['curd', 'soft drink', 'water', 'juice'],
    'snacks': ['juice', 'tea', 'coffee', 'soft drink'],
    'dinner': ['dessert', 'drink', 'tea', 'coffee'],
    'breakfast': ['tea', 'coffee', 'milk', 'juice'],
    'lunch': ['curd', 'soft drink', 'water', 'juice'],
    'beverages': ['snacks', 'dessert'],
    'combos': ['soft drink', 'juice', 'water']
  };

  // Find recommended categories based on cart items
  const recommendedCategories = new Set();
  
  cartCategories.forEach(category => {
    const recommendations = recommendationRules[category] || [];
    recommendations.forEach(rec => recommendedCategories.add(rec));
  });

  // Get items that match recommended categories and are not already in cart
  const cartItemIds = new Set(cartItems.map(item => item.id));
  
  const recommendations = allItems.filter(item => {
    const itemCategory = item.category?.toLowerCase() || '';
    const isRecommended = Array.from(recommendedCategories).some(recCategory => 
      itemCategory.includes(recCategory)
    );
    const notInCart = !cartItemIds.has(item.id);
    const isAvailable = deriveItemIsAvailable(item);
    
    return isRecommended && notInCart && isAvailable;
  });

  // Limit to 4 recommendations and sort by relevance
  return recommendations
    .sort((a, b) => {
      // Sort by category match strength
      const aStrength = getCategoryMatchStrength(a, recommendedCategories);
      const bStrength = getCategoryMatchStrength(b, recommendedCategories);
      return bStrength - aStrength;
    })
    .slice(0, 4);
};

/**
 * Get category match strength for sorting
 * @param {Object} item - Item to check
 * @param {Set} recommendedCategories - Set of recommended categories
 * @returns {number} Match strength (higher = better match)
 */
const getCategoryMatchStrength = (item, recommendedCategories) => {
  const itemCategory = item.category?.toLowerCase() || '';
  let strength = 0;
  
  recommendedCategories.forEach(recCategory => {
    if (itemCategory.includes(recCategory)) {
      strength += 1;
    }
  });
  
  return strength;
};

/**
 * Get recommendation reason for display
 * @param {Array} cartItems - Items in cart
 * @param {Object} recommendedItem - The recommended item
 * @returns {string} Reason for recommendation
 */
export const getRecommendationReason = (cartItems, recommendedItem) => {
  if (!cartItems || cartItems.length === 0) return '';

  const cartCategories = cartItems.map(item => item.category?.toLowerCase() || '');
  const itemCategory = recommendedItem.category?.toLowerCase() || '';

  const reasons = {
    'tea': 'Perfect with your meal',
    'coffee': 'Great accompaniment',
    'milk': 'Healthy addition',
    'curd': 'Completes your meal',
    'soft drink': 'Refreshing choice',
    'water': 'Stay hydrated',
    'juice': 'Fresh and healthy',
    'dessert': 'Sweet ending',
    'drink': 'Perfect beverage'
  };

  // Find the best matching reason
  for (const [key, reason] of Object.entries(reasons)) {
    if (itemCategory.includes(key)) {
      return reason;
    }
  }

  return 'Goes well with your order';
};

/**
 * Check if recommendations should be shown
 * @param {Array} cartItems - Items in cart
 * @returns {boolean} Whether to show recommendations
 */
export const shouldShowRecommendations = (cartItems) => {
  return cartItems && cartItems.length > 0;
};

