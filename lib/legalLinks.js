export const LEGAL_LINKS = {
  termsOfService: 'https://termsofservice.hungertap.online',
  refundPolicy: 'https://refundpolicy.hungertap.online',
  privacyPolicy: 'https://privacypolicy.hungertap.online',
};

export const LEGAL_PAGES = {
  termsOfService: {
    title: 'Terms of Service',
    url: LEGAL_LINKS.termsOfService,
  },
  refundPolicy: {
    title: 'Refund Policy',
    url: LEGAL_LINKS.refundPolicy,
  },
  privacyPolicy: {
    title: 'Privacy Policy',
    url: LEGAL_LINKS.privacyPolicy,
  },
};

/** Navigate to in-app WebView for a legal document. */
export function openLegalPage(navigation, pageKey) {
  const page = LEGAL_PAGES[pageKey];
  if (!navigation || !page) return;
  navigation.navigate('LegalWebView', {
    title: page.title,
    url: page.url,
  });
}
