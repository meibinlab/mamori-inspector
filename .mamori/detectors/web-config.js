'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

// ワークスペース探索時に除外するディレクトリ一覧を表す
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.mamori',
  '.mamori-inline-tmp',
  '.vscode-test',
  '.vscode-test-web',
  'build',
  'dist',
  'node_modules',
  'out',
  'target',
]);

/**
 * 候補ファイル名パターンに一致するか判定する。
 * @param {string} filename 判定対象のファイル名を表す。
 * @param {{type: string, value: string}} candidatePattern 候補パターンを表す。
 * @returns {boolean} 一致した場合は true を返す。
 */
function matchesPattern(filename, candidatePattern) {
  if (!candidatePattern || typeof candidatePattern.value !== 'string') {
    return false;
  }

  if (candidatePattern.type === 'exact') {
    return filename === candidatePattern.value;
  }

  if (candidatePattern.type === 'prefix') {
    return filename.startsWith(candidatePattern.value);
  }

  return false;
}

/**
 * ディレクトリ階層を上位へたどる。
 * @param {string} startDirectory 探索開始ディレクトリを表す。
 * @param {string} stopDirectory 探索停止ディレクトリを表す。
 * @returns {string[]} 探索対象ディレクトリ一覧を返す。
 */
function buildSearchDirectories(startDirectory, stopDirectory) {
  // 探索対象ディレクトリ一覧を表す
  const directories = [];
  // 現在探索中のディレクトリを表す
  let currentDirectory = path.resolve(startDirectory);
  // 探索停止ディレクトリを表す
  const resolvedStopDirectory = path.resolve(stopDirectory);

  while (true) {
    directories.push(currentDirectory);
    if (currentDirectory === resolvedStopDirectory) {
      break;
    }

    // 1つ上の親ディレクトリを表す
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }

  return directories;
}

/**
 * 最初に見つかった設定ファイルを返す。
 * @param {string[]} startDirectories 探索開始ディレクトリ一覧を表す。
 * @param {string} stopDirectory 探索停止ディレクトリを表す。
 * @param {{type: string, value: string}[]} candidatePatterns 候補パターン一覧を表す。
 * @returns {string|null} 見つかった設定ファイルの絶対パスを返す。
 */
function findFirstExistingFile(startDirectories, stopDirectory, candidatePatterns) {
  for (const startDirectory of startDirectories) {
    if (!fs.existsSync(startDirectory) || !fs.statSync(startDirectory).isDirectory()) {
      continue;
    }

    // 探索対象ディレクトリ一覧を表す
    const searchDirectories = buildSearchDirectories(startDirectory, stopDirectory);

    for (const searchDirectory of searchDirectories) {
      if (!fs.existsSync(searchDirectory) || !fs.statSync(searchDirectory).isDirectory()) {
        continue;
      }

      // ディレクトリエントリ一覧を表す
      const entries = fs.readdirSync(searchDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        if (!candidatePatterns.some((candidatePattern) => matchesPattern(entry.name, candidatePattern))) {
          continue;
        }
        return path.join(searchDirectory, entry.name);
      }
    }
  }

  return null;
}

/**
 * package.json から設定キーを探索する。
 * @param {string[]} startDirectories 探索開始ディレクトリ一覧を表す。
 * @param {string} stopDirectory 探索停止ディレクトリを表す。
 * @param {string} packageJsonKey 探索対象キー名を表す。
 * @returns {{packageJsonPath: string, packageJsonKey: string}|null} 見つかった package.json 情報を返す。
 */
function findPackageJsonConfiguration(startDirectories, stopDirectory, packageJsonKey) {
  for (const startDirectory of startDirectories) {
    if (!fs.existsSync(startDirectory) || !fs.statSync(startDirectory).isDirectory()) {
      continue;
    }

    // 探索対象ディレクトリ一覧を表す
    const searchDirectories = buildSearchDirectories(startDirectory, stopDirectory);

    for (const searchDirectory of searchDirectories) {
      // package.json の絶対パスを表す
      const packageJsonPath = path.join(searchDirectory, 'package.json');
      if (!fs.existsSync(packageJsonPath) || !fs.statSync(packageJsonPath).isFile()) {
        continue;
      }

      try {
        // package.json の解析結果を表す
        const parsedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (Object.prototype.hasOwnProperty.call(parsedPackageJson, packageJsonKey)) {
          return {
            packageJsonPath,
            packageJsonKey,
          };
        }
      } catch {
        // package.json の破損は探索失敗として扱う
      }
    }
  }

  return null;
}

/**
 * 単一ディレクトリ直下で最初に一致した設定ファイルを返す。
 * @param {string} directoryPath 探索対象ディレクトリを表す。
 * @param {{type: string, value: string}[]} candidatePatterns 候補パターン一覧を表す。
 * @returns {string|null} 見つかった設定ファイルの絶対パスを返す。
 */
function findMatchingFileInDirectory(directoryPath, candidatePatterns) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return null;
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const candidatePattern of candidatePatterns) {
    const matchedFilename = filenames.find((filename) => matchesPattern(filename, candidatePattern));
    if (matchedFilename) {
      return path.join(directoryPath, matchedFilename);
    }
  }

  return null;
}

/**
 * 単一ディレクトリ直下の package.json から設定キーを探索する。
 * @param {string} directoryPath 探索対象ディレクトリを表す。
 * @param {string} packageJsonKey 探索対象キー名を表す。
 * @returns {{packageJsonPath: string, packageJsonKey: string}|null} 見つかった設定情報を返す。
 */
function findPackageJsonConfigurationInDirectory(directoryPath, packageJsonKey) {
  const packageJsonPath = path.join(directoryPath, 'package.json');
  if (!fs.existsSync(packageJsonPath) || !fs.statSync(packageJsonPath).isFile()) {
    return null;
  }

  try {
    const parsedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (Object.prototype.hasOwnProperty.call(parsedPackageJson, packageJsonKey)) {
      return {
        packageJsonPath,
        packageJsonKey,
      };
    }
  } catch {
    // package.json の破損は探索失敗として扱う
  }

  return null;
}

/**
 * 単一ディレクトリ直下の Web ツール設定を探索する。
 * @param {string} directoryPath 探索対象ディレクトリを表す。
 * @param {{configPatterns?: {type: string, value: string}[], packageJsonKey?: string}} toolDefaults ツール既定値を表す。
 * @returns {{enabled: boolean, source: string, locationType: string, path?: string, packageJsonKey?: string}} 解決結果を返す。
 */
function discoverWebToolConfigurationInDirectory(directoryPath, toolDefaults) {
  const configPatterns = Array.isArray(toolDefaults.configPatterns)
    ? toolDefaults.configPatterns
    : [];
  const packageJsonKey = typeof toolDefaults.packageJsonKey === 'string'
    ? toolDefaults.packageJsonKey
    : '';
  const discoveredConfigPath = findMatchingFileInDirectory(directoryPath, configPatterns);

  if (discoveredConfigPath) {
    return {
      enabled: true,
      source: 'discovery',
      locationType: 'file',
      path: discoveredConfigPath,
    };
  }

  if (packageJsonKey) {
    const packageJsonConfiguration = findPackageJsonConfigurationInDirectory(directoryPath, packageJsonKey);
    if (packageJsonConfiguration) {
      return {
        enabled: true,
        source: 'discovery',
        locationType: 'packageJson',
        path: packageJsonConfiguration.packageJsonPath,
        packageJsonKey: packageJsonConfiguration.packageJsonKey,
      };
    }
  }

  return {
    enabled: false,
    source: 'default',
    locationType: 'disabled',
  };
}

/**
 * ワークスペース配下の Web 設定モジュール一覧を探索する。
 * @param {string} workspaceRoot ワークスペースルートを表す。
 * @param {{eslint?: object, oxlint?: object, tsc?: object, stylelint?: object, htmlhint?: object, 'html-validate'?: object}} defaults Web 既定値を表す。
 * @returns {Array<{moduleRoot: string, web: {eslint: object, oxlint: object, tsc: object, stylelint: object, htmlhint: object, 'html-validate': object}}>} モジュール一覧を返す。
 */
function discoverWorkspaceWebModules(workspaceRoot, defaults) {
  const modules = [];
  const pendingDirectories = [workspaceRoot];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    const moduleResolution = {
      eslint: discoverWebToolConfigurationInDirectory(currentDirectory, defaults.eslint || {}),
      oxlint: discoverWebToolConfigurationInDirectory(currentDirectory, defaults.oxlint || {}),
      tsc: discoverWebToolConfigurationInDirectory(currentDirectory, defaults.tsc || {}),
      stylelint: discoverWebToolConfigurationInDirectory(currentDirectory, defaults.stylelint || {}),
      htmlhint: discoverWebToolConfigurationInDirectory(currentDirectory, defaults.htmlhint || {}),
      'html-validate': discoverWebToolConfigurationInDirectory(currentDirectory, defaults['html-validate'] || {}),
    };
    const hasEnabledTool = Object.values(moduleResolution).some((toolResolution) => toolResolution.enabled);
    if (hasEnabledTool) {
      modules.push({
        moduleRoot: currentDirectory,
        web: moduleResolution,
      });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      pendingDirectories.push(path.join(currentDirectory, entry.name));
    }
  }

  return modules.sort((leftModule, rightModule) => leftModule.moduleRoot.localeCompare(rightModule.moduleRoot));
}

/**
 * 単一 Web ツールの設定を探索する。
 * @param {string[]} startDirectories 探索開始ディレクトリ一覧を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{configPatterns?: {type: string, value: string}[], packageJsonKey?: string}} toolDefaults ツールの既定値を表す。
 * @returns {{enabled: boolean, source: string, locationType: string, path?: string, packageJsonKey?: string}} 解決結果を返す。
 */
function discoverWebToolConfiguration(startDirectories, currentWorkingDirectory, toolDefaults) {
  // 設定ファイル候補パターン一覧を表す
  const configPatterns = Array.isArray(toolDefaults.configPatterns)
    ? toolDefaults.configPatterns
    : [];
  // package.json のキー名を表す
  const packageJsonKey = typeof toolDefaults.packageJsonKey === 'string'
    ? toolDefaults.packageJsonKey
    : '';
  // 探索で見つかった設定ファイルを表す
  const discoveredConfigPath = findFirstExistingFile(
    startDirectories,
    currentWorkingDirectory,
    configPatterns,
  );

  if (discoveredConfigPath) {
    return {
      enabled: true,
      source: 'discovery',
      locationType: 'file',
      path: discoveredConfigPath,
    };
  }

  if (packageJsonKey) {
    // package.json から見つかった設定情報を表す
    const packageJsonConfiguration = findPackageJsonConfiguration(
      startDirectories,
      currentWorkingDirectory,
      packageJsonKey,
    );
    if (packageJsonConfiguration) {
      return {
        enabled: true,
        source: 'discovery',
        locationType: 'packageJson',
        path: packageJsonConfiguration.packageJsonPath,
        packageJsonKey: packageJsonConfiguration.packageJsonKey,
      };
    }
  }

  return {
    enabled: false,
    source: 'default',
    locationType: 'disabled',
  };
}

/**
 * Web 系ツール設定の探索結果を返す。
 * @param {string[]} startDirectories 探索開始ディレクトリ一覧を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{eslint?: object, oxlint?: object, tsc?: object, stylelint?: object, htmlhint?: object, 'html-validate'?: object}} defaults Web 既定値を表す。
 * @returns {{eslint: object, oxlint: object, tsc: object, stylelint: object, htmlhint: object, 'html-validate': object}} 解決結果を返す。
 */
function discoverWebConfigurations(startDirectories, currentWorkingDirectory, defaults) {
  // ESLint の探索結果を表す
  const eslint = discoverWebToolConfiguration(
    startDirectories,
    currentWorkingDirectory,
    defaults.eslint || {},
  );
  // Oxlint の探索結果を表す
  const oxlint = discoverWebToolConfiguration(
    startDirectories,
    currentWorkingDirectory,
    defaults.oxlint || {},
  );
  // TypeScript compiler の探索結果を表す
  const tsc = discoverWebToolConfiguration(
    startDirectories,
    currentWorkingDirectory,
    defaults.tsc || {},
  );
  // Stylelint の探索結果を表す
  const stylelint = discoverWebToolConfiguration(
    startDirectories,
    currentWorkingDirectory,
    defaults.stylelint || {},
  );
  // htmlhint の探索結果を表す
  const htmlhint = discoverWebToolConfiguration(
    startDirectories,
    currentWorkingDirectory,
    defaults.htmlhint || {},
  );
  // HTML-Validate の探索結果を表す
  const htmlValidate = discoverWebToolConfiguration(
    startDirectories,
    currentWorkingDirectory,
    defaults['html-validate'] || {},
  );

  return {
    eslint,
    oxlint,
    tsc,
    stylelint,
    htmlhint,
    'html-validate': htmlValidate,
  };
}

module.exports = {
  discoverWebConfigurations,
  discoverWorkspaceWebModules,
};