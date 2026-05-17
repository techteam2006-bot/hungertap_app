import { CommonActions } from '@react-navigation/native';

/** Clear checkout stack screens and land on the cart tab (no duplicate stack Cart screen). */
export function resetNavigationToCart(navigation) {
  navigation.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [
        {
          name: 'MainTabs',
          state: {
            routes: [{ name: 'CartTab' }],
            index: 0,
          },
        },
      ],
    })
  );
}

/** Clear checkout stack screens and land on the home tab. */
export function resetNavigationToHome(navigation) {
  navigation.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [
        {
          name: 'MainTabs',
          state: {
            routes: [{ name: 'HomeTab' }],
            index: 0,
          },
        },
      ],
    })
  );
}

/**
 * Cart header back: stack Cart (e.g. leftover from old flows) → cart tab reset;
 * main-tab cart → switch to HomeTab.
 */
export function navigateBackFromCart(navigation) {
  if (navigation.canGoBack()) {
    resetNavigationToCart(navigation);
    return;
  }
  navigation.navigate('HomeTab');
}
