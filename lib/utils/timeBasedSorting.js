/**
 * Time-based sorting utility for food items
 * Sorts items based on current system time and meal categories
 */

/**
 * Get the current time period based on system time
 * @returns {string} The current time period: 'morning', 'afternoon', 'evening', 'night'
 */
export const getCurrentTimePeriod = () => {
  const currentHour = new Date().getHours();
  
  if (currentHour >= 6 && currentHour < 11) {
    return 'morning';
  } else if (currentHour >= 11 && currentHour < 15) {
    return 'afternoon';
  } else if (currentHour >= 15 && currentHour < 19) {
    return 'evening';
  } else if (currentHour >= 19 && currentHour < 23) {
    return 'night';
  } else {
    // Late night (11 PM - 6 AM) - default to morning items
    return 'morning';
  }
};

/**
 * Get priority category for the current time period
 * @param {string} timePeriod - The time period ('morning', 'afternoon', 'evening', 'night')
 * @returns {string} The priority category for that time period
 */
export const getPriorityCategoryForTime = (timePeriod) => {
  const categoryMap = {
    'morning': 'tiffin',
    'afternoon': 'meals',
    'evening': 'snacks',
    'night': 'dinner'
  };
  
  return categoryMap[timePeriod] || 'tiffin';
};

/**
 * Get sorting priority for an item based on current time
 * @param {Object} item - The food item object
 * @param {string} currentTimePeriod - The current time period
 * @returns {number} Priority score (lower = higher priority)
 * Priority levels: 0 = highest (time-relevant), 1 = medium (related), 2 = low (other), 3 = beverages (bottom)
 */
export const getItemTimePriority = (item, currentTimePeriod) => {
  const priorityCategory = getPriorityCategoryForTime(currentTimePeriod);
  const itemCategory = item.category?.toLowerCase() || '';
  const itemName = item.name?.toLowerCase() || '';
  const itemDescription = item.description?.toLowerCase() || '';
  
  // Check if item is a beverage (lowest priority - should appear at bottom)
  const isBeverage = itemCategory.includes('beverage') || 
                    itemName.includes('beverage') ||
                    itemDescription.includes('beverage') ||
                    itemName.includes('drink') ||
                    itemDescription.includes('drink') ||
                    itemName.includes('juice') ||
                    itemDescription.includes('juice') ||
                    itemName.includes('coffee') ||
                    itemDescription.includes('coffee') ||
                    itemName.includes('tea') ||
                    itemDescription.includes('tea') ||
                    itemName.includes('soda') ||
                    itemDescription.includes('soda') ||
                    itemName.includes('cola') ||
                    itemDescription.includes('cola') ||
                    itemName.includes('water') ||
                    itemDescription.includes('water');
  
  if (isBeverage) {
    return 3; // Lowest priority - beverages at bottom
  }
  
  // Check if item category matches priority category
  if (itemCategory.includes(priorityCategory)) {
    return 0; // Highest priority
  }
  
  // Check for related categories that might be relevant
  const relatedCategories = {
    'morning': ['breakfast', 'tiffin', 'morning'],
    'afternoon': ['lunch', 'meals', 'afternoon', 'main course'],
    'evening': ['snacks', 'evening', 'tea time'],
    'night': ['dinner', 'night', 'supper']
  };
  
  const related = relatedCategories[currentTimePeriod] || [];
  const isRelated = related.some(cat => itemCategory.includes(cat));
  
  if (isRelated) {
    return 1; // Medium priority
  }
  
  return 2; // Lower priority (but above beverages)
};

/**
 * Sort food items based on current system time
 * @param {Array} items - Array of food items to sort
 * @returns {Array} Sorted array of food items
 */
export const sortItemsByTime = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }
  
  const currentTimePeriod = getCurrentTimePeriod();
  
  return [...items].sort((a, b) => {
    // First, put available items before unavailable items
    if (a.isAvailable !== b.isAvailable) {
      return a.isAvailable ? -1 : 1; // available first
    }
    
    // Then sort by time priority
    const priorityA = getItemTimePriority(a, currentTimePeriod);
    const priorityB = getItemTimePriority(b, currentTimePeriod);
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // If same priority, maintain original order (stable sort)
    return 0;
  });
};

/**
 * Get a human-readable description of the current time period
 * @returns {string} Description of current time period
 */
export const getTimePeriodDescription = () => {
  const timePeriod = getCurrentTimePeriod();
  const descriptions = {
    'morning': 'Morning (6 AM - 11 AM) - Tiffin items prioritized, beverages at bottom',
    'afternoon': 'Afternoon (11 AM - 3 PM) - Meals prioritized, beverages at bottom',
    'evening': 'Evening (3 PM - 7 PM) - Snacks prioritized, beverages at bottom',
    'night': 'Night (7 PM - 11 PM) - Dinner items prioritized, beverages at bottom'
  };
  
  return descriptions[timePeriod] || 'Late Night - Tiffin items prioritized, beverages at bottom';
};

/**
 * Check if an item is recommended for the current time
 * @param {Object} item - The food item object
 * @returns {boolean} True if item is recommended for current time
 */
export const isItemRecommendedForCurrentTime = (item) => {
  const currentTimePeriod = getCurrentTimePeriod();
  const priority = getItemTimePriority(item, currentTimePeriod);
  return priority === 0; // Only items with highest priority (0) are recommended
};

/**
 * Get time-based sorting info for debugging/logging
 * @returns {Object} Object containing current time info
 */
export const getTimeSortingInfo = () => {
  const currentTime = new Date();
  const timePeriod = getCurrentTimePeriod();
  const priorityCategory = getPriorityCategoryForTime(timePeriod);
  
  return {
    currentTime: currentTime.toLocaleTimeString(),
    currentHour: currentTime.getHours(),
    timePeriod,
    priorityCategory,
    description: getTimePeriodDescription()
  };
};
