const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withInfoPlist } = require('expo/config-plugins');

const resource = 'playback_fixture_network_security';
const networkPolicy = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain>127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

module.exports = config => {
  config = withAndroidManifest(config, config => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:networkSecurityConfig'] = `@xml/${resource}`;
    return config;
  });
  config = withDangerousMod(config, ['android', config => {
    const directory = join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${resource}.xml`), networkPolicy);
    return config;
  }]);
  return withInfoPlist(config, config => {
    config.modResults.NSAppTransportSecurity = {
      ...config.modResults.NSAppTransportSecurity,
      NSAllowsLocalNetworking: true,
    };
    return config;
  });
};
