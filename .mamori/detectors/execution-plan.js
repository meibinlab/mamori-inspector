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

  return {
    mode: options.mode,
    scope: options.scope,
    modules: modules.map((moduleDefinition) => buildModuleExecutionPlan({
      mode: options.mode,
      scope: options.scope,
      moduleDefinition,
    })),
  };
}

module.exports = {
  buildExecutionPlan,
};