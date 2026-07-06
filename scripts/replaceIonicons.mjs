/**
 * Replaces all `@expo/vector-icons/Ionicons` imports and <Ionicons> usages
 * with `AppIcon` across the codebase.
 * Run: node scripts/replaceIonicons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Files that import Ionicons (from grep results)
const FILES = [
  'App.js',
  'components/BottomSnackbar.js',
  'components/CanteenClosedMessage.js',
  'components/LegalitiesCard.js',
  'components/ModernComponents.js',
  'components/NotificationStatus.js',
  'screens/AuthHelpScreen.js',
  'screens/CartScreen.js',
  'screens/ContactUsScreen.js',
  'screens/FavoritesHomeScreen.js',
  'screens/FeedbackScreen.js',
  'screens/ForgotPasswordScreen.js',
  'screens/HomeScreen.js',
  'screens/ItemDetailScreen.js',
  'screens/LegalitiesScreen.js',
  'screens/LoginScreen.js',
  'screens/OrderConfirmationScreen.js',
  'screens/OrderStatusScreen.js',
  'screens/OrdersScreen.js',
  'screens/PrivacyPolicyScreen.js',
  'screens/ProfileScreen.js',
  'screens/TermsOfServiceScreen.js',
];

const COMPONENTS_DIR = join(root, 'components');

let totalChanges = 0;

for (const rel of FILES) {
  const filePath = join(root, rel);
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    console.warn(`SKIP (not found): ${rel}`);
    continue;
  }

  const fileDir = join(root, rel, '..');
  // Compute relative path from this file to components/AppIcon
  const appIconPath = join(COMPONENTS_DIR, 'AppIcon');
  let relImport = relative(fileDir, appIconPath).replace(/\\/g, '/');
  if (!relImport.startsWith('.')) relImport = './' + relImport;

  let updated = src;

  // 1. Replace import line
  //    import Ionicons from '@expo/vector-icons/Ionicons';
  //    import Ionicons from "@expo/vector-icons/Ionicons";
  updated = updated.replace(
    /import\s+Ionicons\s+from\s+['"]@expo\/vector-icons\/Ionicons['"]/g,
    `import AppIcon from '${relImport}'`
  );

  // 2. Rename all JSX usages: <Ionicons  =>  <AppIcon
  updated = updated.replace(/<Ionicons(\s)/g, '<AppIcon$1');
  updated = updated.replace(/<\/Ionicons>/g, '</AppIcon>');
  // Also handle self-closing without space: <Ionicons/>
  updated = updated.replace(/<Ionicons\/>/g, '<AppIcon/>');

  if (updated !== src) {
    writeFileSync(filePath, updated, 'utf8');
    const changes = (src.match(/Ionicons/g) || []).length - (updated.match(/Ionicons/g) || []).length;
    console.log(`✅ ${rel}  (${changes} replacements)`);
    totalChanges++;
  } else {
    console.log(`── ${rel}  (no changes)`);
  }
}

console.log(`\nDone. Modified ${totalChanges} files.`);
console.log('The @expo/vector-icons package is still installed (needed for the font files in node_modules).');
console.log('The Ionicons.ttf font will NOT be bundled because no code imports it anymore.\n');
