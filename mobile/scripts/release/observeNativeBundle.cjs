#!/usr/bin/env node
// Executed IN the Xcode RN bundle phase, before resource signing. No public
// finalize/import path: the producer allocates the destination and nonce.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateContext, signedContext, encode, regular, exclusive } = require('./nativeBuildProvenance.cjs');
const { sha } = require('./queueOwnershipRollout.cjs');
function observe(root, env = process.env, run = execFileSync) {
  const c = validateContext(JSON.parse(regular(path.join(root, '.ownership-build.json'), 1024 * 1024)));
  if (env.CONFIGURATION !== 'Release' || env.PLATFORM_NAME !== 'iphoneos' || env.SKIP_BUNDLING ||
    env.USE_HERMES === 'false' || (env.BUNDLE_NAME && env.BUNDLE_NAME !== 'main')) throw new Error('fresh Release/iphoneos/Hermes bundling required');
  const build = fs.realpathSync(env.CONFIGURATION_BUILD_DIR);
  const derived = fs.realpathSync(path.join(c.runDir, 'derived-data'));
  if (!build.startsWith(`${derived}/`)) throw new Error('Xcode bundle staging is outside this private run');
  const resources = env.UNLOCALIZED_RESOURCES_FOLDER_PATH;
  if (!resources || path.isAbsolute(resources) || resources.split('/').includes('..')) throw new Error('unsafe Xcode resources path');
  const dest = path.join(build, resources, 'main.jsbundle');
  const intermediate = path.join(build, 'main.jsbundle');
  if (fs.existsSync(dest) || fs.existsSync(intermediate) || fs.existsSync(path.join(c.runDir, 'bundle-stage.json'))) throw new Error('pre-existing/stale bundle or repeated observation');
  // Require the exact reviewed npm-locked RN implementation. Overrides supplied
  // by .xcode.env or shell phases cannot replace Metro/Hermes inputs silently.
  const script = path.join(root, 'node_modules/react-native/scripts/react-native-xcode.sh');
  const locked = JSON.parse(regular(path.join(root, 'node_modules/react-native/package.json')));
  if (locked.version !== '0.81.5') throw new Error('unsupported RN bundling tool');
  if (env.NODE_OPTIONS || env.NODE_ARGS || env.EXTRA_PACKAGER_ARGS || env.BUNDLE_CONFIG || env.CONFIG_CMD || env.CONFIG_JSON || env.HERMES_CLI_PATH) throw new Error('uncontrolled bundle override');
  const cli = require.resolve('@expo/cli', { paths: [path.join(root, 'node_modules/expo/package.json')] });
  const hermes = path.join(env.PODS_ROOT, 'hermes-engine/destroot/bin/hermesc');
  const controlled = { ...env, PROJECT_ROOT: root, NODE_BINARY: process.execPath, NODE_ARGS: '',
    ENTRY_FILE: path.join(root, 'index.ts'), CLI_PATH: cli, BUNDLE_COMMAND: 'export:embed',
    HERMES_CLI_PATH: hermes, USE_HERMES: 'true', SKIP_BUNDLING: '', BUNDLE_NAME: 'main' };
  try {
    run('/bin/bash', [script], { cwd: root, env: controlled, stdio: 'pipe', timeout: 20 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
  } catch { throw new Error('Metro/Hermes build failed; tool output withheld to protect authorization'); }
  const bytes = regular(dest, 64 * 1024 * 1024);
  // Hermes HBC magic (little endian 0x1F1903C103BC1FC6).
  if (!bytes.subarray(0, 8).equals(Buffer.from('c61fbc03c103191f', 'hex'))) throw new Error('final Xcode bundle is not Hermes bytecode');
  exclusive(path.join(c.runDir, 'observed-main.jsbundle'), bytes);
  exclusive(path.join(c.runDir, 'bundle-stage.json'), encode({ stage: 'xcode-react-native-hermes-final-v2',
    provenance: signedContext(c), configuration: 'Release', platform: 'iphoneos', bundlePath: dest,
    bundleSha256: sha(bytes), reactNativeScriptSha256: sha(regular(script)), hermesCompilerSha256: sha(regular(hermes)) }));
}
module.exports = { observe };
if (require.main === module) {
  try { observe(path.resolve(__dirname, '../..')); }
  catch (error) { console.error(`native bundle observation refused: ${error.message}`); process.exitCode = 7; }
}
