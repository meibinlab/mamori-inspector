'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');
// build-definition 抽出器を表す
const buildDefinitionDetector = require('./build-definition');
// command plan 生成器を表す
const commandPlanDetector = require('./command-plan');
// execution plan 生成器を表す
const executionPlanDetector = require('./execution-plan');
// Semgrep 検出器を表す
const semgrepDetector = require('./semgrep');
// Web 設定検出器を表す
const webConfigDetector = require('./web-config');

// 既定設定ファイルの絶対パスを表す
const DEFAULTS_PATH = path.join(__dirname, '..', 'config', 'defaults.json');
// 組み込み Web 設定ディレクトリの絶対パスを表す
const DEFAULT_CONFIG_DIRECTORY = path.dirname(DEFAULTS_PATH);

/**
 * 既定設定を読み込む。
 * @returns {{semgrep: object, web: object}} 既定設定を返す。
 */
function loadDefaults() {
  // 既定設定ファイルの文字列内容を表す
  const rawDefaults = fs.readFileSync(DEFAULTS_PATH, 'utf8');
  return JSON.parse(rawDefaults);
}

/**
 * 明示指定の設定パスを絶対パスへ正規化する。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string|undefined} configPath 設定パスを表す。
 * @returns {string|undefined} 正規化済みパスを返す。
 */
function normalizeExplicitPath(currentWorkingDirectory, configPath) {
  if (!configPath) {
    return undefined;
  }
  return path.isAbsolute(configPath)
    ? configPath
    : path.resolve(currentWorkingDirectory, configPath);
}

/**
 * 組み込み設定ファイルの絶対パスを返す。
 * @param {string|undefined} fallbackConfigPath 組み込み設定ファイルの相対パスを表す。
 * @returns {string|undefined} 組み込み設定ファイルの絶対パスを返す。
 */
function resolveBundledConfigPath(fallbackConfigPath) {
  if (typeof fallbackConfigPath !== 'string' || fallbackConfigPath.trim() === '') {
    return undefined;
  }

  return path.join(DEFAULT_CONFIG_DIRECTORY, fallbackConfigPath);
}

/**
 * 単一 Web ツールの組み込みデフォルト設定を返す。
 * @param {string} toolName ツール名を表す。
 * @param {{fallbackConfig?: string}|undefined} toolDefaults ツール既定値を表す。
 * @param {{modules?: object[]}} buildDefinitions build-definition 抽出結果を表す。
 * @returns {{enabled: boolean, source: string, locationType: string, path?: string, buildDefinition: object}} 解決結果を返す。
 */
function buildBundledWebToolConfiguration(toolName, toolDefaults, buildDefinitions) {
  // 組み込み設定ファイルの絶対パスを表す
  const bundledConfigPath = resolveBundledConfigPath(
    toolDefaults && typeof toolDefaults.fallbackConfig === 'string'
      ? toolDefaults.fallbackConfig
      : undefined,
  );

  if (!bundledConfigPath) {
    return {
      enabled: false,
      source: 'default',
      locationType: 'disabled',
      buildDefinition: buildToolDefinitionStatus(toolName, buildDefinitions),
    };
  }

  return {
    enabled: true,
    source: 'default',
    locationType: 'file',
    path: bundledConfigPath,
    buildDefinition: buildToolDefinitionStatus(toolName, buildDefinitions),
  };
}

/**
 * 文字列配列を空要素なしの一覧へ整形する。
 * @param {string[]|undefined} values 元の文字列配列を表す。
 * @returns {string[]} 整形済みの文字列配列を返す。
 */
function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => value.trim())
    .filter((value) => Boolean(value));
}

/**
 * ビルド定義段の適用状態を返す。
 * @param {string} toolName ツール名を表す。
 * @param {boolean} applicable ビルド定義が適用対象かどうかを表す。
 * @returns {{stage: string, applicable: boolean, tool: string, message: string}} 適用状態を返す。
 */
function buildDefinitionStatus(toolName, applicable) {
  return {
    stage: 'buildDefinition',
    applicable,
    tool: toolName,
    message: applicable
      ? 'build definition extraction will be implemented in a later step'
      : 'not applicable for this tool in the current minimal runner',
  };
}

/**
 * 抽出済み build-definition に基づくツール状態を返す。
 * @param {string} toolName ツール名を表す。
 * @param {{modules?: object[]}} buildDefinitions build-definition 抽出結果を表す。
 * @returns {{stage: string, applicable: boolean, tool: string, message: string}} 適用状態を返す。
 */
function buildToolDefinitionStatus(toolName, buildDefinitions) {
  const modules = Array.isArray(buildDefinitions.modules)
    ? buildDefinitions.modules
    : [];

  if (modules.length === 0) {
    return buildDefinitionStatus(toolName, false);
  }

  return {
    stage: 'buildDefinition',
    applicable: false,
    tool: toolName,
    message: `resolved ${modules.length} build module(s) for future Java tool integration`,
  };
}

/**
 * 探索開始ディレクトリ一覧を構築する。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string[]} files 対象ファイル一覧を表す。
 * @returns {string[]} 探索開始ディレクトリ一覧を返す。
 */
function buildStartDirectories(currentWorkingDirectory, files) {
  // 一意な探索開始ディレクトリ一覧を表す
  const directories = [];
  // 重複判定用のキー集合を表す
  const seenDirectories = new Set();

  for (const filePath of files) {
    // 対象ファイルの親ディレクトリを表す
    const directory = path.dirname(filePath);
    if (seenDirectories.has(directory)) {
      continue;
    }
    seenDirectories.add(directory);
    directories.push(directory);
  }

  if (!seenDirectories.has(currentWorkingDirectory)) {
    directories.push(currentWorkingDirectory);
  }

  return directories;
}

/**
 * Semgrep の設定解決結果を返す。
 * @param {string[]} startDirectories 探索開始ディレクトリ一覧を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{semgrepConfig?: string, semgrepRules?: string[]}} explicitOptions 明示指定オプションを表す。
 * @param {{defaultRule?: string, configFilenames?: string[]}} defaults Semgrep の既定値を表す。
 * @returns {{enabled: boolean, source: string, strategy: string, configPath?: string, rules?: string[], buildDefinition: object}} 解決結果を返す。
 */
function resolveSemgrepConfiguration(startDirectories, currentWorkingDirectory, explicitOptions, defaults) {
  // 明示指定の Semgrep 設定ファイルを表す
  const explicitConfigPath = normalizeExplicitPath(
    currentWorkingDirectory,
    explicitOptions.semgrepConfig,
  );
  // 明示指定の Semgrep ルール一覧を表す
  const explicitRules = normalizeList(explicitOptions.semgrepRules);
  // ビルド定義の適用状態を表す
  const buildDefinition = buildDefinitionStatus('semgrep', false);

  if (explicitConfigPath) {
    return {
      enabled: true,
      source: 'explicit',
      strategy: 'config',
      configPath: explicitConfigPath,
      rules: explicitRules,
      buildDefinition,
    };
  }

  if (explicitRules.length > 0) {
    return {
      enabled: true,
      source: 'explicit',
      strategy: 'rule',
      rules: explicitRules,
      buildDefinition,
    };
  }

  // 探索による Semgrep 解決結果を表す
  const discoveredConfiguration = semgrepDetector.discoverSemgrepConfiguration(
    startDirectories,
    currentWorkingDirectory,
    defaults,
  );
  if (discoveredConfiguration.enabled) {
    return {
      ...discoveredConfiguration,
      buildDefinition,
    };
  }

  return {
    ...semgrepDetector.buildDefaultSemgrepConfiguration(defaults),
    buildDefinition,
  };
}

/**
 * 単一 Web ツールの設定解決結果を返す。
 * @param {string} toolName ツール名を表す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string|undefined} explicitConfig 明示指定の設定パスを表す。
 * @param {object} discoveredConfiguration 探索結果を表す。
 * @returns {{enabled: boolean, source: string, locationType: string, path?: string, packageJsonKey?: string, buildDefinition: object}} 解決結果を返す。
 */
function resolveSingleWebToolConfiguration(
  toolName,
  currentWorkingDirectory,
  explicitConfig,
  discoveredConfiguration,
  buildDefinitions,
  toolDefaults,
) {
  // 明示指定の設定ファイルを表す
  const explicitConfigPath = normalizeExplicitPath(
    currentWorkingDirectory,
    explicitConfig,
  );
  // ビルド定義の適用状態を表す
  const buildDefinition = buildDefinitionStatus(toolName, false);

  if (explicitConfigPath) {
    return {
      enabled: true,
      source: 'explicit',
      locationType: 'file',
      path: explicitConfigPath,
      buildDefinition,
    };
  }

  if (discoveredConfiguration && discoveredConfiguration.enabled) {
    return {
      ...discoveredConfiguration,
      buildDefinition: buildToolDefinitionStatus(toolName, buildDefinitions),
    };
  }

  return buildBundledWebToolConfiguration(toolName, toolDefaults, buildDefinitions) || buildDefinition;
}

/**
 * Web 系ツールの解決結果一覧を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{eslintConfig?: string, oxlintConfig?: string, stylelintConfig?: string, htmlhintConfig?: string, htmlValidateConfig?: string}} options CLI オプションを表す。
 * @param {{eslint: object, oxlint: object, stylelint: object, htmlhint: object, 'html-validate': object}} discoveredWebConfigurations 探索結果を表す。
 * @param {{modules?: object[]}} buildDefinitions build-definition 抽出結果を表す。
 * @returns {{eslint: object, oxlint: object, stylelint: object, htmlhint: object, 'html-validate': object}} 解決結果を返す。
 */
function buildWebResolution(
  currentWorkingDirectory,
  options,
  discoveredWebConfigurations,
  buildDefinitions,
  webDefaults,
) {
  return {
    eslint: resolveSingleWebToolConfiguration(
      'eslint',
      currentWorkingDirectory,
      options.eslintConfig,
      discoveredWebConfigurations.eslint,
      buildDefinitions,
      webDefaults && webDefaults.eslint ? webDefaults.eslint : undefined,
    ),
    oxlint: resolveSingleWebToolConfiguration(
      'oxlint',
      currentWorkingDirectory,
      options.oxlintConfig,
      discoveredWebConfigurations.oxlint,
      buildDefinitions,
      webDefaults && webDefaults.oxlint ? webDefaults.oxlint : undefined,
    ),
    stylelint: resolveSingleWebToolConfiguration(
      'stylelint',
      currentWorkingDirectory,
      options.stylelintConfig,
      discoveredWebConfigurations.stylelint,
      buildDefinitions,
      webDefaults && webDefaults.stylelint ? webDefaults.stylelint : undefined,
    ),
    htmlhint: resolveSingleWebToolConfiguration(
      'htmlhint',
      currentWorkingDirectory,
      options.htmlhintConfig,
      discoveredWebConfigurations.htmlhint,
      buildDefinitions,
      webDefaults && webDefaults.htmlhint ? webDefaults.htmlhint : undefined,
    ),
    'html-validate': resolveSingleWebToolConfiguration(
      'html-validate',
      currentWorkingDirectory,
      options.htmlValidateConfig,
      discoveredWebConfigurations['html-validate'],
      buildDefinitions,
      webDefaults && webDefaults['html-validate'] ? webDefaults['html-validate'] : undefined,
    ),
  };
}

/**
 * workspace scope 向けの Web モジュール解決結果一覧を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{scope: string, eslintConfig?: string, oxlintConfig?: string, stylelintConfig?: string, htmlhintConfig?: string, htmlValidateConfig?: string}} options CLI オプションを表す。
 * @param {{web?: object}} defaults 既定設定を表す。
 * @param {{modules?: object[]}} buildDefinitions build-definition 抽出結果を表す。
 * @returns {Array<{moduleRoot: string, web: {eslint: object, oxlint: object, stylelint: object, htmlhint: object, 'html-validate': object}}>} モジュール解決結果を返す。
 */
function resolveWorkspaceWebModules(currentWorkingDirectory, options, defaults, buildDefinitions) {
  if (options.scope !== 'workspace') {
    return [];
  }

  if (
    options.eslintConfig
    || options.oxlintConfig
    || options.stylelintConfig
    || options.htmlhintConfig
    || options.htmlValidateConfig
  ) {
    return [{
      moduleRoot: currentWorkingDirectory,
      web: buildWebResolution(
        currentWorkingDirectory,
        options,
        {
          eslint: { enabled: false, source: 'default', locationType: 'disabled' },
          oxlint: { enabled: false, source: 'default', locationType: 'disabled' },
          stylelint: { enabled: false, source: 'default', locationType: 'disabled' },
          htmlhint: { enabled: false, source: 'default', locationType: 'disabled' },
          'html-validate': { enabled: false, source: 'default', locationType: 'disabled' },
        },
        buildDefinitions,
        defaults.web || {},
      ),
    }];
  }

  const discoveredWorkspaceModules = webConfigDetector.discoverWorkspaceWebModules(
    currentWorkingDirectory,
    defaults.web || {},
  );

  return discoveredWorkspaceModules.map((moduleResolution) => ({
    moduleRoot: moduleResolution.moduleRoot,
    web: buildWebResolution(
      moduleResolution.moduleRoot,
      options,
      moduleResolution.web,
      buildDefinitions,
      defaults.web || {},
    ),
  }));
}

/**
 * CLI 向けの設定解決結果を返す。
 * @param {{cwd?: string, mode: string, scope: string, files?: string[], semgrepConfig?: string, semgrepRules?: string[], eslintConfig?: string, oxlintConfig?: string, stylelintConfig?: string, htmlhintConfig?: string, htmlValidateConfig?: string}} options CLI オプションを表す。
 * @returns {{cwd: string, mode: string, scope: string, files: string[], resolutionOrder: string[], semgrep: object, web: object}} 解決結果を返す。
 */
function resolveRunConfiguration(options) {
  // 現在の作業ディレクトリを表す
  const currentWorkingDirectory = options.cwd || process.cwd();
  // 整形済みの対象ファイル一覧を表す
  const files = normalizeList(options.files).map((filePath) => path.resolve(filePath));
  // 探索開始ディレクトリ一覧を表す
  const startDirectories = buildStartDirectories(currentWorkingDirectory, files);
  // build-definition の抽出結果を表す
  const buildDefinitions = buildDefinitionDetector.resolveBuildDefinitions(
    startDirectories,
    currentWorkingDirectory,
    options.scope,
  );
  // 読み込んだ既定設定を表す
  const defaults = loadDefaults();
  // Web 設定の探索結果を表す
  const discoveredWebConfigurations = webConfigDetector.discoverWebConfigurations(
    startDirectories,
    currentWorkingDirectory,
    defaults.web || {},
  );
  const webResolution = buildWebResolution(
    currentWorkingDirectory,
    options,
    discoveredWebConfigurations,
    buildDefinitions,
    defaults.web || {},
  );
  const workspaceWebModules = resolveWorkspaceWebModules(
    currentWorkingDirectory,
    options,
    defaults,
    buildDefinitions,
  );
  // Semgrep の解決結果を表す
  const semgrepResolution = resolveSemgrepConfiguration(
    startDirectories,
    currentWorkingDirectory,
    options,
    defaults.semgrep || {},
  );
  // 実行計画を表す
  const executionPlan = executionPlanDetector.buildExecutionPlan({
    cwd: currentWorkingDirectory,
    mode: options.mode,
    scope: options.scope,
    files,
    buildDefinition: buildDefinitions,
    web: webResolution,
    webModules: workspaceWebModules,
  });

  return {
    cwd: currentWorkingDirectory,
    mode: options.mode,
    scope: options.scope,
    files,
    buildDefinition: buildDefinitions,
    executionPlan,
    commandPlan: commandPlanDetector.buildCommandPlan({
      cwd: currentWorkingDirectory,
      mode: options.mode,
      scope: options.scope,
      files,
      buildDefinition: buildDefinitions,
      executionPlan,
      semgrep: semgrepResolution,
      web: webResolution,
      webModules: workspaceWebModules,
    }),
    resolutionOrder: ['explicit', 'buildDefinition', 'discovery', 'default'],
    semgrep: semgrepResolution,
    web: webResolution,
  };
}

module.exports = {
  resolveRunConfiguration,
};