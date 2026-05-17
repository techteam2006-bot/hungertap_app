/**
 * Test file for recommendations utility
 * Run this to verify the recommendations logic
 */

import { getRecommendations, getRecommendationReason, shouldShowRecommendations } from './recommendations';

// Sample food items for testing
const sampleFoodItems = [
  { id: '1', name: 'Masala Chai', price: 15, description: 'Spiced Indian tea', category: 'tea', isAvailable: true },
  { id: '2', name: 'Filter Coffee', price: 20, description: 'South Indian filter coffee', category: 'coffee', isAvailable: true },
  { id: '3', name: 'Sweet Lassi', price: 25, description: 'Sweet yogurt drink', category: 'curd', isAvailable: true },
  { id: '4', name: 'Coca Cola', price: 30, description: 'Refreshing soft drink', category: 'soft drink', isAvailable: true },
  { id: '5', name: 'Orange Juice', price: 35, description: 'Fresh orange juice', category: 'juice', isAvailable: true },
  { id: '6', name: 'Gulab Jamun', price: 40, description: 'Sweet dessert balls', category: 'dessert', isAvailable: true },
  { id: '7', name: 'Mineral Water', price: 20, description: 'Pure mineral water', category: 'water', isAvailable: true },
  { id: '8', name: 'Milk Shake', price: 45, description: 'Chocolate milk shake', category: 'milk', isAvailable: true },
];

// Test scenarios
const testScenarios = [
  {
    name: 'Tiffin items in cart',
    cartItems: [
      { id: 'tiffin1', name: 'Masala Dosa', category: 'tiffin', quantity: 1 }
    ],
    expectedCategories: ['tea', 'coffee', 'milk']
  },
  {
    name: 'Meals items in cart',
    cartItems: [
      { id: 'meal1', name: 'Butter Chicken', category: 'meals', quantity: 1 }
    ],
    expectedCategories: ['curd', 'soft drink', 'water', 'juice']
  },
  {
    name: 'Snacks items in cart',
    cartItems: [
      { id: 'snack1', name: 'Samosa', category: 'snacks', quantity: 1 }
    ],
    expectedCategories: ['juice', 'tea', 'coffee', 'soft drink']
  },
  {
    name: 'Dinner items in cart',
    cartItems: [
      { id: 'dinner1', name: 'Biryani', category: 'dinner', quantity: 1 }
    ],
    expectedCategories: ['dessert', 'drink', 'tea', 'coffee']
  },
  {
    name: 'Multiple categories in cart',
    cartItems: [
      { id: 'tiffin1', name: 'Masala Dosa', category: 'tiffin', quantity: 1 },
      { id: 'meal1', name: 'Butter Chicken', category: 'meals', quantity: 1 }
    ],
    expectedCategories: ['tea', 'coffee', 'milk', 'curd', 'soft drink', 'water', 'juice']
  }
];

// Run tests
export const runRecommendationTests = () => {
  console.log('🧪 Running recommendation tests...\n');

  testScenarios.forEach((scenario, index) => {
    console.log(`Test ${index + 1}: ${scenario.name}`);
    
    const recommendations = getRecommendations(scenario.cartItems, sampleFoodItems);
    const shouldShow = shouldShowRecommendations(scenario.cartItems);
    
    console.log(`  Should show recommendations: ${shouldShow}`);
    console.log(`  Recommendations found: ${recommendations.length}`);
    
    if (recommendations.length > 0) {
      console.log('  Recommended items:');
      recommendations.forEach((item, i) => {
        const reason = getRecommendationReason(scenario.cartItems, item);
        console.log(`    ${i + 1}. ${item.name} (${item.category}) - ${reason}`);
      });
    }
    
    console.log('');
  });

  // Test edge cases
  console.log('Edge Cases:');
  console.log('Empty cart:', shouldShowRecommendations([]));
  console.log('Null cart:', shouldShowRecommendations(null));
  console.log('Empty food items:', getRecommendations([{ id: '1', category: 'tiffin' }], []).length);
  console.log('Null food items:', getRecommendations([{ id: '1', category: 'tiffin' }], null).length);
};

// Export for manual testing
export { sampleFoodItems, testScenarios };

