'use strict';

const path = require('path');
const fs = require('fs-extra');
const stringUtil = require('ember-cli-string-utils');
const SilentError = require('silent-error');
const sortPackageJson = require('sort-package-json');
const normalizeEntityName = require('ember-cli-normalize-entity-name');
const execa = require('execa');
const { merge } = require('lodash');

let date = new Date();

const ADDON_OPTIONS = ['addonLocation', 'testAppLocation', 'testAppName', 'releaseIt'];

const description = 'The default blueprint for Embroider v2 addons.';

module.exports = {
  description,

  async afterInstall(options) {
    const appBlueprint = this.lookupBlueprint('app');

    if (!appBlueprint) {
      throw new SilentError('Cannot find app blueprint for generating test-app!');
    }

    let testAppInfo = testAppInfoFromOptions(options);
    let testAppPath = path.join(options.target, testAppInfo.location);

    const appOptions = {
      ...withoutAddonOptions(options),
      target: testAppPath,
      skipNpm: true,
      skipGit: true,
      entity: { name: testAppInfo.name.raw },
      name: testAppInfo.name.raw,
      rawName: testAppInfo.name.raw,
      ciProvider: 'travis', // we will delete this anyway below, as the CI config goes into the root folder
      welcome: false,
    };

    await appBlueprint.install(appOptions);

    let tasks = [
      this.updateTestAppPackageJson(path.join(testAppPath, 'package.json')),
      this.overrideTestAppFiles(
        testAppInfo.location,
        path.join(options.target, 'test-app-overrides')
      ),
      fs.unlink(path.join(testAppPath, '.travis.yml')),
    ];

    if (options.vitest) {
      tasks.push(
        (async () => {
          // lookupBlueprint (used above) does not lookup packages on npm
          await execa(
            'ember',
            ['new', 'tests', '-b', 'vitest-blueprint', '--skip-git', '--skip-npm'],
            { cwd: options.target }
          );
        })()
      );
    }

    if (options.releaseIt) {
      tasks.push(this.setupReleaseIt(options.target));
    }

    await Promise.all(tasks);
  },

  async updateTestAppPackageJson(packageJsonPath) {
    const pkg = require(packageJsonPath);
    const additions = require('./additional-test-app-package.json');

    merge(pkg, additions);

    // we must explicitly add our own v2 addon here, the implicit magic of the legacy dummy app does not work
    pkg.devDependencies[this.locals(this.options).addonName] = '^0.0.0';

    return fs.writeFile(packageJsonPath, JSON.stringify(sortPackageJson(pkg), undefined, 2));
  },

  async overrideTestAppFiles(testAppPath, overridesPath) {
    // we cannot us fs.move, as it will replace the directory, removing the other files of the app blueprint
    // but fs.copy works as we need it. Just have to remove the overrides directory afterwards.
    await fs.copy(overridesPath, testAppPath, {
      overwrite: true,
    });
    await fs.remove(overridesPath);
  },

  async setupReleaseIt(rootPath) {
    await execa('create-rwjblue-release-it-setup', ['--no-install'], {
      cwd: rootPath,
      preferLocal: true,
      localDir: __dirname,
    });
  },

  fileMapTokens(options) {
    let { addonInfo, testAppInfo } = options.locals;

    return {
      __addonLocation__: () => addonInfo.location,
      __testAppLocation__: () => testAppInfo.location,
    };
  },

  locals(options) {
    let addonInfo = addonInfoFromOptions(options);
    let testAppInfo = testAppInfoFromOptions(options);

    let hasOptions = options.welcome || options.yarn || options.ciProvider;

    let blueprintOptions = '';

    if (hasOptions) {
      let indent = `\n            `;
      let outdent = `\n          `;

      blueprintOptions =
        indent +
        [
          options.welcome && '"--welcome"',
          options.yarn && '"--yarn"',
          options.vitest && '"--vitest"',
          options.ciProvider && `"--ci-provider=${options.ciProvider}"`,
          options.addonLocation && `"--addon-location=${options.addonLocation}"`,
          options.testAppLocation && `"--test-app-location=${options.testAppLocation}"`,
          options.testAppName && `"--test-app-name=${options.testAppName}"`,
          options.releaseIt && `"--release-it"`,
        ]
          .filter(Boolean)
          .join(',\n            ') +
        outdent;
    }

    let pathFromAddonToRoot = addonInfo.location
      .split('/')
      .map(() => '..')
      .join('/');

    return {
      addonInfo,
      testAppInfo,
      addonName: addonInfo.name.dashed,
      addonNamespace: addonInfo.name.classified,
      blueprintVersion: require('./package.json').version,
      year: date.getFullYear(),
      yarn: options.yarn,
      vitest: options.vitest,
      welcome: options.welcome,
      blueprint: 'addon',
      blueprintOptions,
      ciProvider: options.ciProvider,
      pathFromAddonToRoot,
    };
  },

  normalizeEntityName(entityName) {
    entityName = normalizeEntityName(entityName);

    if (this.project.isEmberCLIProject() && !this.project.isEmberCLIAddon()) {
      throw new SilentError(
        'Generating an addon in an existing ember-cli project is not supported.'
      );
    }

    return entityName;
  },
};

/**
 * Custom info derived from CLI options for use within this blueprint.
 * Nothing in this object is expected from the blueprint system.
 */
function addonInfoFromOptions(options) {
  let addonEntity = options.entity;
  let addonRawName = addonEntity.name;
  let dashedName = stringUtil.dasherize(addonRawName);

  return {
    name: {
      dashed: dashedName,
      classified: stringUtil.classify(addonRawName),
      raw: addonRawName,
    },
    entity: addonEntity,
    location: options.addonLocation || dashedName,
  };
}

function testAppInfoFromOptions(options) {
  let name = options.testAppName || 'test-app';
  let dashedName = stringUtil.dasherize(name);

  return {
    name: {
      dashed: dashedName,
      raw: name,
    },
    location: options.testAppLocation || dashedName,
  };
}

function withoutAddonOptions(options) {
  let result = {};

  for (let [key, value] of Object.entries(options)) {
    if (ADDON_OPTIONS.includes(key)) continue;
    result[key] = value;
  }

  return result;
}
