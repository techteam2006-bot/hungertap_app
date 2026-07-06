/**
 * Generates components/AppIcon.js by extracting SVG data from the
 * ionicons package SVG files for every icon used in the codebase.
 * Run: node scripts/generateAppIcon.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgDir = join(root, 'node_modules/ionicons/dist/svg');

// Every Ionicons name used in the codebase (from grep)
const USED_ICONS = [
  'add', 'add-outline',
  'alert-circle-outline',
  'arrow-back', 'arrow-back-outline',
  'basket-outline',
  'business-outline',
  'cafe-outline',
  'cart', 'cart-outline',
  'chatbubble-ellipses-outline',
  'chatbubbles-outline',
  'checkmark', 'checkmark-circle', 'checkmark-outline',
  'chevron-down', 'chevron-forward',
  'close', 'close-circle', 'close-outline',
  'document-text-outline',
  'eye', 'eye-off', 'eye-off-outline', 'eye-outline',
  'home', 'home-outline',
  'information-circle-outline',
  'key-outline',
  'leaf-outline',
  'location', 'location-outline',
  'lock-closed-outline', 'lock-open-outline',
  'log-out-outline',
  'logo-facebook', 'logo-instagram', 'logo-twitter',
  'mail-outline',
  'moon-outline',
  'notifications-outline',
  'person', 'person-outline',
  'receipt', 'receipt-outline',
  'refresh', 'refresh-outline',
  'restaurant',
  'search',
  'send-outline',
  'share-social-outline',
  'shield-checkmark-outline',
  'sparkles-outline',
  'storefront', 'storefront-outline',
  'time-outline',
  'trash-outline',
  'wallet-outline',
  'wifi-outline',
];

function attr(str, name) {
  // Use word boundary to avoid 'stroke-width' matching 'width', etc.
  const m = str.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`));
  return m ? m[1] : null;
}

function parseElements(svgContent) {
  const elements = [];

  // Match each self-closing or open SVG element tag
  const tagRe = /<(path|circle|ellipse|rect|polyline|polygon|line)([^>]*?)\/?>(?:<\/\1>)?/g;
  let m;
  while ((m = tagRe.exec(svgContent)) !== null) {
    const tag = m[1];
    const attrs = m[2];

    const d = attr(attrs, 'd');
    const fill = attr(attrs, 'fill');
    const stroke = attr(attrs, 'stroke');
    const strokeWidth = attr(attrs, 'stroke-width');
    const strokeLinecap = attr(attrs, 'stroke-linecap');
    const strokeLinejoin = attr(attrs, 'stroke-linejoin');
    const cx = attr(attrs, 'cx');
    const cy = attr(attrs, 'cy');
    const r = attr(attrs, 'r');
    const rx = attr(attrs, 'rx');
    const ry = attr(attrs, 'ry');
    const x = attr(attrs, 'x') || '0';
    const y = attr(attrs, 'y') || '0';
    const width = attr(attrs, 'width');
    const height = attr(attrs, 'height');
    const points = attr(attrs, 'points');
    const x1 = attr(attrs, 'x1');
    const y1 = attr(attrs, 'y1');
    const x2 = attr(attrs, 'x2');
    const y2 = attr(attrs, 'y2');

    elements.push({ tag, d, fill, stroke, strokeWidth, strokeLinecap, strokeLinejoin, cx, cy, r, rx, ry, x, y, width, height, points, x1, y1, x2, y2 });
  }
  return elements;
}

function buildProps(el) {
  const props = [];

  if (el.d) props.push(`d="${el.d}"`);
  if (el.cx) props.push(`cx={${el.cx}}`);
  if (el.cy) props.push(`cy={${el.cy}}`);
  if (el.r) props.push(`r={${el.r}}`);
  if (el.rx) props.push(`rx={${el.rx}}`);
  if (el.ry) props.push(`ry={${el.ry}}`);
  // width/height only apply to rect elements, not path/circle/etc.
  if (el.width && el.tag === 'rect') props.push(`width={${el.width}}`);
  if (el.height && el.tag === 'rect') props.push(`height={${el.height}}`);
  if (el.x && el.x !== '0') props.push(`x={${el.x}}`);
  if (el.y && el.y !== '0') props.push(`y={${el.y}}`);
  if (el.points) props.push(`points="${el.points}"`);
  if (el.x1) props.push(`x1={${el.x1}}`);
  if (el.y1) props.push(`y1={${el.y1}}`);
  if (el.x2) props.push(`x2={${el.x2}}`);
  if (el.y2) props.push(`y2={${el.y2}}`);

  // fill
  if (el.fill === 'none') {
    props.push('fill="none"');
  } else if (el.fill && el.fill !== 'currentColor') {
    props.push(`fill="${el.fill}"`);
  } else {
    // if stroke is set, filled icons don't use stroke, outline ones do
    if (el.stroke) {
      props.push('fill="none"');
    } else {
      props.push('fill={color}');
    }
  }

  // stroke
  if (el.stroke === 'currentColor' || el.stroke === 'inherit') {
    props.push('stroke={color}');
  } else if (el.stroke && el.stroke !== 'none') {
    props.push(`stroke="${el.stroke}"`);
  }

  if (el.strokeWidth) {
    const sw = parseFloat(el.strokeWidth);
    props.push(`strokeWidth={${sw}}`);
  }
  if (el.strokeLinecap) props.push(`strokeLinecap="${el.strokeLinecap}"`);
  if (el.strokeLinejoin) props.push(`strokeLinejoin="${el.strokeLinejoin}"`);

  return props.join(' ');
}

function TAG_TO_COMPONENT(tag) {
  const map = { path: 'Path', circle: 'Circle', ellipse: 'Ellipse', rect: 'Rect', polyline: 'Polyline', polygon: 'Polygon', line: 'Line' };
  return map[tag] || 'Path';
}

function elementsToJSX(elements) {
  return elements
    .map((el) => `        <${TAG_TO_COMPONENT(el.tag)} ${buildProps(el)} />`)
    .join('\n');
}

// Collect which SVG tags are actually needed for the import line
function collectComponents(elements) {
  const set = new Set();
  for (const el of elements) set.add(TAG_TO_COMPONENT(el.tag));
  return set;
}

const iconMap = {};
const missing = [];
const usedComponents = new Set(['Path']); // Path is always needed

for (const name of USED_ICONS) {
  const svgPath = join(svgDir, `${name}.svg`);
  if (!existsSync(svgPath)) {
    missing.push(name);
    continue;
  }
  const content = readFileSync(svgPath, 'utf8');
  const elements = parseElements(content);
  if (elements.length === 0) {
    missing.push(name);
    continue;
  }
  iconMap[name] = elements;
  for (const c of collectComponents(elements)) usedComponents.add(c);
}

if (missing.length > 0) {
  console.warn('Missing icons (will use empty fallback):', missing.join(', '));
}

const svgImports = [...usedComponents].sort().join(', ');

const caseBlocks = Object.entries(iconMap)
  .map(([name, elements]) => {
    return `    case '${name}':
      return (
        <Svg viewBox="0 0 512 512" width={size} height={size} style={style}>
${elementsToJSX(elements)}
        </Svg>
      );`;
  })
  .join('\n');

const output = `// AUTO-GENERATED by scripts/generateAppIcon.mjs — do not edit manually.
// Re-run \`node scripts/generateAppIcon.mjs\` to regenerate after adding new icons.
import React from 'react';
import Svg, { ${svgImports} } from 'react-native-svg';

/**
 * Drop-in replacement for \`@expo/vector-icons/Ionicons\`.
 * Renders icons as inline SVG via react-native-svg (already a project dependency).
 * Eliminates the ~381 KB Ionicons.ttf font asset from the APK.
 *
 * Usage:  <AppIcon name="home-outline" size={24} color={colors.text} />
 */
export default function AppIcon({ name, size = 24, color = 'black', style }) {
  switch (name) {
${caseBlocks}
    default:
      // Unknown icon name — render empty placeholder so layout is preserved
      return <Svg viewBox="0 0 512 512" width={size} height={size} style={style} />;
  }
}
`;

const outPath = join(root, 'components/AppIcon.js');
writeFileSync(outPath, output, 'utf8');
console.log(`\nWrote ${Object.keys(iconMap).length} icons to components/AppIcon.js`);
console.log(`SVG components used: ${svgImports}`);
if (missing.length) console.log(`Skipped (SVG not found): ${missing.join(', ')}`);
console.log('\nNext: run the sed-replace script to swap all Ionicons imports.\n');
