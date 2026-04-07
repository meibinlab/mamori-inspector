'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

// コマンド計画を組み立てる対象ツール一覧を表す
const SUPPORTED_COMMAND_TOOLS = new Set([
  'checkstyle',
  'pmd',
  'semgrep',
  'spotless',
  'cpd',
  'spotbugs',
  'prettier',
  'eslint',
  'stylelint',
  'htmlhint',
]);

// ツールごとの対象拡張子一覧を表す
const TOOL_FILE_EXTENSIONS = {
  prettier: new Set(['.js', '.cjs', '.mjs', '.jsx', '.css', '.scss', '.sass', '.html', '.htm']),
  eslint: new Set(['.js', '.cjs', '.mjs', '.jsx', '.html', '.htm']),
  stylelint: new Set(['.css', '.scss', '.sass', '.html', '.htm']),
  htmlhint: new Set(['.html', '.htm']),
};

// ESLint で TypeScript を扱うときの追加拡張子一覧を表す
const TYPESCRIPT_ESLINT_EXTENSIONS = ['.ts', '.cts', '.mts', '.tsx'];

// ESLint formatter へ委譲する direct file 拡張子一覧を表す
const ESLINT_FORMATTER_FILE_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  ...TYPESCRIPT_ESLINT_EXTENSIONS,
]);

// ワークスペース探索時に除外するディレクトリ一覧を表す
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.mamori',
  '.vscode-test',
  '.vscode-test-web',
  'build',
  'dist',
  'node_modules',
  'out',
  'target',
]);

/**
 * 対象ファイルがモジュール配下か判定する。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {string} filePath 対象ファイルを表す。
 * @returns {boolean} モジュール配下なら true を返す。
 */
function isInsideModule(moduleRoot, filePath) {
  const relativePath = path.relative(moduleRoot, filePath);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

/**
 * モジュール配下の対象ファイル一覧を返す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {string[]} files 対象ファイル一覧を表す。
 * @returns {string[]} モジュール配下の対象ファイル一覧を返す。
 */
function resolveModuleFiles(moduleRoot, files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files.filter((filePath) => isInsideModule(moduleRoot, filePath));
}

/**
 * 対象拡張子に一致するか判定する。
 * @param {string} filePath 対象ファイルを表す。
 * @param {Set<string>|undefined} extensions 許可拡張子一覧を表す。
 * @returns {boolean} 一致する場合は true を返す。
 */
function hasMatchingExtension(filePath, extensions) {
  return Boolean(extensions) && extensions.has(path.extname(filePath).toLowerCase());
}

/**
 * HTML ファイルか判定する。
 * @param {string} filePath 対象ファイルを表す。
 * @returns {boolean} HTML ファイルなら true を返す。
 */
function isHtmlFile(filePath) {
  return hasMatchingExtension(filePath, TOOL_FILE_EXTENSIONS.htmlhint);
}

/**
 * ESLint で TypeScript を対象に含めるか判定する。
 * @param {{enabled?: boolean, source?: string}|undefined} eslintResolution ESLint 設定解決結果を表す。
 * @returns {boolean} TypeScript を対象に含める場合は true を返す。
 */
function shouldIncludeTypeScriptForEslint(eslintResolution) {
  return Boolean(
    eslintResolution
      && eslintResolution.enabled
      && eslintResolution.source
      && eslintResolution.source !== 'default',
  );
}

/**
 * プロジェクト ESLint 設定を利用できるか判定する。
 * @param {{enabled?: boolean, source?: string}|undefined} eslintResolution ESLint 設定解決結果を表す。
 * @returns {boolean} プロジェクト設定を利用できる場合は true を返す。
 */
function hasProjectEslintConfiguration(eslintResolution) {
  return shouldIncludeTypeScriptForEslint(eslintResolution);
}

/**
 * ESLint formatter へ委譲する direct file 一覧を返す。
 * @param {string[]|undefined} files 対象ファイル一覧を表す。
 * @param {{enabled?: boolean, source?: string}|undefined} eslintResolution ESLint 設定解決結果を表す。
 * @returns {string[]} ESLint formatter 対象一覧を返す。
 */
function filterEslintFormatterFiles(files, eslintResolution) {
  if (!hasProjectEslintConfiguration(eslintResolution) || !Array.isArray(files)) {
    return [];
  }

  return files.filter((filePath) => hasMatchingExtension(filePath, ESLINT_FORMATTER_FILE_EXTENSIONS));
}

/**
 * ツール別の実効拡張子一覧を返す。
 * @param {string} toolName ツール名を表す。
 * @param {{enabled?: boolean, source?: string}|undefined} toolResolution 設定解決結果を表す。
 * @returns {Set<string>|undefined} 実効拡張子一覧を返す。
 */
function resolveToolExtensions(toolName, toolResolution = undefined) {
  if (toolName !== 'eslint' || !shouldIncludeTypeScriptForEslint(toolResolution)) {
    return TOOL_FILE_EXTENSIONS[toolName];
  }

  return new Set([...TOOL_FILE_EXTENSIONS.eslint, ...TYPESCRIPT_ESLINT_EXTENSIONS]);
}

/**
 * ディレクトリ配下から対象拡張子のファイル一覧を収集する。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {Set<string>} extensions 対象拡張子一覧を表す。
 * @returns {string[]} 対象ファイル一覧を返す。
 */
function discoverWorkspaceFiles(moduleRoot, extensions, excludedDirectories = []) {
  const discoveredFiles = [];
  const pendingDirectories = [moduleRoot];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (
          !DEFAULT_IGNORED_DIRECTORIES.has(entry.name)
          && !excludedDirectories.includes(entryPath)
        ) {
          pendingDirectories.push(entryPath);
        }
        continue;
      }

      if (entry.isFile() && hasMatchingExtension(entryPath, extensions)) {
        discoveredFiles.push(entryPath);
      }
    }
  }

  return discoveredFiles;
}

/**
 * ツールごとの対象ファイル一覧を返す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {string[]} files 対象ファイル一覧を表す。
 * @param {string} toolName ツール名を表す。
 * @returns {string[]} 対象ファイル一覧を返す。
 */
function resolveToolFiles(moduleRoot, files, toolName, excludedDirectories = [], toolResolution = undefined) {
  const extensions = resolveToolExtensions(toolName, toolResolution);

  if (!extensions) {
    return resolveModuleFiles(moduleRoot, files);
  }

  const moduleFiles = resolveModuleFiles(moduleRoot, files);
  if (moduleFiles.length > 0) {
    return moduleFiles.filter((filePath) => hasMatchingExtension(filePath, extensions));
  }

  return discoverWorkspaceFiles(moduleRoot, extensions, excludedDirectories);
}

/**
 * Web ツールの設定引数一覧を返す。
 * @param {string} toolName ツール名を表す。
 * @param {{path?: string, locationType?: string}|undefined} toolResolution 設定解決結果を表す。
 * @returns {string[]} 設定引数一覧を返す。
 */
function buildWebConfigArguments(toolName, toolResolution) {
  if (!toolResolution || toolResolution.locationType !== 'file' || !toolResolution.path) {
    return [];
  }

  if (toolName === 'eslint' || toolName === 'stylelint' || toolName === 'htmlhint') {
    return ['--config', toolResolution.path];
  }

  return [];
}

/**
 * Web ツールの追加環境変数を返す。
 * @param {string} toolName ツール名を表す。
 * @param {{source?: string}|undefined} toolResolution 設定解決結果を表す。
 * @returns {NodeJS.ProcessEnv|undefined} 追加環境変数を返す。
 */
function buildWebCommandEnvironment(toolName, toolResolution) {
  if (toolName === 'eslint' && toolResolution && toolResolution.source === 'default') {
    return {
      ESLINT_USE_FLAT_CONFIG: 'false',
    };
  }

  return undefined;
}

/**
 * Web ツール設定ファイルの除外対象パス一覧を返す。
 * @param {{eslint?: object, stylelint?: object, htmlhint?: object}|undefined} webResolution Web 設定解決結果を表す。
 * @returns {string[]} 除外対象パス一覧を返す。
 */
function resolveExcludedWebConfigPaths(webResolution) {
  if (!webResolution) {
    return [];
  }

  return Object.values(webResolution)
    .map((toolResolution) => (toolResolution && toolResolution.path ? path.resolve(toolResolution.path) : ''))
    .filter((toolPath) => Boolean(toolPath));
}

/**
 * Web ツールのコマンド計画を返す。
 * @param {string} toolName ツール名を表す。
 * @param {object} moduleDefinition モジュール定義を表す。
 * @param {string[]} toolFiles 対象ファイル一覧を表す。
 * @param {{web?: object}} options 補助オプションを表す。
 * @returns {{tool: string, enabled: boolean, phase: string, command?: string, args?: string[], cwd?: string, reason?: string}|undefined} コマンド計画を返す。
 */
function buildWebCommandEntry(toolName, moduleDefinition, toolFiles, options) {
  const toolResolution = options.web && options.web[toolName]
    ? options.web[toolName]
    : undefined;
  const commandEnvironment = buildWebCommandEnvironment(toolName, toolResolution);
  const excludedConfigPaths = new Set(resolveExcludedWebConfigPaths(options.web));
  const filteredToolFiles = toolFiles.filter((filePath) => !excludedConfigPaths.has(path.resolve(filePath)));

  if (filteredToolFiles.length === 0) {
    return {
      tool: toolName,
      enabled: false,
      phase: toolName === 'prettier' ? 'formatter' : 'check',
      reason: 'no-target-files',
    };
  }

  if (toolName === 'prettier') {
    return {
      tool: 'prettier',
      enabled: true,
      phase: 'formatter',
      command: 'prettier',
      args: ['--write', ...filteredToolFiles],
      cwd: moduleDefinition.moduleRoot,
    };
  }

  const configArguments = buildWebConfigArguments(toolName, toolResolution);

  if (toolName === 'eslint' && options.phase === 'formatter') {
    return {
      tool: 'eslint',
      enabled: true,
      phase: 'formatter',
      command: 'eslint',
      args: [
        ...configArguments,
        '--fix',
        '--no-error-on-unmatched-pattern',
        '--no-warn-ignored',
        ...filteredToolFiles,
      ],
      cwd: moduleDefinition.moduleRoot,
      env: commandEnvironment,
      directFiles: filteredToolFiles,
      inlineHtmlFiles: [],
    };
  }

  if (toolName === 'eslint') {
    const directFiles = filteredToolFiles.filter((filePath) => !isHtmlFile(filePath));
    const inlineHtmlFiles = filteredToolFiles.filter((filePath) => isHtmlFile(filePath));

    return {
      tool: 'eslint',
      enabled: true,
      phase: 'check',
      command: 'eslint',
      args: [
        ...configArguments,
        '--format',
        'json',
        '--no-error-on-unmatched-pattern',
        '--no-warn-ignored',
        ...directFiles,
      ],
      cwd: moduleDefinition.moduleRoot,
      env: commandEnvironment,
      directFiles,
      inlineHtmlFiles,
    };
  }

  if (toolName === 'stylelint') {
    const directFiles = filteredToolFiles.filter((filePath) => !isHtmlFile(filePath));
    const inlineHtmlFiles = filteredToolFiles.filter((filePath) => isHtmlFile(filePath));

    return {
      tool: 'stylelint',
      enabled: true,
      phase: 'check',
      command: 'stylelint',
      args: [...configArguments, '--formatter', 'json', '--allow-empty-input', ...directFiles],
      cwd: moduleDefinition.moduleRoot,
      directFiles,
      inlineHtmlFiles,
    };
  }

  if (toolName === 'htmlhint') {
    return {
      tool: 'htmlhint',
      enabled: true,
      phase: 'check',
      command: 'htmlhint',
      args: [...configArguments, '--format', 'json', ...filteredToolFiles],
      cwd: moduleDefinition.moduleRoot,
    };
  }

  return undefined;
}

/**
 * Gradle 実行コマンド名を返す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @returns {string} 実行コマンド名を返す。
 */
function resolveGradleCommand(moduleRoot) {
  const windowsWrapperPath = path.join(moduleRoot, 'gradlew.bat');
  const unixWrapperPath = path.join(moduleRoot, 'gradlew');

  if (process.platform === 'win32' && fs.existsSync(windowsWrapperPath)) {
    return 'gradlew.bat';
  }
  if (process.platform !== 'win32' && fs.existsSync(unixWrapperPath)) {
    return './gradlew';
  }
  if (fs.existsSync(windowsWrapperPath)) {
    return 'gradlew.bat';
  }
  if (fs.existsSync(unixWrapperPath)) {
    return './gradlew';
  }
  return 'gradle';
}

/**
 * Maven 実行コマンド名を返す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @returns {string} 実行コマンド名を返す。
 */
function resolveMavenCommand(moduleRoot) {
  const windowsWrapperPath = path.join(moduleRoot, 'mvnw.cmd');
  const unixWrapperPath = path.join(moduleRoot, 'mvnw');

  if (process.platform === 'win32' && fs.existsSync(windowsWrapperPath)) {
    return 'mvnw.cmd';
  }
  if (process.platform !== 'win32' && fs.existsSync(unixWrapperPath)) {
    return './mvnw';
  }
  if (fs.existsSync(windowsWrapperPath)) {
    return 'mvnw.cmd';
  }
  if (fs.existsSync(unixWrapperPath)) {
    return './mvnw';
  }
  return 'mvn';
}

/**
 * Semgrep の引数一覧を返す。
 * @param {{configPath?: string, rules?: string[]}} semgrepResolution Semgrep の解決結果を表す。
 * @param {string} moduleRoot モジュールルートを表す。
 * @param {string[]} moduleFiles モジュール配下の対象ファイル一覧を表す。
 * @returns {string[]} 引数一覧を返す。
 */
function buildSemgrepArguments(semgrepResolution, moduleRoot, moduleFiles) {
  const args = ['scan', '--sarif'];

  if (semgrepResolution.configPath) {
    args.push('--config', semgrepResolution.configPath);
  } else if (Array.isArray(semgrepResolution.rules)) {
    for (const rule of semgrepResolution.rules) {
      args.push('--config', rule);
    }
  }

  if (moduleFiles.length > 0) {
    args.push(...moduleFiles);
  } else {
    args.push(moduleRoot);
  }

  return args;
}

/**
 * Maven 向けツール引数一覧を返す。
 * @param {string} toolName ツール名を表す。
 * @param {object} moduleDefinition モジュール定義を表す。
 * @returns {string[]|undefined} 引数一覧を返す。
 */
function buildMavenArguments(toolName, moduleDefinition) {
  if (toolName === 'checkstyle') {
    const args = ['-q', 'checkstyle:check'];
    if (moduleDefinition.checkstyle && moduleDefinition.checkstyle.configLocation) {
      args.push(`-Dcheckstyle.config.location=${moduleDefinition.checkstyle.configLocation}`);
    }
    return args;
  }

  if (toolName === 'pmd') {
    return ['-q', 'pmd:check'];
  }

  if (toolName === 'cpd') {
    return ['-q', 'pmd:cpd-check'];
  }

  if (toolName === 'spotbugs') {
    return ['-q', 'spotbugs:check'];
  }

  if (toolName === 'spotless') {
    return ['-q', 'spotless:apply'];
  }

  return undefined;
}

/**
 * Gradle 向けツール引数一覧を返す。
 * @param {string} toolName ツール名を表す。
 * @returns {string[]|undefined} 引数一覧を返す。
 */
function buildGradleArguments(toolName) {
  if (toolName === 'checkstyle') {
    return ['checkstyleMain'];
  }

  if (toolName === 'pmd') {
    return ['pmdMain'];
  }

  if (toolName === 'cpd') {
    return ['cpdCheck'];
  }

  if (toolName === 'spotbugs') {
    return ['spotbugsMain'];
  }

  if (toolName === 'spotless') {
    return ['spotlessApply'];
  }

  return undefined;
}

/**
 * ツールごとのコマンド計画を返す。
 * @param {{tool: string, enabled: boolean}} toolEntry ツール計画を表す。
 * @param {object} moduleDefinition モジュール定義を表す。
 * @param {{configPath?: string, rules?: string[]}} semgrepResolution Semgrep の解決結果を表す。
 * @param {string[]} moduleFiles モジュール配下の対象ファイル一覧を表す。
 * @returns {{tool: string, enabled: boolean, phase: string, command?: string, args?: string[], cwd?: string, reason?: string}|undefined} コマンド計画を返す。
 */
function buildCommandEntry(toolEntry, moduleDefinition, semgrepResolution, moduleFiles, options = {}) {
  if (!SUPPORTED_COMMAND_TOOLS.has(toolEntry.tool)) {
    return undefined;
  }

  if (!toolEntry.enabled) {
    return {
      tool: toolEntry.tool,
      enabled: false,
      phase: toolEntry.phase || 'check',
      reason: toolEntry.status || 'disabled-by-plan',
    };
  }

  if (toolEntry.tool === 'prettier'
    || toolEntry.tool === 'eslint'
    || toolEntry.tool === 'stylelint'
    || toolEntry.tool === 'htmlhint') {
    let toolFiles = moduleFiles;
    if (toolEntry.tool === 'eslint' && toolEntry.phase === 'formatter') {
      toolFiles = filterEslintFormatterFiles(
        moduleFiles,
        options.web && options.web.eslint,
      );
    }
    if (toolEntry.tool === 'prettier') {
      const eslintFormatterFileSet = new Set(filterEslintFormatterFiles(
        moduleFiles,
        options.web && options.web.eslint,
      ));
      toolFiles = moduleFiles.filter((filePath) => !eslintFormatterFileSet.has(filePath));
    }

    return buildWebCommandEntry(toolEntry.tool, moduleDefinition, toolFiles, {
      ...options,
      phase: toolEntry.phase,
    });
  }

  if (toolEntry.tool === 'semgrep') {
    return {
      tool: 'semgrep',
      enabled: true,
      phase: toolEntry.phase || 'check',
      command: 'semgrep',
      args: buildSemgrepArguments(semgrepResolution, moduleDefinition.moduleRoot, moduleFiles),
      cwd: moduleDefinition.moduleRoot,
    };
  }

  if (moduleDefinition.buildSystem === 'maven') {
    return {
      tool: toolEntry.tool,
      enabled: true,
      phase: toolEntry.phase || 'check',
      command: resolveMavenCommand(moduleDefinition.moduleRoot),
      args: buildMavenArguments(toolEntry.tool, moduleDefinition),
      cwd: moduleDefinition.moduleRoot,
    };
  }

  if (moduleDefinition.buildSystem === 'gradle') {
    return {
      tool: toolEntry.tool,
      enabled: true,
      phase: toolEntry.phase || 'check',
      command: resolveGradleCommand(moduleDefinition.moduleRoot),
      args: buildGradleArguments(toolEntry.tool),
      cwd: moduleDefinition.moduleRoot,
    };
  }

  return undefined;
}

/**
 * モジュール単位のコマンド計画を返す。
 * @param {object} modulePlan 実行計画のモジュール情報を表す。
 * @param {object} moduleDefinition build-definition のモジュール情報を表す。
 * @param {{configPath?: string, rules?: string[]}} semgrepResolution Semgrep の解決結果を表す。
 * @param {string[]} files 対象ファイル一覧を表す。
 * @returns {{moduleRoot: string, buildSystem: string, commands: object[], warnings: string[]}} コマンド計画を返す。
 */
function buildModuleCommandPlan(modulePlan, moduleDefinition, semgrepResolution, files, options = {}) {
  const toolEntries = [
    ...(Array.isArray(modulePlan.formatters) ? modulePlan.formatters : []),
    ...(Array.isArray(modulePlan.checks) ? modulePlan.checks : []),
  ];

  return {
    moduleRoot: modulePlan.moduleRoot,
    buildSystem: modulePlan.buildSystem,
    commands: toolEntries
      .map((toolEntry) => buildCommandEntry(
        toolEntry,
        moduleDefinition,
        semgrepResolution,
        resolveToolFiles(
          moduleDefinition.moduleRoot,
          files,
          toolEntry.tool,
          Array.isArray(modulePlan.excludedDirectories) ? modulePlan.excludedDirectories : [],
          modulePlan.web && modulePlan.web[toolEntry.tool] ? modulePlan.web[toolEntry.tool] : undefined,
        ),
        {
          ...options,
          web: modulePlan.web || options.web || {},
        },
      ))
      .filter((commandEntry) => Boolean(commandEntry)),
    warnings: Array.isArray(modulePlan.warnings) ? [...modulePlan.warnings] : [],
  };
}

/**
 * execution plan から command plan を構築する。
 * @param {{mode: string, scope: string, cwd?: string, files?: string[], buildDefinition?: {modules?: object[]}, executionPlan?: {modules?: object[]}, semgrep?: object, web?: object}} options 生成条件を表す。
 * @returns {{mode: string, scope: string, modules: object[]}} コマンド計画を返す。
 */
function buildCommandPlan(options) {
  const buildDefinitionModules = options.buildDefinition && Array.isArray(options.buildDefinition.modules)
    ? options.buildDefinition.modules
    : [];
  const executionModules = options.executionPlan && Array.isArray(options.executionPlan.modules)
    ? options.executionPlan.modules
    : [];

  return {
    mode: options.mode,
    scope: options.scope,
    modules: executionModules.map((modulePlan) => {
      const moduleDefinition = buildDefinitionModules.find(
        (candidate) => candidate.moduleRoot === modulePlan.moduleRoot,
      );

      return buildModuleCommandPlan(
        modulePlan,
        moduleDefinition || { moduleRoot: modulePlan.moduleRoot, buildSystem: modulePlan.buildSystem },
        options.semgrep || {},
        Array.isArray(options.files) ? options.files : [],
        {
          cwd: options.cwd,
          web: options.web || {},
        },
      );
    }),
  };
}

module.exports = {
  buildCommandPlan,
};