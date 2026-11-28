module.exports = ({ config }) => {
  if (process.env.NAVIGATOR_IOS_AETHER === '1') {
    config.ios = { ...config.ios, deploymentTarget: '18.0' };
    config.experiments = {
      ...config.experiments,
      inlineModules: { watchedDirectories: ['native/aether'] },
    };
    config.plugins = [...(config.plugins ?? []), './plugins/with-aether-engine'];
  }

  return config;
};
