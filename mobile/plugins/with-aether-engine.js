const { withPodfile, withXcodeProject } = require('expo/config-plugins');

const repository = 'https://github.com/superuser404notfound/AetherEngine';
const version = '7.76.0';
const productName = 'AetherEngine';

const withAetherPackage = config => withXcodeProject(config, config => {
  const project = config.modResults;
  const { firstProject } = project.getFirstProject();
  const { uuid: targetId, firstTarget } = project.getFirstTarget();
  const objects = project.hash.project.objects;
  const packages = objects.XCRemoteSwiftPackageReference ??= {};
  const products = objects.XCSwiftPackageProductDependency ??= {};
  const frameworks = project.pbxFrameworksBuildPhaseObj(targetId);
  if (!frameworks) throw new Error('The Navigator target requires an Xcode Frameworks build phase');

  // node-xcode retains quotes around strings read from an existing project.
  const unquote = value => value?.replace(/^"|"$/g, '');
  const existingPackage = firstProject.packageReferences?.find(ref =>
    unquote(packages[ref.value]?.repositoryURL) === repository
  );
  const packageId = existingPackage?.value ?? project.generateUuid();
  packages[packageId] = {
    isa: 'XCRemoteSwiftPackageReference',
    repositoryURL: `"${repository}"`,
    requirement: { kind: 'exactVersion', version: `"${version}"` },
  };
  packages[`${packageId}_comment`] = productName;
  if (!existingPackage) {
    (firstProject.packageReferences ??= []).push({ value: packageId, comment: productName });
  }

  const existingProduct = firstTarget.packageProductDependencies?.find(ref =>
    products[ref.value]?.package === packageId && products[ref.value]?.productName === productName
  );
  if (existingProduct) return config;

  const productId = project.generateUuid();
  products[productId] = {
    isa: 'XCSwiftPackageProductDependency',
    package: packageId,
    productName,
  };
  products[`${productId}_comment`] = productName;
  (firstTarget.packageProductDependencies ??= []).push({ value: productId, comment: productName });

  const buildFileId = project.generateUuid();
  const comment = `${productName} in Frameworks`;
  objects.PBXBuildFile[buildFileId] = {
    isa: 'PBXBuildFile',
    productRef: productId,
    productRef_comment: productName,
  };
  objects.PBXBuildFile[`${buildFileId}_comment`] = comment;
  frameworks.files.push({ value: buildFileId, comment });
  return config;
});

module.exports = config => withPodfile(withAetherPackage(config), config => {
  const anchor = '  post_install do |installer|\n';
  const marker = '    # Xcode 27 requires iOS 15 or later for pod resource targets.';
  const { contents } = config.modResults;
  if (contents.includes(marker)) return config;
  if (!contents.includes(anchor)) throw new Error('The Navigator Podfile requires a post-install hook');

  const minimum = [
    marker,
    "    minimum_ios = Gem::Version.new('15.0')",
    '    installer.pods_project.targets.each do |target|',
    '      target.build_configurations.each do |build|',
    "        deployment = build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_s",
    '        next unless deployment.match?(/\\A\\d+(?:\\.\\d+)*\\z/)',
    "        build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios.to_s if Gem::Version.new(deployment) < minimum_ios",
    '      end',
    '    end',
    '',
    '',
  ].join('\n');
  config.modResults.contents = contents.replace(anchor, anchor + minimum);
  return config;
});
