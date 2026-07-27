import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { CONFIG } from '../config';
import { cartService, normalizeFoodItemNutrition } from './supabase';
import { useAuth } from './AuthContext';
import { cartTimeoutService } from './CartTimeoutService';
import { loadLocalCart, saveLocalCart, clearLocalCartStorage } from './localCartStorage';
import {
  validateAddToCart,
  validateIncreaseQuantity,
  clampQuantityForCartLine,
} from './cartRules';

const CartContext = createContext();

/** When false, cart is stored only on device (no `cart_items` table). */
const REMOTE_CART = CONFIG.CART_STORAGE === 'remote';

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const { user } = useAuth();
  const cartHydratedRef = useRef(false);
  /** Bumps on clear so in-flight local saves cannot resurrect cleared items. */
  const persistGenRef = useRef(0);
  const cartItemsRef = useRef(cartItems);
  cartItemsRef.current = cartItems;

  // Load cart items from Supabase when user changes
  useEffect(() => {
    if (user) {
      cartHydratedRef.current = false;
      loadCartItems();
      if (REMOTE_CART) {
        initializeCartTimeoutMonitoring();
      }
    } else {
      setCartItems([]);
      setLoading(false);
      cartHydratedRef.current = false;
      cartTimeoutService.stopCartMonitoring();
    }
  }, [user]);

  // Persist cart on device when backend has no cart table
  useEffect(() => {
    if (REMOTE_CART || !user || !cartHydratedRef.current) return;
    const gen = persistGenRef.current;
    const snapshot = cartItems;
    (async () => {
      await saveLocalCart(user.id, snapshot);
      // If clear/replace ran during the write, re-persist the latest cart.
      if (persistGenRef.current !== gen) {
        await saveLocalCart(user.id, cartItemsRef.current);
      }
    })().catch(() => {});
  }, [cartItems, user]);

  // Initialize cart timeout monitoring
  const initializeCartTimeoutMonitoring = async () => {
    if (!user || !REMOTE_CART) return;

    try {
      await cartTimeoutService.initialize();
      await cartTimeoutService.startCartMonitoring(user.id);
    } catch (error) {
      console.error('Error initializing cart timeout monitoring:', error);
    }
  };

  const loadCartItems = async () => {
    if (!user) {
      setCartItems([]);
      setLoading(false);
      return;
    }

    if (!REMOTE_CART) {
      try {
        setLoading(true);
        const stored = await loadLocalCart(user.id);
        setCartItems(Array.isArray(stored) ? stored : []);
      } catch (error) {
        console.error('Error loading local cart:', error);
        setCartItems([]);
      } finally {
        cartHydratedRef.current = true;
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await cartService.getCartItems(user.id);
      // ✅ error handled — empty cart on failure (no throw)
      if (error) {
        console.error('cartService.getCartItems:', error?.message || error);
        setCartItems([]);
        return;
      }
      const safeRows = Array.isArray(data) ? data : [];

      // Transform data to match our app's format
      const transformedItems = safeRows
        .filter(item => item?.food_items?.id)
        .map(item => {
          const normalizedFoodItem = normalizeFoodItemNutrition(item.food_items);
          return {
            id: normalizedFoodItem.id, // Food item ID for frontend use
            cartItemId: item.id, // Cart item ID for backend operations
            name: normalizedFoodItem.name || 'Unknown Item',
            price: normalizedFoodItem.price || 0,
            quantity: item.quantity || 1,
            image_url: normalizedFoodItem.image_url || null,
            category: normalizedFoodItem.categories?.name || normalizedFoodItem.category || 'Other', // Add category for recommendations
            description: normalizedFoodItem.description || '',
            isAvailable: normalizedFoodItem.isAvailable,
            available_stock: normalizedFoodItem.available_stock ?? null,
            calories: normalizedFoodItem.calories ?? null,
            protein: normalizedFoodItem.protein ?? null,
            carbs: normalizedFoodItem.carbs ?? null,
            fat: normalizedFoodItem.fat ?? null,
          };
        });
      
      // console.log('Loaded cart items:', transformedItems.length); // Debug log (disabled for performance)
      // console.log('Raw cart data from DB:', data?.length); // Debug log for troubleshooting
      setCartItems(transformedItems);
    } catch (error) {
      console.error('Error loading cart:', error);
      setCartItems([]); // Reset cart on error
    } finally {
      cartHydratedRef.current = true;
      setLoading(false);
    }
  };

  const replaceCartItems = (lines) => {
    const next = Array.isArray(lines) ? lines : [];
    setCartItems(next);
    if (user && !REMOTE_CART) {
      saveLocalCart(user.id, next).catch(() => {});
    }
  };

  const addToCart = async (item) => {
    // Update UI immediately for better responsiveness
    setCartItems((prevCartItems) => {
      const addQty = item.quantity || 1;
      const check = validateAddToCart(prevCartItems, item, addQty);
      if (!check.ok) {
        setTimeout(() => Alert.alert('Cannot add to cart', check.error), 0);
        return prevCartItems;
      }
      const qtyToAdd = check.addQty;

      const existing = prevCartItems.find((i) => i.id === item.id);
      
      if (existing) {
        // Item already in cart, increase quantity
        const newQuantity = existing.quantity + qtyToAdd;
        
        // Sync with backend in background (don't wait)
        if (REMOTE_CART && user && existing.cartItemId) {
          cartService.updateCartItemQuantity(user.id, existing.cartItemId, newQuantity)
            .catch(error => {
              console.error('Error syncing update to backend:', error);
            });
        } else if (REMOTE_CART && user) {
          // Item in local cart but not synced yet, add to backend
          cartService.addToCart(user.id, item.id, qtyToAdd)
            .then(() => {
              cartTimeoutService.startCartMonitoring(user.id);
            })
            .catch(error => {
              console.error('Error syncing add to backend:', error);
            });
        }
        
        return prevCartItems.map((i) =>
          i.id === item.id ? { ...i, quantity: newQuantity } : i
        );
      }
      
      // New item, add to cart
      if (REMOTE_CART && user) {
        cartService.addToCart(user.id, item.id, qtyToAdd)
          .then(() => {
            cartTimeoutService.startCartMonitoring(user.id);
          })
          .catch(error => {
            console.error('Error syncing new item to backend:', error);
          });
      }
      
      const normalizedItem = normalizeFoodItemNutrition(item);

      return [
        ...prevCartItems,
        {
          id: normalizedItem.id ?? item.id,
          name: normalizedItem.name ?? item.name,
          price: (normalizedItem.price ?? item.price) || 0,
          quantity: qtyToAdd,
          image: normalizedItem.image_url || normalizedItem.image || item.image_url || item.image || null,
          localImage: normalizedItem.localImage || item.localImage || null,
          image_url: normalizedItem.image_url || item.image_url || null,
          category: normalizedItem.category || item.category || 'Other',
          description: normalizedItem.description || item.description || '',
          isAvailable: normalizedItem.isAvailable,
          available_stock: normalizedItem.available_stock ?? item.available_stock ?? null,
          calories: normalizedItem.calories ?? item.calories ?? null,
          protein: normalizedItem.protein ?? item.protein ?? null,
          carbs: normalizedItem.carbs ?? item.carbs ?? null,
          fat: normalizedItem.fat ?? item.fat ?? null,
        },
      ];
    });
    
    showToast('Added to cart!');
  };

  const removeFromCart = async (itemId) => {
    const row = cartItems.find((item) => item.id === itemId);
    const cartItemId = row?.cartItemId;

    // Optimistic update - remove from UI immediately
    setCartItems((prev) => prev.filter(item => item.id !== itemId));
    showToast('Item removed from cart');

    // If user not logged in, we're done
    if (!user) {
      return;
    }
    
    if (!REMOTE_CART) return;

    try {
      if (!cartItemId) {
        return;
      }
      const { error } = await cartService.removeFromCart(user.id, cartItemId);
      if (error) throw error;
    } catch (error) {
      console.error('Error syncing removal to backend:', error);
      loadCartItems();
    }
  };

  const updateQuantity = async (itemId, quantity) => {
    console.log('🛒 updateQuantity called:', { itemId, quantity });

    let qty = quantity;
    if (qty > 0) {
      const line = cartItems.find((i) => i.id === itemId);
      if (line) {
        const clamped = clampQuantityForCartLine(line, qty);
        if (clamped !== qty) {
          Alert.alert(
            'Cart',
            `You can order at most ${clamped} of ${line.name || 'this item'} (stock or limit).`
          );
          qty = clamped;
        }
      }
    }
    
    let cartItemId = null;
    
    // Optimistic update - update UI immediately
    if (qty <= 0) {
      // Remove item immediately
      console.log('🗑️ Removing item from cart:', itemId);
      setCartItems((prev) => {
        const cartItem = prev.find(item => item.id === itemId);
        if (cartItem) cartItemId = cartItem.cartItemId;
        
        const newItems = prev.filter(item => item.id !== itemId);
        console.log('📦 Cart items after removal:', newItems.length);
        return newItems;
      });
      showToast('Item removed from cart');
    } else {
      // Update quantity immediately
      console.log('📝 Updating quantity for item:', itemId, 'to:', qty);
      setCartItems((prev) => {
        const cartItem = prev.find(item => item.id === itemId);
        if (cartItem) cartItemId = cartItem.cartItemId;
        
        return prev.map(item => 
          item.id === itemId ? { ...item, quantity: qty } : item
        );
      });
      showToast('Cart quantity updated');
    }

    // If user not logged in, we're done
    if (!user) {
      console.log('👤 No user logged in, skipping backend sync');
      return;
    }
    
    if (!REMOTE_CART) return;

    try {
      if (qty <= 0) {
        if (cartItemId) {
          console.log('🔄 Syncing removal to backend for cart item:', cartItemId);
          const { error } = await cartService.removeFromCart(user.id, cartItemId);
          if (error) throw error;
          console.log('✅ Backend removal successful');
        } else {
          console.log('❌ Cart item not found or missing cartItemId for removal');
        }
      } else {
        if (cartItemId) {
          console.log('🔄 Syncing quantity update to backend for cart item:', cartItemId, 'quantity:', qty);
          const { error } = await cartService.updateCartItemQuantity(user.id, cartItemId, qty);
          if (error) throw error;
          console.log('✅ Backend quantity update successful');
        } else {
          console.log('❌ Cart item not found or missing cartItemId for quantity update');
        }
      }
    } catch (error) {
      console.error('❌ Error syncing quantity update to backend:', error);
      loadCartItems();
    }
  };

  const increaseQuantity = (itemId) => {
    setCartItems((prevCartItems) => {
      const check = validateIncreaseQuantity(prevCartItems, itemId);
      if (!check.ok) {
        setTimeout(() => Alert.alert('Cart', check.error), 0);
        return prevCartItems;
      }
      const item = prevCartItems.find((row) => row.id === itemId);
      if (!item) return prevCartItems;
      
      const newQuantity = item.quantity + 1;
      
      if (REMOTE_CART && user && item.cartItemId) {
        cartService.updateCartItemQuantity(user.id, item.cartItemId, newQuantity)
          .catch(error => {
            console.error('Error syncing increase to backend:', error);
            loadCartItems();
          });
      }
      
      // Return updated cart items
      return prevCartItems.map(item =>
        item.id === itemId ? { ...item, quantity: newQuantity } : item
      );
    });
  };

  const decreaseQuantity = (itemId) => {
    console.log('➖ decreaseQuantity called for item:', itemId);
    const item = cartItems.find(item => item.id === itemId);
    console.log('🔍 Found item:', item);
    if (item) {
      const newQuantity = item.quantity - 1;
      console.log('📊 Current quantity:', item.quantity, 'New quantity:', newQuantity);
      updateQuantity(itemId, newQuantity);
    } else {
      console.log('❌ Item not found in cart:', itemId);
    }
  };

  const getItemQuantity = (itemId) => {
    const item = cartItems.find(item => item.id === itemId);
    return item ? item.quantity : 0;
  };

  /**
   * @param {{ silent?: boolean }} [opts] — `silent` skips toast (e.g. after paid order).
   */
  const clearCart = async (opts = {}) => {
    persistGenRef.current += 1;
    setCartItems([]);
    cartItemsRef.current = [];
    if (!opts?.silent) {
      showToast('Cart cleared');
    }

    if (!user) {
      return;
    }

    try {
      if (!REMOTE_CART) {
        await clearLocalCartStorage(user.id);
        return;
      }
      const { error } = await cartService.clearCart(user.id);
      if (error) throw error;
      cartTimeoutService.stopCartMonitoring(user.id);
    } catch (error) {
      console.error('Error syncing cart clear to backend:', error);
      loadCartItems();
    }
  };

  const getTotalPrice = () => {
    return cartItems.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const getTotalItems = () => {
    return cartItems.reduce((total, item) => total + item.quantity, 0);
  };

  const showToast = (_message) => {
    // Toasts disabled per UI request
  };

  const hideToast = () => {
    setToastVisible(false);
  };

  // Cleanup cart timeout monitoring on unmount
  useEffect(() => {
    return () => {
      if (user) {
        cartTimeoutService.stopCartMonitoring(user.id);
      }
    };
  }, [user]);

  return (
    <CartContext.Provider
      value={{
        cartItems,
        addToCart,
        removeFromCart,
        updateQuantity,
        increaseQuantity,
        decreaseQuantity,
        getItemQuantity,
        clearCart,
        replaceCartItems,
        getTotalPrice,
        getTotalItems,
        loading,
        toastVisible,
        toastMessage,
        hideToast,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}; 