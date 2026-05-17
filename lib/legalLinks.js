import { Alert, Linking } from 'react-native';

export const LEGAL_LINKS = {
  termsOfService: 'https://termsofservice.hungertap.online',
  refundPolicy: 'https://refundpolicy.hungertap.online',
  privacyPolicy: 'https://privacypolicy.hungertap.online',
};

export async function openLegalUrl(url) {
  try {
    await Linking.openURL(url);
  } catch (e) {
    Alert.alert('Cannot open link', e?.message || 'Please try again.');
  }
}
