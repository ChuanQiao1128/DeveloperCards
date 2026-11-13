const { withXcodeProject } = require('expo/config-plugins');
function patchPhase(script) {
  // Expo/Sentry may wrap the RN script. Replace exactly the resolved RN
  // invocation, so the observer surrounds Metro AND its final Hermes compile.
  const token = /`"\$NODE_BINARY" --print "require\('path'\)\.dirname\(require\.resolve\('react-native\/package\.json'\)\) \+ '\/scripts\/react-native-xcode\.sh'"`/g;
  const matches = script.match(token);
  if (matches?.length !== 1) throw new Error('unsupported Xcode bundling invocation; provenance stays closed');
  return script.replace(token, '"$PROJECT_DIR/../scripts/release/observeNativeBundle.cjs"');
}
module.exports = config => withXcodeProject(config, cfg => {
  const phases = cfg.modResults.pbxShellScriptBuildPhaseSection();
  const candidates = Object.values(phases).filter(p => typeof p === 'object' && p.name === '"Bundle React Native code and images"');
  if (candidates.length !== 1) throw new Error('expected one Xcode RN bundling phase');
  const phase = candidates[0];
  const script = JSON.parse(phase.shellScript);
  phase.shellScript = JSON.stringify(patchPhase(script));
  phase.alwaysOutOfDate = 1;
  return cfg;
});
module.exports.patchPhase = patchPhase;
