'use strict';

// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

// コマンド計画を組み立てる対象ツール一覧を表す
const SUPPORTED_COMMAND_TOOLS = new Set(['checkstyle', 'pmd', 'semgrep', 'spotless', 'cpd', 'spotbugs']);

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
function buildCommandEntry(toolEntry, moduleDefinition, semgrepResolution, moduleFiles) {
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
function buildModuleCommandPlan(modulePlan, moduleDefinition, semgrepResolution, files) {
  const moduleFiles = resolveModuleFiles(moduleDefinition.moduleRoot, files);
  const toolEntries = [
    ...(Array.isArray(modulePlan.formatters) ? modulePlan.formatters : []),
    ...(Array.isArray(modulePlan.checks) ? modulePlan.checks : []),
  ];

  return {
    moduleRoot: modulePlan.moduleRoot,
    buildSystem: modulePlan.buildSystem,
    commands: toolEntries
      .map((toolEntry) => buildCommandEntry(toolEntry, moduleDefinition, semgrepResolution, moduleFiles))
      .filter((commandEntry) => Boolean(commandEntry)),
    warnings: Array.isArray(modulePlan.warnings) ? [...modulePlan.warnings] : [],
  };
}

/**
 * execution plan から command plan を構築する。
 * @param {{mode: string, scope: string, files?: string[], buildDefinition?: {modules?: object[]}, executionPlan?: {modules?: object[]}, semgrep?: object}} options 生成条件を表す。
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
      );
    }),
  };
}

module.exports = {
  buildCommandPlan,
};