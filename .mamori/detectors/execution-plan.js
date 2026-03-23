'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

// SpotBugs の class ルート探索候補一覧を表す
const SPOTBUGS_CLASS_ROOT_CANDIDATES = [
  'target/classes',
  'build/classes/java/main',
];

// Web 系ファイル拡張子一覧を表す
const WEB_FILE_EXTENSIONS = {
  prettier: new Set(['.js', '.cjs', '.mjs', '.jsx', '.css', '.scss', '.sass', '.html', '.htm']),
  eslint: new Set(['.js', '.cjs', '.mjs', '.jsx', '.html', '.htm']),
  stylelint: new Set(['.css', '.scss', '.sass', '.html', '.htm']),
  htmlhint: new Set(['.html', '.htm']),
};

// ワークスペース探索時に除外するディレクトリ一覧を表す
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.mamori',
  'build',
  'dist',
  'node_modules',
  'out',
  'target',
]);

/**
 * ツール計画エントリを構築する。
 * @param {string} tool ツール名を表す。
 * @param {boolean} enabled 有効状態を表す。
 * @param {object=} additionalProperties 追加プロパティを表す。
 * @returns {{tool: string, enabled: boolean}} ツール計画エントリを返す。
 */
function buildToolEntry(tool, enabled, additionalProperties = {}) {
  return {
    tool,
    enabled,
    ...additionalProperties,
  };
}

/**
 * 軽量 Java チェック計画を返す。
 * @returns {Array<{tool: string, enabled: boolean}>} チェック計画一覧を返す。
 */
function buildLightweightJavaChecks() {
  return [
    buildToolEntry('checkstyle', true, { phase: 'check' }),
    buildToolEntry('pmd', true, { phase: 'check' }),
    buildToolEntry('semgrep', true, { phase: 'check' }),
  ];
}

/**
 * SpotBugs 用の class ルート一覧を探索する。
 * @param {string} moduleRoot モジュールルートを表す。
 * @returns {string[]} 見つかった class ルート一覧を返す。
 */
function resolveSpotbugsClassRoots(moduleRoot) {
  return SPOTBUGS_CLASS_ROOT_CANDIDATES
    .map((relativePath) => path.join(moduleRoot, relativePath))
    .filter((candidatePath) => {
      try {
        return fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * 実行モードとスコープの組み合わせキーを返す。
 * @param {string} mode 実行モードを表す。
 * @param {string} scope 実行スコープを表す。
 * @returns {string} 組み合わせキーを返す。
 */
function buildModeScopeKey(mode, scope) {
  return `${mode}:${scope}`;
}

/**
 * 対象拡張子に一致するファイルか判定する。
 * @param {string} filePath 対象ファイルパスを表す。
 * @param {Set<string>} extensions 許可拡張子一覧を表す。
 * @returns {boolean} 一致する場合は true を返す。
 */
function hasMatchingExtension(filePath, extensions) {
  return extensions.has(path.extname(filePath).toLowerCase());
}

/**
 * 指定ツールに一致する Web ファイル一覧を返す。
 * @param {string[]|undefined} files 対象ファイル一覧を表す。
 * @param {string} toolName ツール名を表す。
 * @returns {string[]} 一致したファイル一覧を返す。
 */
function filterWebFiles(files, toolName) {
  const extensions = WEB_FILE_EXTENSIONS[toolName];
  if (!extensions || !Array.isArray(files)) {
    return [];
  }

  return files.filter((filePath) => hasMatchingExtension(filePath, extensions));
}

/**
 * ディレクトリ配下に対象拡張子のファイルが存在するか判定する。
 * @param {string} directoryPath 探索対象ディレクトリを表す。
 * @param {Set<string>} extensions 対象拡張子一覧を表す。
 * @returns {boolean} 存在する場合は true を返す。
 */
function hasWorkspaceFiles(directoryPath, extensions) {
  return hasWorkspaceFilesExcluding(directoryPath, extensions, []);
}

/**
 * 他 module を除外しながらディレクトリ配下に対象拡張子のファイルが存在するか判定する。
 * @param {string} directoryPath 探索対象ディレクトリを表す。
 * @param {Set<string>} extensions 対象拡張子一覧を表す。
 * @param {string[]} excludedDirectories 除外ディレクトリ一覧を表す。
 * @returns {boolean} 存在する場合は true を返す。
 */
function hasWorkspaceFilesExcluding(directoryPath, extensions, excludedDirectories) {
  const pendingDirectories = [directoryPath];

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
        return true;
      }
    }
  }

  return false;
}

/**
 * 指定ディレクトリ配下にある子ディレクトリか判定する。
 * @param {string} parentDirectory 親ディレクトリを表す。
 * @param {string} candidateDirectory 判定対象ディレクトリを表す。
 * @returns {boolean} 子ディレクトリの場合は true を返す。
 */
function isNestedDirectory(parentDirectory, candidateDirectory) {
  const relativePath = path.relative(parentDirectory, candidateDirectory);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

/**
 * Web module ごとの除外ディレクトリ一覧を返す。
 * @param {string} moduleRoot moduleRoot を表す。
 * @param {string[]} allModuleRoots Web moduleRoot 一覧を表す。
 * @returns {string[]} 除外ディレクトリ一覧を返す。
 */
function resolveExcludedWebDirectories(moduleRoot, allModuleRoots) {
  return allModuleRoots.filter((candidateRoot) => isNestedDirectory(moduleRoot, candidateRoot));
}

/**
 * Web ツール向け実行可否エントリを構築する。
 * @param {string} toolName ツール名を表す。
 * @param {boolean} hasTargetFiles 対象ファイル有無を表す。
 * @param {boolean} enabled 設定解決により有効かを表す。
 * @returns {{tool: string, enabled: boolean, phase: string, status?: string}} ツール計画を返す。
 */
function buildWebCheckEntry(toolName, hasTargetFiles, enabled) {
  if (!hasTargetFiles) {
    return buildToolEntry(toolName, false, { phase: 'check', status: 'no-target-files' });
  }

  if (!enabled) {
    return buildToolEntry(toolName, false, { phase: 'check', status: 'config-not-detected' });
  }

  return buildToolEntry(toolName, true, { phase: 'check' });
}

/**
 * Web 専用 module の必要性を返す。
 * @param {{mode: string, scope: string, cwd: string, files?: string[], web?: object}} options 計画生成条件を表す。
 * @returns {boolean} 必要な場合は true を返す。
 */
function shouldIncludeWebModule(options) {
  if (Array.isArray(options.webModules) && options.webModules.length > 0) {
    if (options.scope !== 'workspace') {
      return false;
    }

    if (options.webModules.some((moduleResolution) => moduleResolution.moduleRoot === options.cwd)) {
      return false;
    }

    return hasWorkspaceFilesExcluding(
      options.cwd,
      WEB_FILE_EXTENSIONS.prettier,
      options.webModules.map((moduleResolution) => moduleResolution.moduleRoot),
    );
  }

  if (options.scope === 'file' || options.scope === 'staged') {
    return filterWebFiles(options.files, 'prettier').length > 0;
  }

  const web = options.web || {};
  if (web.eslint && web.eslint.enabled) {
    return true;
  }
  if (web.stylelint && web.stylelint.enabled) {
    return true;
  }
  if (web.htmlhint && web.htmlhint.enabled) {
    return true;
  }

  return hasWorkspaceFiles(options.cwd, WEB_FILE_EXTENSIONS.prettier);
}

/**
 * 複数パスの共通祖先ディレクトリを返す。
 * @param {string[]} filePaths 対象ファイル一覧を表す。
 * @returns {string|undefined} 共通祖先ディレクトリを返す。
 */
function resolveCommonAncestorDirectory(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return undefined;
  }

  const pathSegments = filePaths.map((filePath) => path.resolve(path.dirname(filePath)).split(path.sep));
  const sharedSegments = [];
  const minLength = Math.min(...pathSegments.map((segments) => segments.length));

  for (let index = 0; index < minLength; index += 1) {
    const segment = pathSegments[0][index];
    if (pathSegments.every((segments) => segments[index] === segment)) {
      sharedSegments.push(segment);
      continue;
    }
    break;
  }

  if (sharedSegments.length === 0) {
    return undefined;
  }

  return sharedSegments.join(path.sep) || path.sep;
}

/**
 * Web module のルートディレクトリを返す。
 * @param {{cwd: string, scope: string, files?: string[]}} options 計画生成条件を表す。
 * @returns {string} moduleRoot を返す。
 */
function resolveWebModuleRoot(options) {
  if (options.scope !== 'workspace') {
    const webFiles = filterWebFiles(options.files, 'prettier');
    const commonAncestorDirectory = resolveCommonAncestorDirectory(webFiles);
    if (commonAncestorDirectory) {
      return commonAncestorDirectory;
    }
  }

  return options.cwd;
}

/**
 * Web 専用 module の formatter 計画を返す。
 * @param {{scope: string, files?: string[]}} options 計画生成条件を表す。
 * @returns {Array<object>} formatter 計画一覧を返す。
 */
function buildWebFormatterPlan(options) {
  if (options.scope !== 'file' && options.scope !== 'staged') {
    return [];
  }

  const prettierFiles = filterWebFiles(options.files, 'prettier');
  return [
    buildToolEntry('prettier', prettierFiles.length > 0, {
      phase: 'formatter',
      status: prettierFiles.length > 0 ? undefined : 'no-target-files',
    }),
  ];
}

/**
 * Web 専用 module の checker 計画を返す。
 * @param {{mode: string, scope: string, cwd: string, files?: string[], web?: object}} options 計画生成条件を表す。
 * @returns {Array<object>} checker 計画一覧を返す。
 */
function buildWebChecks(options, webResolution, excludedDirectories = []) {
  const modeScopeKey = buildModeScopeKey(options.mode, options.scope);
  const supportsWebChecks = modeScopeKey === 'save:file'
    || modeScopeKey === 'precommit:staged'
    || modeScopeKey === 'prepush:workspace';

  if (!supportsWebChecks) {
    return [];
  }

  const hasEslintFiles = options.scope === 'workspace'
    ? hasWorkspaceFilesExcluding(options.cwd, WEB_FILE_EXTENSIONS.eslint, excludedDirectories)
    : filterWebFiles(options.files, 'eslint').length > 0;
  const hasStylelintFiles = options.scope === 'workspace'
    ? hasWorkspaceFilesExcluding(options.cwd, WEB_FILE_EXTENSIONS.stylelint, excludedDirectories)
    : filterWebFiles(options.files, 'stylelint').length > 0;
  const hasHtmlhintFiles = options.scope === 'workspace'
    ? hasWorkspaceFilesExcluding(options.cwd, WEB_FILE_EXTENSIONS.htmlhint, excludedDirectories)
    : filterWebFiles(options.files, 'htmlhint').length > 0;

  return [
    buildWebCheckEntry('eslint', hasEslintFiles, Boolean(webResolution && webResolution.eslint && webResolution.eslint.enabled)),
    buildWebCheckEntry('stylelint', hasStylelintFiles, Boolean(webResolution && webResolution.stylelint && webResolution.stylelint.enabled)),
    buildWebCheckEntry('htmlhint', hasHtmlhintFiles, Boolean(webResolution && webResolution.htmlhint && webResolution.htmlhint.enabled)),
  ];
}

/**
 * Web 専用 execution plan を構築する。
 * @param {{cwd: string, mode: string, scope: string, files?: string[], web?: object}} options 計画生成条件を表す。
 * @param {{moduleRoot?: string, web?: object}|undefined} webModule Web module 解決結果を表す。
 * @param {string[]} excludedDirectories 除外ディレクトリ一覧を表す。
 * @returns {{moduleRoot: string, buildSystem: string, checks: object[], formatters: object[], warnings: string[]}} execution plan を返す。
 */
function buildWebExecutionPlan(options, webModule, excludedDirectories = []) {
  const webResolution = webModule && webModule.web
    ? webModule.web
    : options.web;
  const moduleRoot = webModule && webModule.moduleRoot
    ? webModule.moduleRoot
    : resolveWebModuleRoot(options);

  return {
    moduleRoot,
    buildSystem: 'workspace',
    web: webResolution,
    excludedDirectories,
    checks: buildWebChecks(
      {
        ...options,
        cwd: moduleRoot,
      },
      webResolution,
      excludedDirectories,
    ),
    formatters: buildWebFormatterPlan(options),
    warnings: [],
  };
}

/**
 * モジュール単位の formatter 計画を返す。
 * @param {{spotless?: {configured?: boolean}}} moduleDefinition build-definition のモジュール定義を表す。
 * @returns {Array<{tool: string, enabled: boolean}>} formatter 計画一覧を返す。
 */
function buildFormatterPlan(moduleDefinition) {
  return [
    buildToolEntry('spotless', Boolean(moduleDefinition.spotless && moduleDefinition.spotless.configured), {
      phase: 'formatter',
    }),
  ];
}

/**
 * pre-push 向けのチェック計画を返す。
 * @param {{moduleRoot: string}} moduleDefinition build-definition のモジュール定義を表す。
 * @returns {{checks: Array<object>, warnings: string[]}} チェック計画と警告一覧を返す。
 */
function buildPrepushChecks(moduleDefinition) {
  const classRoots = resolveSpotbugsClassRoots(moduleDefinition.moduleRoot);
  const checks = [
    ...buildLightweightJavaChecks(),
    buildToolEntry('cpd', true, { phase: 'check' }),
  ];
  const warnings = [];

  if (classRoots.length > 0) {
    checks.push(buildToolEntry('spotbugs', true, { classRoots, phase: 'check' }));
  } else {
    checks.push(buildToolEntry('spotbugs', false, { status: 'skipped', classRoots: [], phase: 'check' }));
    warnings.push(
      'spotbugs was skipped because no compiled classes were found in target/classes or build/classes/java/main',
    );
  }

  return {
    checks,
    warnings,
  };
}

/**
 * モジュール単位の execution plan を構築する。
 * @param {{mode: string, scope: string, moduleDefinition: object}} options 計画生成条件を表す。
 * @returns {{moduleRoot: string, buildSystem: string, checks: object[], formatters: object[], warnings: string[]}} execution plan を返す。
 */
function buildModuleExecutionPlan(options) {
  const modeScopeKey = buildModeScopeKey(options.mode, options.scope);
  const moduleWarnings = Array.isArray(options.moduleDefinition.warnings)
    ? [...options.moduleDefinition.warnings]
    : [];
  let checks = [];

  if (modeScopeKey === 'prepush:workspace') {
    const prepushPlan = buildPrepushChecks(options.moduleDefinition);
    checks = prepushPlan.checks;
    moduleWarnings.push(...prepushPlan.warnings);
  } else {
    checks = buildLightweightJavaChecks();
    if (modeScopeKey === 'manual:workspace') {
      moduleWarnings.push(
        'manual mode currently reuses the lightweight Java check plan until heavy tools are implemented',
      );
    }
  }

  return {
    moduleRoot: options.moduleDefinition.moduleRoot,
    buildSystem: options.moduleDefinition.buildSystem,
    checks,
    formatters: buildFormatterPlan(options.moduleDefinition),
    warnings: moduleWarnings,
  };
}

/**
 * build-definition と mode/scope から execution plan を構築する。
 * @param {{mode: string, scope: string, buildDefinition?: {modules?: object[]}}} options 計画生成条件を表す。
 * @returns {{mode: string, scope: string, modules: object[]}} execution plan を返す。
 */
function buildExecutionPlan(options) {
  const modules = options.buildDefinition && Array.isArray(options.buildDefinition.modules)
    ? options.buildDefinition.modules
    : [];
  const executionModules = modules.map((moduleDefinition) => buildModuleExecutionPlan({
    mode: options.mode,
    scope: options.scope,
    moduleDefinition,
  }));

  if (options.scope === 'workspace' && Array.isArray(options.webModules) && options.webModules.length > 0) {
    const moduleRoots = options.webModules.map((moduleResolution) => moduleResolution.moduleRoot);
    executionModules.push(
      ...options.webModules.map((moduleResolution) => buildWebExecutionPlan(
        options,
        moduleResolution,
        resolveExcludedWebDirectories(moduleResolution.moduleRoot, moduleRoots),
      )),
    );
  }

  if (shouldIncludeWebModule(options)) {
    executionModules.push(buildWebExecutionPlan(
      options,
      undefined,
      options.scope === 'workspace' && Array.isArray(options.webModules)
        ? options.webModules.map((moduleResolution) => moduleResolution.moduleRoot)
        : [],
    ));
  }

  return {
    mode: options.mode,
    scope: options.scope,
    modules: executionModules,
  };
}

module.exports = {
  buildExecutionPlan,
};