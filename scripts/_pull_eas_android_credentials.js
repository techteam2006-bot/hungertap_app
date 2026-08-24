#!/usr/bin/env node
/**
 * Download Android upload keystore + credentials.json from EAS (non-interactive).
 * Uses globally installed eas-cli internals.
 */
const path = require('path');
const fs = require('fs');

const projectDir = path.join(__dirname, '..');
const easCliRoot = process.env.EAS_CLI_ROOT || path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  'npm',
  'node_modules',
  'eas-cli'
);
if (!fs.existsSync(path.join(easCliRoot, 'package.json'))) {
  throw new Error(`eas-cli not found at ${easCliRoot}. Install with: npm install -g eas-cli`);
}

const { CredentialsContext } = require(path.join(easCliRoot, 'build/credentials/context'));
const { UpdateCredentialsJson } = require(path.join(easCliRoot, 'build/credentials/android/actions/UpdateCredentialsJson'));
const AndroidGraphqlClient = require(path.join(easCliRoot, 'build/credentials/android/api/GraphqlClient'));
const { sortBuildCredentials } = require(path.join(easCliRoot, 'build/credentials/android/actions/BuildCredentialsUtils'));
const { createGraphqlClient } = require(path.join(easCliRoot, 'build/commandUtils/context/contextUtils/createGraphqlClient'));
const SessionManager = require(path.join(easCliRoot, 'build/user/SessionManager')).default;
const { getPrivateExpoConfigAsync } = require(path.join(easCliRoot, 'build/project/expoConfig'));
const { AppQuery } = require(path.join(easCliRoot, 'build/graphql/queries/AppQuery'));
async function main() {
  const sessionManager = new SessionManager({ setActor: () => {}, logEvent: async () => {} });
  const { actor, authenticationInfo } = await sessionManager.ensureLoggedInAsync({ nonInteractive: true });
  const graphqlClient = createGraphqlClient(authenticationInfo);
  const exp = await getPrivateExpoConfigAsync(projectDir);
  const projectId = exp?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error('Missing extra.eas.projectId in app config.');
  }
  const app = await AppQuery.byIdAsync(graphqlClient, projectId);

  const ctx = new CredentialsContext({
    projectDir,
    user: actor,
    graphqlClient,
    analytics: { logEvent: async () => {} },
    vcsClient: { isFileUntrackedAsync: async () => true },
    nonInteractive: true,
    projectInfo: { exp, projectId },
  });

  const appLookup = { account: app.ownerAccount, projectName: app.slug };
  const buildCredentialsList = await AndroidGraphqlClient.getAndroidAppBuildCredentialsListAsync(
    graphqlClient,
    appLookup
  );
  if (!buildCredentialsList.length) {
    throw new Error('No Android build credentials found on EAS for this project.');
  }

  const sorted = sortBuildCredentials(buildCredentialsList);
  const buildCredentials = sorted.find((c) => c.isDefault) ?? sorted[0];
  console.log(`Using build credentials: ${buildCredentials.name}${buildCredentials.isDefault ? ' (default)' : ''}`);

  await new UpdateCredentialsJson().runAsync(ctx, buildCredentials);

  const credPath = path.join(projectDir, 'credentials.json');
  if (!fs.existsSync(credPath)) {
    throw new Error('credentials.json was not created.');
  }

  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const ks = creds?.android?.keystore;
  if (!ks?.keystorePath || !ks?.keystorePassword || !ks?.keyAlias) {
    throw new Error('credentials.json is missing android keystore fields.');
  }

  const keystoreAbs = path.isAbsolute(ks.keystorePath)
    ? ks.keystorePath
    : path.join(projectDir, ks.keystorePath);
  if (!fs.existsSync(keystoreAbs)) {
    throw new Error(`Keystore file missing at ${keystoreAbs}`);
  }

  const keystoreProps = [
    '# Local release signing — same upload keystore as EAS / Play Store (gitignored).',
    '# storeFile is relative to android/app/ (see android/app/build.gradle release signingConfig).',
    `storeFile=${path.relative(path.join(projectDir, 'android', 'app'), keystoreAbs).replace(/\\/g, '/')}`,
    `storePassword=${ks.keystorePassword}`,
    `keyAlias=${ks.keyAlias}`,
    `keyPassword=${ks.keyPassword || ks.keystorePassword}`,
    '',
  ].join('\n');

  fs.mkdirSync(path.join(projectDir, 'android'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'android', 'keystore.properties'), keystoreProps, 'utf8');
  console.log('Wrote android/keystore.properties');
  console.log('Done.');
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
