const fs = require('node:fs');
const path = require('node:path');
const { validateContext, signedContext } = require('./scripts/release/nativeBuildProvenance.cjs');
module.exports = ({ config }) => {
  const file = path.join(__dirname, '.ownership-build.json');
  if (!fs.existsSync(file)) return config;
  const context = validateContext(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (config.ios?.infoPlist?.RecallSmithBuildProvenance) throw new Error('reserved build provenance already exists');
  return { ...config, ios: { ...config.ios, infoPlist: { ...config.ios?.infoPlist,
    RecallSmithBuildProvenance: signedContext(context) } },
    plugins: [...(config.plugins ?? []), './plugins/withBuildProvenance'] };
};
