/**
 * Test file for time-based sorting functionality
 * This file demonstrates how the sorting works with sample data
 */

import { 
  getCurrentTimePeriod, 
  getPriorityCategoryForTime, 
  sortItemsByTime, 
  getTimeSortingInfo,
  getItemTimePriority 
} from './timeBasedSorting';

// Sample food items for testing
const sampleItems = [
  {
    id: 1,
    name: 'Masala Dosa',
    category: 'tiffin',
    price: 80,
    description: 'Crispy dosa with potato filling'
  },
  {
    id: 2,
    name: 'Chicken Biryani',
    category: 'meals',
    price: 150,
    description: 'Aromatic rice with tender chicken'
  },
  {
    id: 3,
    name: 'Samosa',
    category: 'snacks',
    price: 20,
    description: 'Crispy pastry with potato filling'
  },
  {
    id: 4,
    name: 'Butter Chicken',
    category: 'dinner',
    price: 200,
    description: 'Creamy tomato-based curry'
  },
  {
    id: 5,
    name: 'Idli Sambar',
    category: 'breakfast',
    price: 60,
    description: 'Steamed rice cakes with lentil soup'
  },
  {
    id: 6,
    name: 'Veg Thali',
    category: 'lunch',
    price: 120,
    description: 'Complete meal with rice, dal, and vegetables'
  },
  {
    id: 7,
    name: 'Tea',
    category: 'beverages',
    price: 15,
    description: 'Hot masala tea'
  },
  {
    id: 8,
    name: 'Pizza',
    category: 'snacks',
    price: 180,
    description: 'Italian pizza with cheese and toppings'
  }
];

/**
 * Test function to demonstrate time-based sorting
 */
export const testTimeBasedSorting = () => {
  console.log('🧪 Testing Time-Based Sorting...\n');
  
  // Test 1: Get current time info
  const timeInfo = getTimeSortingInfo();
  console.log('📅 Current Time Info:', timeInfo);
  
  // Test 2: Test priority categories for different times
  console.log('\n⏰ Priority Categories by Time:');
  ['morning', 'afternoon', 'evening', 'night'].forEach(timePeriod => {
    const priority = getPriorityCategoryForTime(timePeriod);
    console.log(`  ${timePeriod}: ${priority}`);
  });
  
  // Test 3: Test item priorities
  console.log('\n🏷️ Item Priorities for Current Time:');
  sampleItems.forEach(item => {
    const priority = getItemTimePriority(item, timeInfo.timePeriod);
    const isRecommended = priority === 0;
    console.log(`  ${item.name} (${item.category}): Priority ${priority} ${isRecommended ? '⭐' : ''}`);
  });
  
  // Test 4: Test sorting
  console.log('\n🔄 Sorting Results:');
  const sortedItems = sortItemsByTime(sampleItems);
  console.log('Original order:', sampleItems.map(item => `${item.name} (${item.category})`));
  console.log('Sorted order:', sortedItems.map(item => `${item.name} (${item.category})`));
  
  // Test 5: Group by priority
  console.log('\n📊 Items Grouped by Priority:');
  const priorityGroups = {
    0: sortedItems.filter(item => getItemTimePriority(item, timeInfo.timePeriod) === 0),
    1: sortedItems.filter(item => getItemTimePriority(item, timeInfo.timePeriod) === 1),
    2: sortedItems.filter(item => getItemTimePriority(item, timeInfo.timePeriod) === 2)
  };
  
  Object.entries(priorityGroups).forEach(([priority, items]) => {
    console.log(`  Priority ${priority} (${priority === '0' ? 'Highest' : priority === '1' ? 'Medium' : 'Lowest'}):`);
    items.forEach(item => console.log(`    - ${item.name} (${item.category})`));
  });
  
  return {
    timeInfo,
    sortedItems,
    priorityGroups
  };
};

/**
 * Simulate different times for testing
 */
export const testDifferentTimes = () => {
  console.log('\n🕐 Testing Different Times...\n');
  
  const testTimes = [
    { hour: 8, period: 'morning' },
    { hour: 12, period: 'afternoon' },
    { hour: 16, period: 'evening' },
    { hour: 20, period: 'night' }
  ];
  
  testTimes.forEach(({ hour, period }) => {
    // Mock the Date object to simulate different times
    const originalDate = global.Date;
    global.Date = class extends Date {
      constructor() {
        super();
        this.setHours(hour, 0, 0, 0);
      }
    };
    
    const sortedItems = sortItemsByTime(sampleItems);
    const priorityCategory = getPriorityCategoryForTime(period);
    
    console.log(`🕐 ${hour}:00 (${period}) - Priority: ${priorityCategory}`);
    console.log(`   First 3 items: ${sortedItems.slice(0, 3).map(item => `${item.name} (${item.category})`).join(', ')}`);
    
    // Restore original Date
    global.Date = originalDate;
  });
};

// Export sample items for use in other tests
export { sampleItems };

// Run tests if this file is executed directly
if (typeof window !== 'undefined') {
  // Browser environment
  window.testTimeBasedSorting = testTimeBasedSorting;
  window.testDifferentTimes = testDifferentTimes;
} else {
  // Node.js environment
  module.exports = {
    testTimeBasedSorting,
    testDifferentTimes,
    sampleItems
  };
}


