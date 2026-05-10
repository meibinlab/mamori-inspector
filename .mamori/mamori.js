#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const { exit } = require('process');
const fs = require('fs');
const path = require('path');
const { resolveRunConfiguration } = require('./detectors/config-resolver');
const { installGitHooks, uninstallGitHooks } = require('./hooks/install');
const { runResolvedConfiguration } = require('./core/runner');
const { buildCombinedSarif, writeSarifFile } = require('./core/sarif');
const {
  clearManagedToolCaches,
  ensureMamoriGitExclude,
  ensureWorkspaceTooling,
} = require('./tools/provision');

const args = process.argv.slice(2);
const command = args[0] || 'help';
const REQUIRED_RUN_OPTIONS = ['mode', 'scope'];
const VALID_MODES = new Set(['save', 'precommit', 'prepush', 'manual']);
const VALID_SCOPES = new Set(['file', 'staged', 'workspace']);
const MANAGED_HOOK_ENV_NAME = 'MAMORI_MANAGED_HOOK';
const ALLOWED_SCOPE_BY_MODE = {
  save: new Set(['file']),
  precommit: new Set(['staged']),
  prepush: new Set(['workspace']),
  manual: new Set(['workspace']),
};
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
  'doiuse-config',
  'knip-config',
  'stylelint-config',
  'htmlhint-config',
  'html-validate-config',
]);

function printHelp() {
  process.stdout.write(
    [
      'Mamori Inspector CLI (minimal)',
      '',
      'Usage:',
      '  mamori.js run --mode <save|precommit|prepush|manual> --scope <file|staged|workspace> [--files <comma-separated>]',
      '    [--execute]',
      '    [--sarif-output <path>]',
      '    [--semgrep-config <path>] [--semgrep-rule <rule>[,<rule>...]]',
      '    [--eslint-config <path>] [--oxlint-config <path>] [--tsconfig <path>] [--doiuse-config <path>] [--knip-config <path>] [--stylelint-config <path>] [--htmlhint-config <path>] [--html-validate-config <path>]',
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

function printCommandWarnings(commandName, warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return;
  }

  process.stdout.write(`mamori: ${commandName} warnings=${warnings.join(' | ')}\n`);
}

function expandValues(rawValues) {
  if (!Array.isArray(rawValues)) {
    return [];
  }

  return rawValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => Boolean(value));
}

function parseRunArguments(rawArguments) {
  const multiValueOptions = new Set(['files', 'semgrep-rule']);
  const booleanOptions = new Set(['execute']);
  const collectedOptions = {};
  const unknownOptions = [];
  const missingValueOptions = [];

  for (let index = 0; index < rawArguments.length; index += 1) {
    const currentArgument = rawArguments[index];
    if (!currentArgument.startsWith('--')) {
      continue;
    }

    const optionName = currentArgument.slice(2);
    if (!RUN_OPTION_NAMES.has(optionName)) {
      unknownOptions.push(currentArgument);
      continue;
    }

    if (booleanOptions.has(optionName)) {
      collectedOptions[optionName] = true;
      continue;
    }

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
    doiuseConfig: typeof collectedOptions['doiuse-config'] === 'string'
      ? collectedOptions['doiuse-config']
      : undefined,
    knipConfig: typeof collectedOptions['knip-config'] === 'string'
      ? collectedOptions['knip-config']
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

function findMissingRunOptions(parsedArguments) {
  return REQUIRED_RUN_OPTIONS.filter((optionName) => !parsedArguments[optionName]);
}

function findInvalidRunConditions(parsedArguments) {
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

function findInvalidFiles(currentWorkingDirectory, files) {
  const errors = [];
  const resolvedWorkingDirectory = path.resolve(currentWorkingDirectory);

  for (const filePath of files) {
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

function runGitCommand(currentWorkingDirectory, gitArguments) {
  let gitCommand = 'git';
  const commandArgs = gitArguments;
  const spawnOptions = {
    cwd: currentWorkingDirectory,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  };

  if (process.platform === 'win32') {
    const env = process.env;
    const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    const searchDirs = [
      currentWorkingDirectory,
      ...String(env.PATH || '').split(path.delimiter).filter(Boolean),
    ];

    for (const dir of searchDirs) {
      let resolved;
      for (const ext of extensions) {
        const candidate = path.join(dir, `git${ext}`);
        if (fs.existsSync(candidate)) {
          resolved = candidate;
          break;
        }
        const lowerCandidate = path.join(dir, `git${ext.toLowerCase()}`);
        if (fs.existsSync(lowerCandidate)) {
          resolved = lowerCandidate;
          break;
        }
      }
      if (resolved) {
        gitCommand = resolved;
        break;
      }
    }

    const ext = path.extname(gitCommand).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      const quoteArg = (arg) => `"${String(arg).replace(/"/g, '""')}"`;
      const quoteIfNeeded = (arg) => {
        const str = String(arg);
        return /[ \t\n\v"&|<>^%!]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const commandLine = [quoteArg(gitCommand), ...gitArguments.map(quoteIfNeeded)].join(' ');
      const result = spawnSync(
        env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', `"${commandLine}"`],
        { ...spawnOptions, windowsVerbatimArguments: true },
      );
      return {
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error,
      };
    }
  }

  const result = spawnSync(gitCommand, commandArgs, spawnOptions);
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

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

function formatToolSummary(toolName, toolResolution) {
  const source = toolResolution.source || 'unknown';
  const buildDefinitionMessage = toolResolution.buildDefinition
    ? toolResolution.buildDefinition.message
    : 'n/a';
  const status = toolResolution.enabled ? 'enabled' : 'disabled';
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

function printResolutionSummary(resolution) {
  const filesSummary = resolution.files.length > 0
    ? resolution.files.join(', ')
    : '(none)';
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
    ...formatToolSummary('doiuse', resolution.web.doiuse),
    ...formatToolSummary('knip', resolution.web.knip),
    ...formatToolSummary('stylelint', resolution.web.stylelint),
    ...formatToolSummary('htmlhint', resolution.web.htmlhint),
    ...formatToolSummary('html-validate', resolution.web['html-validate']),
    ...formatBuildDefinitionSummary(resolution.buildDefinition),
    ...formatExecutionPlanSummary(resolution.executionPlan),
    ...formatCommandPlanSummary(resolution.commandPlan),
  ];

  process.stdout.write(`${lines.join('\n')}\n`);
}

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

function resolveSarifOutputPath(currentWorkingDirectory, explicitOutput) {
  if (explicitOutput) {
    return path.isAbsolute(explicitOutput)
      ? explicitOutput
      : path.resolve(currentWorkingDirectory, explicitOutput);
  }

  return path.resolve(currentWorkingDirectory, '.mamori', 'out', 'combined.sarif');
}

function resolvePrePushResultOutputPath(currentWorkingDirectory) {
  return path.resolve(currentWorkingDirectory, '.mamori', 'out', 'latest-prepush-result.json');
}

function resolvePreCommitResultOutputPath(currentWorkingDirectory) {
  return path.resolve(currentWorkingDirectory, '.mamori', 'out', 'latest-precommit-result.json');
}

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

function isManagedHookExecution(parsedArguments) {
  const managedHookMode = resolveManagedHookMode(parsedArguments);
  if (!managedHookMode) {
    return false;
  }

  return process.env[MANAGED_HOOK_ENV_NAME] === managedHookMode;
}

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

async function runMinimal() {
  const runArguments = args.slice(1);
  const parsedArguments = parseRunArguments(runArguments);
  const missingOptions = findMissingRunOptions(parsedArguments);
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

  const resolvedInputFiles = resolveInputFiles(process.cwd(), parsedArguments);
  if (resolvedInputFiles.error) {
    const errorMessage = `failed to resolve input files: ${resolvedInputFiles.error}`;
    process.stderr.write(`mamori: ${errorMessage}\n`);
    return finalizeManagedHookExitCode(process.cwd(), parsedArguments, {
      exitCode: 2,
      warnings: [errorMessage],
    });
  }

  const normalizedFiles = Array.isArray(resolvedInputFiles.files)
    ? resolvedInputFiles.files
    : [];
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
    doiuseConfig: parsedArguments.doiuseConfig,
    knipConfig: parsedArguments.knipConfig,
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

async function runSetupCommand() {
  const gitExcludeResult = ensureMamoriGitExclude(process.cwd());
  const results = await ensureWorkspaceTooling(process.cwd(), process.env, {
    onToolStart: (toolName) => {
      process.stdout.write(`mamori: setup installing=${toolName}\n`);
    },
  });
  process.stdout.write('mamori: setup completed\n');
  printCommandWarnings('setup', gitExcludeResult.warnings);
  process.stdout.write(
    `mamori: setup tools=${results.map((entry) => `${entry.tool}:${entry.location}`).join(' | ')}\n`,
  );
  return 0;
}

function runCacheClearCommand() {
  const removedDirectories = clearManagedToolCaches(process.cwd());
  process.stdout.write('mamori: cache-clear completed\n');
  process.stdout.write(
    `mamori: cache-clear removed=${removedDirectories.length > 0 ? removedDirectories.join(', ') : '(none)'}\n`,
  );
  return 0;
}

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
