const { withXcodeProject } = require('expo/config-plugins');

const repository = 'https://github.com/superuser404notfound/AetherEngine';
const version = '7.76.0';
const productName = 'AetherEngine';

module.exports = config => withXcodeProject(config, config => {
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
