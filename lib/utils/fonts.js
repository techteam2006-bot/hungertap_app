import * as Font from 'expo-font';

// ✅ Load fonts
export async function loadFonts() {
  await Font.loadAsync({
    Afacad: require('../../assets/fonts/Afacad-Regular.ttf'),
    'Afacad-Medium': require('../../assets/fonts/Afacad-Medium.ttf'),
    'Afacad-SemiBold': require('../../assets/fonts/Afacad-SemiBold.ttf'),
    'Afacad-Bold': require('../../assets/fonts/Afacad-Bold.ttf'),
  });
}

// ✅ MUST be a named export
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