import * as Font from 'expo-font';

/**
 * Loads the Afacad typeface.
 *
 * VARIABLE FONT (recommended — one file, ~30 % smaller than four separate files):
 *   1. Download https://fonts.google.com/specimen/Afacad  →  download family
 *   2. Extract  Afacad[wght].ttf  and place it at  assets/fonts/Afacad[wght].ttf
 *   3. Uncomment the VARIABLE block below and comment out the SEPARATE block.
 *
 * SEPARATE FILES (current default — works with the four TTFs already in assets/):
 *   Keep the SEPARATE block uncommented.
 */
export async function loadFonts() {
  // ── VARIABLE FONT (single file) ───────────────────────────────────────────
  // Uncomment when assets/fonts/Afacad[wght].ttf is present:
  //
  // await Font.loadAsync({
  //   Afacad:          require('../../assets/fonts/Afacad[wght].ttf'),
  //   'Afacad-Medium': require('../../assets/fonts/Afacad[wght].ttf'),
  //   'Afacad-SemiBold': require('../../assets/fonts/Afacad[wght].ttf'),
  //   'Afacad-Bold':   require('../../assets/fonts/Afacad[wght].ttf'),
  // });

  // ── SEPARATE FILES (current) ──────────────────────────────────────────────
  await Font.loadAsync({
    Afacad: require('../../assets/fonts/Afacad-Regular.ttf'),
    'Afacad-Medium': require('../../assets/fonts/Afacad-Medium.ttf'),
    'Afacad-SemiBold': require('../../assets/fonts/Afacad-SemiBold.ttf'),
    'Afacad-Bold': require('../../assets/fonts/Afacad-Bold.ttf'),
  });
}

export const getFontStyle = (weight = 'regular') => {
  switch (weight) {
    case 'medium':
      return { fontFamily: 'Afacad-Medium' };
    case 'semiBold':
      return { fontFamily: 'Afacad-SemiBold' };
    case 'bold':
      return { fontFamily: 'Afacad-Bold' };
    default:
      return { fontFamily: 'Afacad' };
  }
};