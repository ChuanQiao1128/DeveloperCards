const { withXcodeProject } = require('expo/config-plugins');
function patchPhase(script) {
  // Surround Sentry's tool injection, not its RN subprocess: that subprocess
  // must keep Sentry's Node/Hermes wrappers for source-map discovery.
  const resolved = (pkg, name) => '`"$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'' + pkg + '/package.json\')) + \'/scripts/' + name + '\'"`';
  const command = '/bin/sh ' + resolved('@sentry/react-native', 'sentry-xcode.sh') + ' ' + resolved('react-native', 'react-native-xcode.sh');
  const lines = script.split('\n');
  if (lines.filter(line => line === command).length !== 1 ||
    script.split('/scripts/react-native-xcode.sh').length !== 2 || script.split('/scripts/sentry-xcode.sh').length !== 2) {
    throw new Error('unsupported Xcode bundling invocation; provenance stays closed');
  }
  return lines.map(line => line === command ? '"$PROJECT_DIR/../scripts/release/observeNativeBundle.cjs"' : line).join('\n');
}
module.exports = config => withXcodeProject(config, cfg => {
  const phases = cfg.modResults.hash.project.objects.PBXShellScriptBuildPhase || {};
  const candidates = Object.values(phases).filter(p => typeof p === 'object' && p.name === '"Bundle React Native code and images"');
  if (candidates.length !== 1) throw new Error('expected one Xcode RN bundling phase');
  const phase = candidates[0];
  const script = JSON.parse(phase.shellScript);
  phase.shellScript = JSON.stringify(patchPhase(script));
  phase.alwaysOutOfDate = 1;
  return cfg;
});
module.exports.patchPhase = patchPhase;
