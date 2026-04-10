#!/usr/bin/env node

'use strict';

// 子プロセス同期実行 API を表す
const { spawnSync } = require('child_process');
// プロセスの終了関数を表す
const { exit } = require('process');
// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');
// 設定解決器を表す
const { resolveRunConfiguration } = require('./detectors/config-resolver');
// Git hooks 管理器を表す
const { installGitHooks, uninstallGitHooks } = require('./hooks/install');
// ランナーを表す
const { runResolvedConfiguration } = require('./core/runner');
// SARIF 出力器を表す
const { buildCombinedSarif, writeSarifFile } = require('./core/sarif');
// ツール自動導入器を表す
const {
  clearManagedToolCaches,
  ensureMamoriGitExclude,
  ensureWorkspaceTooling,
} = require('./tools/provision');

// コマンドライン引数を取得する
const args = process.argv.slice(2);
// 実行されたサブコマンドを取得する
const command = args[0] || 'help';
// run サブコマンドに必須のオプション名一覧を表す
const REQUIRED_RUN_OPTIONS = ['mode', 'scope'];
// 有効な実行モード一覧を表す
const VALID_MODES = new Set(['save', 'precommit', 'prepush', 'manual']);
// 有効な実行スコープ一覧を表す
const VALID_SCOPES = new Set(['file', 'staged', 'workspace']);
// managed hook 実行を表す環境変数名を表す
const MANAGED_HOOK_ENV_NAME = 'MAMORI_MANAGED_HOOK';
// 実行モードごとの許可スコープ一覧を表す
const ALLOWED_SCOPE_BY_MODE = {
  save: new Set(['file']),
  precommit: new Set(['staged']),
  prepush: new Set(['workspace']),
  manual: new Set(['workspace']),
};
// run サブコマンドで受け付けるオプション名一覧を表す
const RUN_OPTION_NAMES = new Set([
  'mode',
  'scope',
  'files',
  'execute',
  'sarif-output',
  'semgrep-config',
  'semgrep-rule',
  'eslint-config',
  'oxlint-config',
  'tsconfig',
  'stylelint-config',
  'htmlhint-config',
  'html-validate-config',
]);

/**
 * CLIのヘルプを表示する。
 * @returns {void} 返り値はない。
 */
function printHelp() {
  // CLIの使い方を表示する
  process.stdout.write(
    [
      'Mamori Inspector CLI (minimal)',
      '',
      'Usage:',
      '  mamori.js run --mode <save|precommit|prepush|manual> --scope <file|staged|workspace> [--files <comma-separated>]',
      '    [--execute]',
      '    [--sarif-output <path>]',
      '    [--semgrep-config <path>] [--semgrep-rule <rule>[,<rule>...]]',
      '    [--eslint-config <path>] [--oxlint-config <path>] [--tsconfig <path>] [--stylelint-config <path>] [--htmlhint-config <path>] [--html-validate-config <path>]',
      '  mamori.js setup',
      '  mamori.js cache-clear',
      '  mamori.js hooks <install|uninstall>',
      '  mamori.js help',
      '',
      'Notes:',
      '  setup downloads managed tools into .mamori/tools and .mamori/node.',
      '  run automatically provisions missing managed tools before execution.',
      '',
    ].join('\n'),
  );
}

/**
 * コマンド実行時の警告一覧を標準出力へ書き出す。
 * @param {string} commandName 対象コマンド名を表す。
 * @param {string[]} warnings 警告一覧を表す。
 * @returns {void} 返り値はない。
 */
function printCommandWarnings(commandName, warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return;
  }

  process.stdout.write(`mamori: ${commandName} warnings=${warnings.join(' | ')}\n`);
}

/**
 * 複数値オプションを配列へ展開する。
 * @param {string[]|undefined} rawValues 元の値一覧を表す。
 * @returns {string[]} 展開済みの値一覧を返す。
 */
function expandValues(rawValues) {
  if (!Array.isArray(rawValues)) {
    return [];
  }

  return rawValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => Boolean(value));
}

/**
 * run サブコマンドの引数を解析する。
 * @param {string[]} rawArguments run サブコマンド以降の引数一覧を表す。
 * @returns {{mode?: string, scope?: string, files: string[], semgrepConfig?: string, semgrepRules: string[], eslintConfig?: string, oxlintConfig?: string, tsconfig?: string, stylelintConfig?: string, htmlhintConfig?: string, htmlValidateConfig?: string, unknownOptions: string[]}} 解析結果を返す。
 */
function parseRunArguments(rawArguments) {
  // 値を複数保持するオプションを表す
  const multiValueOptions = new Set(['files', 'semgrep-rule']);
  // 真偽値オプション一覧を表す
  const booleanOptions = new Set(['execute']);
  // 一時的な引数蓄積結果を表す
  const collectedOptions = {};
  // 未知のオプション一覧を表す
  const unknownOptions = [];
  // 値不足のオプション一覧を表す
  const missingValueOptions = [];

  for (let index = 0; index < rawArguments.length; index += 1) {
    // 現在処理中の引数を表す
    const currentArgument = rawArguments[index];
    if (!currentArgument.startsWith('--')) {
      continue;
    }

    // オプション名を表す
    const optionName = currentArgument.slice(2);
    if (!RUN_OPTION_NAMES.has(optionName)) {
      unknownOptions.push(currentArgument);
      continue;
    }

    if (booleanOptions.has(optionName)) {
      collectedOptions[optionName] = true;
      continue;
    }

    // オプション値を表す
    const optionValue = rawArguments[index + 1];
    if (!optionValue || optionValue.startsWith('--')) {
      missingValueOptions.push(currentArgument);
      continue;
    }

    if (multiValueOptions.has(optionName)) {
      collectedOptions[optionName] = collectedOptions[optionName] || [];
      collectedOptions[optionName].push(optionValue);
    } else {
      collectedOptions[optionName] = optionValue;
    }
    index += 1;
  }

  return {
    mode: typeof collectedOptions.mode === 'string' ? collectedOptions.mode : undefined,
    scope: typeof collectedOptions.scope === 'string' ? collectedOptions.scope : undefined,
    files: expandValues(collectedOptions.files),
    semgrepConfig: typeof collectedOptions['semgrep-config'] === 'string'
      ? collectedOptions['semgrep-config']
      : undefined,
    semgrepRules: expandValues(collectedOptions['semgrep-rule']),
    eslintConfig: typeof collectedOptions['eslint-config'] === 'string'
      ? collectedOptions['eslint-config']
      : undefined,
    oxlintConfig: typeof collectedOptions['oxlint-config'] === 'string'
      ? collectedOptions['oxlint-config']
      : undefined,
    tsconfig: typeof collectedOptions.tsconfig === 'string'
      ? collectedOptions.tsconfig
      : undefined,
    stylelintConfig: typeof collectedOptions['stylelint-config'] === 'string'
      ? collectedOptions['stylelint-config']
      : undefined,
    htmlhintConfig: typeof collectedOptions['htmlhint-config'] === 'string'
      ? collectedOptions['htmlhint-config']
      : undefined,
    htmlValidateConfig: typeof collectedOptions['html-validate-config'] === 'string'
      ? collectedOptions['html-validate-config']
      : undefined,
    sarifOutput: typeof collectedOptions['sarif-output'] === 'string'
      ? collectedOptions['sarif-output']
      : undefined,
    execute: collectedOptions.execute === true,
    missingValueOptions,
    unknownOptions,
  };
}

/**
 * run サブコマンド必須オプションの不足一覧を返す。
 * @param {{mode?: string, scope?: string}} parsedArguments 解析済み引数を表す。
 * @returns {string[]} 不足オプション一覧を返す。
 */
function findMissingRunOptions(parsedArguments) {
  return REQUIRED_RUN_OPTIONS.filter((optionName) => !parsedArguments[optionName]);
}

/**
 * run サブコマンドの不正条件一覧を返す。
 * @param {{mode?: string, scope?: string, files: string[], missingValueOptions: string[]}} parsedArguments 解析済み引数を表す。
 * @returns {string[]} 不正条件一覧を返す。
 */
function findInvalidRunConditions(parsedArguments) {
  // 不正条件一覧を表す
  const errors = [];

  if (parsedArguments.missingValueOptions.length > 0) {
    errors.push(`missing option values: ${parsedArguments.missingValueOptions.join(', ')}`);
  }

  if (parsedArguments.mode && !VALID_MODES.has(parsedArguments.mode)) {
    errors.push(`invalid mode: ${parsedArguments.mode}`);
  }

  if (parsedArguments.scope && !VALID_SCOPES.has(parsedArguments.scope)) {
    errors.push(`invalid scope: ${parsedArguments.scope}`);
  }

  if (
    parsedArguments.mode
    && parsedArguments.scope
    && VALID_MODES.has(parsedArguments.mode)
    && VALID_SCOPES.has(parsedArguments.scope)
    && !ALLOWED_SCOPE_BY_MODE[parsedArguments.mode].has(parsedArguments.scope)
  ) {
    errors.push(`unsupported mode/scope combination: ${parsedArguments.mode}/${parsedArguments.scope}`);
  }

  if (parsedArguments.scope === 'file' && parsedArguments.files.length === 0) {
    errors.push('scope=file requires --files');
  }

  return errors;
}

/**
 * 対象ファイル一覧の不正条件を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string[]} files 対象ファイル一覧を表す。
 * @returns {string[]} 不正条件一覧を返す。
 */
function findInvalidFiles(currentWorkingDirectory, files) {
  // 不正条件一覧を表す
  const errors = [];
  // 現在の作業ディレクトリの絶対パスを表す
  const resolvedWorkingDirectory = path.resolve(currentWorkingDirectory);

  for (const filePath of files) {
    // ワークスペース相対パス表現を表す
    const relativePath = path.relative(resolvedWorkingDirectory, filePath);
    if (!fs.existsSync(filePath)) {
      errors.push(`file not found: ${relativePath}`);
      continue;
    }

    if (
      relativePath === ''
      || relativePath.startsWith(`..${path.sep}`)
      || relativePath === '..'
      || path.isAbsolute(relativePath)
    ) {
      errors.push(`file is outside workspace: ${filePath}`);
    }
  }

  return errors;
}

/**
 * Git コマンドを同期実行する。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string[]} gitArguments Git 引数一覧を表す。
 * @returns {{status: number|null, stdout: string, stderr: string, error?: Error}} 実行結果を返す。
 */
function runGitCommand(currentWorkingDirectory, gitArguments) {
  const result = spawnSync('git', gitArguments, {
    cwd: currentWorkingDirectory,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

/**
 * Git コマンド失敗メッセージを人向けに整形する。
 * @param {{status: number|null, stdout: string, stderr: string, error?: Error}} result Git 実行結果を表す。
 * @returns {string} 整形済みメッセージを返す。
 */
function formatGitResolutionError(result) {
  const stderr = typeof result.stderr === 'string'
    ? result.stderr.trim()
    : '';
  const errorMessage = result.error instanceof Error
    ? result.error.message
    : '';
  const normalizedMessage = `${stderr} ${errorMessage}`.toLowerCase();

  if (
    normalizedMessage.includes('not recognized as an internal or external command')
    || normalizedMessage.includes('not found')
    || normalizedMessage.includes('enoent')
    || (
      result.status === 1
      && (stderr.includes("'git'") || stderr.includes('"git"'))
      && !normalizedMessage.includes('fatal:')
    )
  ) {
    return 'git CLI was not found in PATH; precommit/staged requires git to resolve staged files';
  }

  return stderr || errorMessage || 'failed to resolve staged files';
}

/**
 * pre-commit 用の staged ファイル一覧を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {{files?: string[], error?: string}} 解決結果を返す。
 */
function resolveStagedFiles(currentWorkingDirectory) {
  const result = runGitCommand(currentWorkingDirectory, [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMR',
  ]);

  if (result.error) {
    return {
      error: formatGitResolutionError(result),
    };
  }

  if (result.status !== 0) {
    return {
      error: formatGitResolutionError(result),
    };
  }

  return {
    files: result.stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => Boolean(value))
      .map((filePath) => path.resolve(currentWorkingDirectory, filePath)),
  };
}

/**
 * 実行対象ファイル一覧を解決する。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{mode?: string, scope?: string, files: string[]}} parsedArguments 解析済み引数を表す。
 * @returns {{files?: string[], error?: string}} 解決結果を返す。
 */
function resolveInputFiles(currentWorkingDirectory, parsedArguments) {
  if (parsedArguments.files.length > 0) {
    return {
      files: parsedArguments.files.map((filePath) => path.resolve(currentWorkingDirectory, filePath)),
    };
  }

  if (parsedArguments.mode === 'precommit' && parsedArguments.scope === 'staged') {
    return resolveStagedFiles(currentWorkingDirectory);
  }

  return {
    files: [],
  };
}

/**
 * 単一ツールの解決結果を文字列化する。
 * @param {string} toolName ツール名を表す。
 * @param {object} toolResolution 解決結果を表す。
 * @returns {string[]} 表示用の行一覧を返す。
 */
function formatToolSummary(toolName, toolResolution) {
  // 解決元を表す
  const source = toolResolution.source || 'unknown';
  // ビルド定義の補足メッセージを表す
  const buildDefinitionMessage = toolResolution.buildDefinition
    ? toolResolution.buildDefinition.message
    : 'n/a';
  // ツール有効状態を表す
  const status = toolResolution.enabled ? 'enabled' : 'disabled';
  // 表示用の基本行一覧を表す
  const lines = [`  - ${toolName}: ${status} (source=${source})`];

  if (toolResolution.configPath) {
    lines.push(`    config=${toolResolution.configPath}`);
  }
  if (toolResolution.path && !toolResolution.configPath) {
    lines.push(`    path=${toolResolution.path}`);
  }
  if (Array.isArray(toolResolution.rules) && toolResolution.rules.length > 0) {
    lines.push(`    rules=${toolResolution.rules.join(', ')}`);
  }
  if (toolResolution.packageJsonKey) {
    lines.push(`    packageJsonKey=${toolResolution.packageJsonKey}`);
  }
  if (toolResolution.locationType) {
    lines.push(`    locationType=${toolResolution.locationType}`);
  }
  lines.push(`    buildDefinition=${buildDefinitionMessage}`);

  return lines;
}

/**
 * build-definition の要約を文字列化する。
 * @param {{modules?: object[]}} buildDefinition 抽出結果を表す。
 * @returns {string[]} 表示用の行一覧を返す。
 */
function formatBuildDefinitionSummary(buildDefinition) {
  const modules = Array.isArray(buildDefinition.modules)
    ? buildDefinition.modules
    : [];

  if (modules.length === 0) {
    return ['mamori: build-definition-summary', '  - none'];
  }

  return [
    'mamori: build-definition-summary',
    ...modules.flatMap((moduleDefinition) => {
      const lines = [
        `  - ${moduleDefinition.buildSystem}: ${moduleDefinition.moduleRoot}`,
        `    buildFile=${moduleDefinition.buildFile}`,
        `    confidence=${moduleDefinition.confidence}`,
        `    checkstyle=${moduleDefinition.checkstyle.configured ? 'configured' : 'not-configured'}`,
      ];

      if (moduleDefinition.checkstyle.configLocation) {
        lines.push(`    checkstyleConfig=${moduleDefinition.checkstyle.configLocation}`);
      }

      lines.push(`    pmd=${moduleDefinition.pmd.configured ? 'configured' : 'not-configured'}`);
      if (Array.isArray(moduleDefinition.pmd.rulesets) && moduleDefinition.pmd.rulesets.length > 0) {
        lines.push(`    pmdRulesets=${moduleDefinition.pmd.rulesets.join(', ')}`);
      }

      lines.push(`    spotless=${moduleDefinition.spotless.configured ? 'configured' : 'not-configured'}`);

      if (moduleDefinition.spotbugs) {
        lines.push(`    spotbugs=${moduleDefinition.spotbugs.configured ? 'configured' : 'not-configured'}`);
        if (moduleDefinition.spotbugs.excludeFilter) {
          lines.push(`    spotbugsExcludeFilter=${moduleDefinition.spotbugs.excludeFilter}`);
        }
      }

      if (Array.isArray(moduleDefinition.warnings) && moduleDefinition.warnings.length > 0) {
        lines.push(`    warnings=${moduleDefinition.warnings.join(' | ')}`);
      }

      return lines;
    }),
  ];
}

/**
 * execution plan のツール一覧を文字列化する。
 * @param {object[]|undefined} toolEntries ツール一覧を表す。
 * @returns {string} 表示用の文字列を返す。
 */
function formatPlanTools(toolEntries) {
  if (!Array.isArray(toolEntries) || toolEntries.length === 0) {
    return 'none';
  }

  return toolEntries.map((toolEntry) => {
    const status = toolEntry.enabled ? 'enabled' : 'disabled';
    const segments = [`${toolEntry.tool}:${status}`];

    if (toolEntry.status) {
      segments.push(`status=${toolEntry.status}`);
    }
    if (Array.isArray(toolEntry.classRoots) && toolEntry.classRoots.length > 0) {
      segments.push(`classRoots=${toolEntry.classRoots.join(', ')}`);
    }

    return segments.join(' ');
  }).join(', ');
}

/**
 * execution plan を文字列化する。
 * @param {{modules?: object[]}} executionPlan 実行計画を表す。
 * @returns {string[]} 表示用の行一覧を返す。
 */
function formatExecutionPlanSummary(executionPlan) {
  const modules = Array.isArray(executionPlan.modules)
    ? executionPlan.modules
    : [];

  if (modules.length === 0) {
    return ['mamori: execution-plan', '  - none'];
  }

  return [
    'mamori: execution-plan',
    ...modules.flatMap((modulePlan) => {
      const lines = [
        `  - ${modulePlan.buildSystem}: ${modulePlan.moduleRoot}`,
        `    checks=${formatPlanTools(modulePlan.checks)}`,
        `    formatters=${formatPlanTools(modulePlan.formatters)}`,
      ];

      if (Array.isArray(modulePlan.warnings) && modulePlan.warnings.length > 0) {
        lines.push(`    warnings=${modulePlan.warnings.join(' | ')}`);
      }

      return lines;
    }),
  ];
}

/**
 * コマンド計画エントリを文字列化する。
 * @param {object[]|undefined} commands コマンド計画一覧を表す。
 * @returns {string} 表示用の文字列を返す。
 */
function formatCommandEntries(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return 'none';
  }

  return commands.map((commandEntry) => {
    if (!commandEntry.enabled) {
      return `${commandEntry.tool}:disabled reason=${commandEntry.reason || 'disabled'}`;
    }

    const renderedArgs = Array.isArray(commandEntry.args)
      ? commandEntry.args.join(' ')
      : '';
    return `${commandEntry.tool}:${commandEntry.command} ${renderedArgs}`.trim();
  }).join(', ');
}

/**
 * command plan を文字列化する。
 * @param {{modules?: object[]}} commandPlan コマンド計画を表す。
 * @returns {string[]} 表示用の行一覧を返す。
 */
function formatCommandPlanSummary(commandPlan) {
  const modules = Array.isArray(commandPlan.modules)
    ? commandPlan.modules
    : [];

  if (modules.length === 0) {
    return ['mamori: command-plan', '  - none'];
  }

  return [
    'mamori: command-plan',
    ...modules.flatMap((moduleCommandPlan) => {
      const lines = [
        `  - ${moduleCommandPlan.buildSystem}: ${moduleCommandPlan.moduleRoot}`,
        `    commands=${formatCommandEntries(moduleCommandPlan.commands)}`,
      ];

      if (Array.isArray(moduleCommandPlan.warnings) && moduleCommandPlan.warnings.length > 0) {
        lines.push(`    warnings=${moduleCommandPlan.warnings.join(' | ')}`);
      }

      return lines;
    }),
  ];
}

/**
 * 解決結果の要約を出力する。
 * @param {object} resolution 解決結果を表す。
 * @returns {void} 返り値はない。
 */
function printResolutionSummary(resolution) {
  // 対象ファイル表示用の文字列を表す
  const filesSummary = resolution.files.length > 0
    ? resolution.files.join(', ')
    : '(none)';
  // 表示用の行一覧を表す
  const lines = [
    `mamori: run (mode=${resolution.mode}, scope=${resolution.scope})`,
    `mamori: cwd=${resolution.cwd}`,
    `mamori: files=${filesSummary}`,
    `mamori: resolution-order=${resolution.resolutionOrder.join(' -> ')}`,
    'mamori: resolution-summary',
    ...formatToolSummary('semgrep', resolution.semgrep),
    ...formatToolSummary('eslint', resolution.web.eslint),
    ...formatToolSummary('oxlint', resolution.web.oxlint),
    ...formatToolSummary('tsc', resolution.web.tsc),
    ...formatToolSummary('stylelint', resolution.web.stylelint),
    ...formatToolSummary('htmlhint', resolution.web.htmlhint),
    ...formatToolSummary('html-validate', resolution.web['html-validate']),
    ...formatBuildDefinitionSummary(resolution.buildDefinition),
    ...formatExecutionPlanSummary(resolution.executionPlan),
    ...formatCommandPlanSummary(resolution.commandPlan),
  ];

  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * 実行結果の要約を出力する。
 * @param {{commandResults: object[], warnings: string[]}} executionResult 実行結果を表す。
 * @returns {void} 返り値はない。
 */
function printExecutionResult(executionResult) {
  const commandResults = Array.isArray(executionResult.commandResults)
    ? executionResult.commandResults
    : [];
  const executedCount = commandResults.filter((result) => result.status === 'ok').length;
  const failedCount = commandResults.filter((result) => result.status === 'failed' || result.status === 'error').length;
  const skippedCount = commandResults.filter((result) => result.status === 'skipped').length;
  const lines = [
    'mamori: execution-result',
    `  summary=executed:${executedCount} failed:${failedCount} skipped:${skippedCount}`,
    `  issues=${Array.isArray(executionResult.issues) ? executionResult.issues.length : 0}`,
    ...commandResults.map((result) => {
      if (result.status === 'ok' || result.status === 'failed') {
        return `  - ${result.tool}:${result.status} exitCode=${result.exitCode}`;
      }
      if (result.status === 'error') {
        return `  - ${result.tool}:error message=${result.message}`;
      }
      return `  - ${result.tool}:skipped reason=${result.reason}`;
    }),
  ];

  if (Array.isArray(executionResult.warnings) && executionResult.warnings.length > 0) {
    lines.push(`  warnings=${executionResult.warnings.join(' | ')}`);
  }

  if (Array.isArray(executionResult.issues) && executionResult.issues.length > 0) {
    for (const issue of executionResult.issues) {
      const location = issue.filePath
        ? `${issue.filePath}${issue.line ? `:${issue.line}` : ''}`
        : '(no-location)';
      lines.push(`  issue ${issue.tool}:${issue.severity} ${issue.message} @ ${location}`);
    }
  }

  if (executionResult.sarifOutputPath) {
    lines.push(`  sarif=${executionResult.sarifOutputPath}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * 既定の SARIF 出力先を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {string|undefined} explicitOutput 明示指定の出力先を表す。
 * @returns {string} SARIF 出力先を返す。
 */
function resolveSarifOutputPath(currentWorkingDirectory, explicitOutput) {
  if (explicitOutput) {
    return path.isAbsolute(explicitOutput)
      ? explicitOutput
      : path.resolve(currentWorkingDirectory, explicitOutput);
  }

  return path.resolve(currentWorkingDirectory, '.mamori', 'out', 'combined.sarif');
}

/**
 * pre-push 最新結果の出力先を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {string} 結果ファイルパスを返す。
 */
function resolvePrePushResultOutputPath(currentWorkingDirectory) {
  return path.resolve(currentWorkingDirectory, '.mamori', 'out', 'latest-prepush-result.json');
}

/**
 * pre-commit 最新結果の出力先を返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @returns {string} 結果ファイルパスを返す。
 */
function resolvePreCommitResultOutputPath(currentWorkingDirectory) {
  return path.resolve(currentWorkingDirectory, '.mamori', 'out', 'latest-precommit-result.json');
}

/**
 * pre-push 最新結果を best-effort で書き込む。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{exitCode: number, issues?: Array<unknown>, warnings?: string[]}} executionResult 実行結果を表す。
 * @param {string|undefined} sarifOutputPath SARIF 出力先を表す。
 * @returns {void} 返り値はない。
 */
function writeLatestPrePushResult(currentWorkingDirectory, executionResult, sarifOutputPath) {
  const prePushResultOutputPath = resolvePrePushResultOutputPath(currentWorkingDirectory);

  try {
    fs.mkdirSync(path.dirname(prePushResultOutputPath), { recursive: true });
    fs.writeFileSync(
      prePushResultOutputPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        mode: 'prepush',
        scope: 'workspace',
        exitCode: executionResult.exitCode,
        issueCount: Array.isArray(executionResult.issues) ? executionResult.issues.length : 0,
        warnings: Array.isArray(executionResult.warnings) ? executionResult.warnings : [],
        sarifOutputPath,
      }, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    process.stderr.write(
      `mamori: failed to write latest pre-push result: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * pre-commit 最新結果を best-effort で書き込む。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{exitCode: number, issues?: Array<unknown>, warnings?: string[]}} executionResult 実行結果を表す。
 * @param {string|undefined} sarifOutputPath SARIF 出力先を表す。
 * @returns {void} 返り値はない。
 */
function writeLatestPreCommitResult(currentWorkingDirectory, executionResult, sarifOutputPath) {
  const preCommitResultOutputPath = resolvePreCommitResultOutputPath(currentWorkingDirectory);

  try {
    fs.mkdirSync(path.dirname(preCommitResultOutputPath), { recursive: true });
    fs.writeFileSync(
      preCommitResultOutputPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        mode: 'precommit',
        scope: 'staged',
        exitCode: executionResult.exitCode,
        issueCount: Array.isArray(executionResult.issues) ? executionResult.issues.length : 0,
        warnings: Array.isArray(executionResult.warnings) ? executionResult.warnings : [],
        sarifOutputPath,
      }, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    process.stderr.write(
      `mamori: failed to write latest pre-commit result: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * managed hook として結果メタデータを扱う対象モード名を返す。
 * @param {{mode?: string, scope?: string, execute?: boolean}} parsedArguments run 引数を表す。
 * @returns {string|undefined} 対象モード名を返す。対象外の場合は undefined を返す。
 */
function resolveManagedHookMode(parsedArguments) {
  if (!parsedArguments.execute) {
    return undefined;
  }

  if (parsedArguments.mode === 'precommit' && parsedArguments.scope === 'staged') {
    return 'precommit';
  }

  if (parsedArguments.mode === 'prepush' && parsedArguments.scope === 'workspace') {
    return 'prepush';
  }

  return undefined;
}

/**
 * managed hook からの実行か判定する。
 * @param {{mode?: string, scope?: string, execute?: boolean}} parsedArguments run 引数を表す。
 * @returns {boolean} managed hook 実行の場合は true を返す。
 */
function isManagedHookExecution(parsedArguments) {
  const managedHookMode = resolveManagedHookMode(parsedArguments);
  if (!managedHookMode) {
    return false;
  }

  return process.env[MANAGED_HOOK_ENV_NAME] === managedHookMode;
}

/**
 * managed hook 用の最新結果メタデータを best-effort で更新する。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{mode?: string, scope?: string, execute?: boolean}} parsedArguments run 引数を表す。
 * @param {{exitCode: number, issues?: Array<unknown>, warnings?: string[]}} executionResult 実行結果を表す。
 * @param {string|undefined} sarifOutputPath SARIF 出力先を表す。
 * @returns {void} 返り値はない。
 */
function writeLatestManagedHookResult(
  currentWorkingDirectory,
  parsedArguments,
  executionResult,
  sarifOutputPath,
) {
  if (!isManagedHookExecution(parsedArguments)) {
    return;
  }

  if (parsedArguments.mode === 'precommit' && parsedArguments.scope === 'staged') {
    writeLatestPreCommitResult(currentWorkingDirectory, executionResult, sarifOutputPath);
    return;
  }

  if (parsedArguments.mode === 'prepush' && parsedArguments.scope === 'workspace') {
    writeLatestPrePushResult(currentWorkingDirectory, executionResult, sarifOutputPath);
  }
}

/**
 * 必要に応じて managed hook 用の結果メタデータを書き出し、本来の終了コードを返す。
 * @param {string} currentWorkingDirectory 現在の作業ディレクトリを表す。
 * @param {{mode?: string, scope?: string, execute?: boolean}} parsedArguments run 引数を表す。
 * @param {{exitCode: number, issues?: Array<unknown>, warnings?: string[]}} executionResult 実行結果を表す。
 * @param {string|undefined} sarifOutputPath SARIF 出力先を表す。
 * @returns {number} 実行の終了コードを返す。
 */
function finalizeManagedHookExitCode(
  currentWorkingDirectory,
  parsedArguments,
  executionResult,
  sarifOutputPath,
) {
  writeLatestManagedHookResult(
    currentWorkingDirectory,
    parsedArguments,
    executionResult,
    sarifOutputPath,
  );

  return executionResult.exitCode;
}

/**
 * 最小CLIの実行結果を返す。
 * @returns {number} 終了コードを返す。
 */
async function runMinimal() {
  // run サブコマンド専用の引数一覧を表す
  const runArguments = args.slice(1);
  // 解析済みの run 引数を表す
  const parsedArguments = parseRunArguments(runArguments);
  // 必須オプション不足一覧を表す
  const missingOptions = findMissingRunOptions(parsedArguments);
  // 不正条件一覧を表す
  const invalidConditions = findInvalidRunConditions(parsedArguments);

  if (parsedArguments.unknownOptions.length > 0) {
    const errorMessage = `unknown options: ${parsedArguments.unknownOptions.join(', ')}`;
    process.stderr.write(`mamori: ${errorMessage}\n`);
    return finalizeManagedHookExitCode(process.cwd(), parsedArguments, {
      exitCode: 2,
      warnings: [errorMessage],
    });
  }

  if (missingOptions.length > 0) {
    const errorMessage = `missing required options: ${missingOptions.join(', ')}`;
    process.stderr.write(`mamori: ${errorMessage}\n`);
    return finalizeManagedHookExitCode(process.cwd(), parsedArguments, {
      exitCode: 2,
      warnings: [errorMessage],
    });
  }

  if (invalidConditions.length > 0) {
    const errorMessage = `invalid run options: ${invalidConditions.join('; ')}`;
    process.stderr.write(`mamori: ${errorMessage}\n`);
    return finalizeManagedHookExitCode(process.cwd(), parsedArguments, {
      exitCode: 2,
      warnings: [errorMessage],
    });
  }

  // 解決済みの対象ファイル一覧を表す
  const resolvedInputFiles = resolveInputFiles(process.cwd(), parsedArguments);
  if (resolvedInputFiles.error) {
    const errorMessage = `failed to resolve input files: ${resolvedInputFiles.error}`;
    process.stderr.write(`mamori: ${errorMessage}\n`);
    return finalizeManagedHookExitCode(process.cwd(), parsedArguments, {
      exitCode: 2,
      warnings: [errorMessage],
    });
  }

  // 正規化済みの対象ファイル一覧を表す
  const normalizedFiles = Array.isArray(resolvedInputFiles.files)
    ? resolvedInputFiles.files
    : [];
  // 不正な対象ファイル一覧を表す
  const invalidFiles = findInvalidFiles(process.cwd(), normalizedFiles);

  if (invalidFiles.length > 0) {
    const errorMessage = `invalid files: ${invalidFiles.join('; ')}`;
    process.stderr.write(`mamori: ${errorMessage}\n`);
    return finalizeManagedHookExitCode(process.cwd(), parsedArguments, {
      exitCode: 2,
      warnings: [errorMessage],
    });
  }

  if (parsedArguments.mode === 'precommit' && parsedArguments.scope === 'staged' && normalizedFiles.length === 0) {
    process.stdout.write('mamori: no staged files were detected for precommit/staged.\n');
    return finalizeManagedHookExitCode(process.cwd(), parsedArguments, {
      exitCode: 0,
      warnings: [],
    });
  }

  if (parsedArguments.execute) {
    const gitExcludeResult = ensureMamoriGitExclude(process.cwd());
    printCommandWarnings('run', gitExcludeResult.warnings);
  }

  // CLI 向けの解決結果を表す
  const resolution = resolveRunConfiguration({
    cwd: process.cwd(),
    mode: parsedArguments.mode,
    scope: parsedArguments.scope,
    files: normalizedFiles,
    semgrepConfig: parsedArguments.semgrepConfig,
    semgrepRules: parsedArguments.semgrepRules,
    eslintConfig: parsedArguments.eslintConfig,
    oxlintConfig: parsedArguments.oxlintConfig,
    tsconfig: parsedArguments.tsconfig,
    stylelintConfig: parsedArguments.stylelintConfig,
    htmlhintConfig: parsedArguments.htmlhintConfig,
    htmlValidateConfig: parsedArguments.htmlValidateConfig,
  });

  printResolutionSummary(resolution);

  if (parsedArguments.execute) {
    const executionResult = await runResolvedConfiguration(resolution);
    const sarifOutputPath = resolveSarifOutputPath(process.cwd(), parsedArguments.sarifOutput);
    const sarifLog = buildCombinedSarif(Array.isArray(executionResult.issues) ? executionResult.issues : []);
    writeSarifFile(sarifLog, sarifOutputPath);
    executionResult.sarifOutputPath = sarifOutputPath;
    printExecutionResult(executionResult);
    return finalizeManagedHookExitCode(
      process.cwd(),
      parsedArguments,
      executionResult,
      sarifOutputPath,
    );
  }

  return 0;
}

/**
 * setup サブコマンドを実行する。
 * @returns {Promise<number>} 終了コードを返す。
 */
async function runSetupCommand() {
  const gitExcludeResult = ensureMamoriGitExclude(process.cwd());
  const results = await ensureWorkspaceTooling(process.cwd());
  process.stdout.write('mamori: setup completed\n');
  printCommandWarnings('setup', gitExcludeResult.warnings);
  process.stdout.write(
    `mamori: setup tools=${results.map((entry) => `${entry.tool}:${entry.location}`).join(' | ')}\n`,
  );
  return 0;
}

/**
 * cache-clear サブコマンドを実行する。
 * @returns {number} 終了コードを返す。
 */
function runCacheClearCommand() {
  const removedDirectories = clearManagedToolCaches(process.cwd());
  process.stdout.write('mamori: cache-clear completed\n');
  process.stdout.write(
    `mamori: cache-clear removed=${removedDirectories.length > 0 ? removedDirectories.join(', ') : '(none)'}\n`,
  );
  return 0;
}

/**
 * hooks サブコマンドを実行する。
 * @returns {number} 終了コードを返す。
 */
function runHooksCommand() {
  const action = args[1];

  if (action !== 'install' && action !== 'uninstall') {
    process.stderr.write('mamori: hooks requires <install|uninstall>\n');
    return 2;
  }

  const result = action === 'install'
    ? installGitHooks(process.cwd())
    : uninstallGitHooks(process.cwd());

  if (result.error) {
    process.stderr.write(`mamori: hooks ${action} failed: ${result.error}\n`);
    return 2;
  }

  const changedEntries = action === 'install'
    ? result.installed
    : result.removed;
  process.stdout.write(`mamori: hooks ${action} completed\n`);
  process.stdout.write(`mamori: hooks changed=${changedEntries.length > 0 ? changedEntries.join(', ') : '(none)'}\n`);

  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    process.stdout.write(`mamori: hooks warnings=${result.warnings.join(' | ')}\n`);
  }

  return 0;
}

switch (command) {
  case 'run':
    runMinimal()
      .then((code) => {
        exit(code);
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        exit(2);
      });
    break;
  case 'setup':
    runSetupCommand()
      .then((code) => {
        exit(code);
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        exit(2);
      });
    break;
  case 'cache-clear':
    exit(runCacheClearCommand());
    break;
  case 'hooks':
    exit(runHooksCommand());
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    printHelp();
    exit(0);
}
