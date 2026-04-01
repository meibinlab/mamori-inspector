// 断言ユーティリティを表す
import * as assert from 'assert';
// 子プロセス実行 API を表す
import { spawnSync } from 'child_process';
// ファイルシステム API を表す
import * as fs from 'fs';
// OS 固有 API を表す
import * as os from 'os';
// パス操作 API を表す
import * as path from 'path';
// file URL 変換 API を表す
import { pathToFileURL } from 'url';

/**
 * Mamori CLI の実行結果を表す。
 */
interface MamoriCliResult {
  /** 実行時の終了コードを表す。 */
  status: number | null;
  /** 標準出力を表す。 */
  stdout: string;
  /** 標準エラー出力を表す。 */
  stderr: string;
}

/**
 * CLI 実行オプションを表す。
 */
interface MamoriCliOptions {
  /** 実行環境変数を表す。 */
  env?: NodeJS.ProcessEnv;
}

/**
 * テスト用一時ディレクトリを作成する。
 * @returns 作成した一時ディレクトリの絶対パスを返す。
 */
function createTemporaryDirectory(): string {
  // 一時ディレクトリの接頭辞を表す
  const prefix = path.join(os.tmpdir(), 'mamori-cli-');
  return fs.mkdtempSync(prefix);
}

/**
 * Mamori CLI を実行する。
 * @param workingDirectory 実行時の作業ディレクトリを表す。
 * @param argumentsList コマンド引数一覧を表す。
 * @returns 実行結果を返す。
 */
function runMamoriCli(
  workingDirectory: string,
  argumentsList: string[],
  options: MamoriCliOptions = {},
): MamoriCliResult {
  // コンパイル後のテストファイルから見たリポジトリルートを表す
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  // CLI スクリプトの絶対パスを表す
  const cliScriptPath = path.join(repositoryRoot, '.mamori', 'mamori.js');
  // 子プロセス実行結果を表す
  const result = spawnSync(process.execPath, [cliScriptPath, ...argumentsList], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: options.env,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * テスト用のコマンドラッパーディレクトリを作成する。
 * @param workingDirectory 作業ディレクトリを表す。
 * @returns ラッパーディレクトリの絶対パスを返す。
 */
function createCommandBinDirectory(workingDirectory: string): string {
  const binDirectory = path.join(workingDirectory, 'bin');
  fs.mkdirSync(binDirectory, { recursive: true });
  return binDirectory;
}

/**
 * テスト用の node_modules/.bin ディレクトリを作成する。
 * @param workingDirectory 作業ディレクトリを表す。
 * @returns ラッパーディレクトリの絶対パスを返す。
 */
function createNodeModulesBinDirectory(workingDirectory: string): string {
  const binDirectory = path.join(workingDirectory, 'node_modules', '.bin');
  fs.mkdirSync(binDirectory, { recursive: true });
  return binDirectory;
}

/**
 * テスト用 PATH を構築する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @returns PATH 文字列を返す。
 */
function buildTestPath(binDirectory: string): string {
  return `${binDirectory}${path.delimiter}${process.env.PATH || ''}`;
}

/**
 * テスト用の Windows コマンドラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param commandName コマンド名を表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeCommandWrapper(binDirectory: string, commandName: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, `${commandName}.cmd`)
    : path.join(binDirectory, commandName);

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\necho %*>>"${outputPath}"\r\nexit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nprintf '%s\n' "$*" >> "${outputPath}"\nexit 0\n`,
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * ローカル配布物ディレクトリを作成する。
 * @param workingDirectory 作業ディレクトリを表す。
 * @param directoryName 配布物ディレクトリ名を表す。
 * @param commandName 実行コマンド名を表す。
 * @param outputFileName 実行ログファイル名を表す。
 * @returns 配布物ディレクトリの絶対パスを返す。
 */
function createManagedToolSourceDirectory(
  workingDirectory: string,
  directoryName: string,
  commandName: string,
  outputFileName: string,
): string {
  const distributionDirectory = path.join(workingDirectory, 'tool-sources', directoryName);
  const binDirectory = path.join(distributionDirectory, 'bin');
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, `${commandName}.cmd`)
    : path.join(binDirectory, commandName);

  fs.mkdirSync(binDirectory, { recursive: true });

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        'set SCRIPT_DIR=%~dp0',
        `echo %*>>"%SCRIPT_DIR%${outputFileName}"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return distributionDirectory;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)',
      `printf '%s\n' "$*" >> "$SCRIPT_DIR/${outputFileName}"`,
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
  return distributionDirectory;
}

/**
 * パスを file URL へ変換する。
 * @param filePath 対象パスを表す。
 * @returns file URL 文字列を返す。
 */
function toFileUrl(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

/**
 * テスト用の npm ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeNpmInstallWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const helperScriptPath = path.join(binDirectory, 'npm-install-wrapper.js');
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'npm.cmd')
    : path.join(binDirectory, 'npm');

  fs.writeFileSync(
    helperScriptPath,
    [
      'const fs = require("fs");',
      'const path = require("path");',
      `const outputPath = ${JSON.stringify(outputPath)};`,
      'const args = process.argv.slice(2);',
      'fs.appendFileSync(outputPath, `${args.join(" ")}\\n`, "utf8");',
      'const prefixIndex = args.indexOf("--prefix");',
      'if (prefixIndex < 0 || !args[prefixIndex + 1]) {',
      '  process.stderr.write("missing --prefix");',
      '  process.exit(2);',
      '}',
      'const prefixPath = args[prefixIndex + 1];',
      'const nodeBinDirectory = path.join(prefixPath, "node_modules", ".bin");',
      'fs.mkdirSync(nodeBinDirectory, { recursive: true });',
      'for (const argument of args) {',
      '  if (argument === "install" || argument.startsWith("-")) {',
      '    continue;',
      '  }',
      '  if (argument === prefixPath) {',
      '    continue;',
      '  }',
      '  const packageName = argument.split("@", 1)[0];',
      '  const executableName = process.platform === "win32" ? `${packageName}.cmd` : packageName;',
      '  const executablePath = path.join(nodeBinDirectory, executableName);',
      '  const packageLogPath = path.join(prefixPath, `${packageName}.log`);',
      '  if (process.platform === "win32") {',
      '    fs.writeFileSync(executablePath, `@echo off\\r\\necho %*>>"${packageLogPath}"\\r\\nexit /b 0\\r\\n`, "utf8");',
      '  } else {',
      '    fs.writeFileSync(executablePath, `#!/bin/sh\\nprintf \'%s\\n\' "$*" >> "${packageLogPath}"\\nexit 0\\n`, "utf8");',
      '    fs.chmodSync(executablePath, 0o755);',
      '  }',
      '}',
      'process.exit(0);',
      '',
    ].join('\n'),
    'utf8',
  );

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\nnode "${helperScriptPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nnode '${helperScriptPath}' "$@"\n`,
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Web ツール向けコマンドラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param commandName コマンド名を表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param options ラッパー動作オプションを表す。
 * @returns 返り値はない。
 */
function writeWebCommandWrapper(
  binDirectory: string,
  commandName: string,
  outputFileName: string,
  options: {
    formattedFilePath?: string;
    loggedEnvironmentKeys?: string[];
    stdout?: string;
    exitCode?: number;
  } = {},
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, `${commandName}.cmd`)
    : path.join(binDirectory, commandName);
  const stdout = typeof options.stdout === 'string' ? options.stdout : '';
  const exitCode = typeof options.exitCode === 'number' ? options.exitCode : 0;
  const loggedEnvironmentKeys = Array.isArray(options.loggedEnvironmentKeys)
    ? options.loggedEnvironmentKeys
    : [];
  const encodedStdout = Buffer.from(stdout, 'utf8').toString('base64');

  if (process.platform === 'win32') {
    const lines = [
      '@echo off',
      `echo %*>>"${outputPath}"`,
    ];

    for (const environmentKey of loggedEnvironmentKeys) {
      lines.push(`echo ${environmentKey}=%${environmentKey}%>>"${outputPath}"`);
    }

    if (options.formattedFilePath) {
      lines.push(`>>"${options.formattedFilePath}" echo // formatted by ${commandName}`);
    }

    if (stdout) {
      lines.push(`node -e "process.stdout.write(Buffer.from('${encodedStdout}','base64').toString('utf8'))"`);
    }

    lines.push(`exit /b ${String(exitCode)}`, '');
    fs.writeFileSync(wrapperPath, lines.join('\r\n'), 'utf8');
    return;
  }

  const lines = [
    '#!/bin/sh',
    `printf '%s\n' "$*" >> "${outputPath}"`,
  ];

  for (const environmentKey of loggedEnvironmentKeys) {
    lines.push(`printf '%s\n' '${environmentKey}='"\${${environmentKey}:-}" >> '${outputPath}'`);
  }

  if (options.formattedFilePath) {
    lines.push(`printf '%s\n' '// formatted by ${commandName}' >> '${options.formattedFilePath}'`);
  }

  if (stdout) {
    lines.push(`node -e "process.stdout.write(Buffer.from('${encodedStdout}','base64').toString('utf8'))"`);
  }

  lines.push(`exit ${String(exitCode)}`, '');
  fs.writeFileSync(wrapperPath, lines.join('\n'), 'utf8');
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * HTML inline script 向けの ESLint ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param options ラッパー動作オプションを表す。
 * @returns 返り値はない。
 */
function writeInlineHtmlEslintWrapper(
  binDirectory: string,
  outputFileName: string,
  options: {
    expectedExtension?: string;
    requiredPackageJsonKey?: string;
    stdout?: string;
    exitCode?: number;
  } = {},
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const helperScriptPath = path.join(binDirectory, 'eslint-inline-wrapper.js');
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'eslint.cmd')
    : path.join(binDirectory, 'eslint');
  const stdout = typeof options.stdout === 'string' ? options.stdout : '';
  const exitCode = typeof options.exitCode === 'number' ? options.exitCode : 1;

  fs.writeFileSync(
    helperScriptPath,
    [
      'const fs = require("fs");',
      'const path = require("path");',
      'const logPath = process.argv[2];',
      `const expectedExtension = ${JSON.stringify(options.expectedExtension || '')};`,
      `const requiredPackageJsonKey = ${JSON.stringify(options.requiredPackageJsonKey || '')};`,
      `const configuredExitCode = ${String(exitCode)};`,
      `const configuredStdout = ${JSON.stringify(stdout)};`,
      'const args = process.argv.slice(3);',
      'const targetFiles = [];',
      'for (let index = 0; index < args.length; index += 1) {',
      '  const argument = args[index];',
      '  if (argument === "--config" || argument === "--format") {',
      '    index += 1;',
      '    continue;',
      '  }',
      '  if (argument === "--no-error-on-unmatched-pattern") {',
      '    continue;',
      '  }',
      '  if (argument.startsWith("-")) {',
      '    continue;',
      '  }',
      '  targetFiles.push(argument);',
      '}',
      'fs.appendFileSync(logPath, `${args.join(" ")}\\n${targetFiles.map((filePath) => `TARGET=${filePath}`).join("\\n")}\\n`, "utf8");',
      'for (const filePath of targetFiles) {',
      '  if (expectedExtension && path.extname(filePath) !== expectedExtension) {',
      '    process.stderr.write(`unexpected extension: ${path.extname(filePath)}`);',
      '    process.exit(2);',
      '  }',
      '}',
      'if (requiredPackageJsonKey) {',
      '  for (const filePath of targetFiles) {',
      '    let currentDirectory = path.dirname(filePath);',
      '    let foundPackageJsonPath = "";',
      '    while (true) {',
      '      const packageJsonPath = path.join(currentDirectory, "package.json");',
      '      if (fs.existsSync(packageJsonPath)) {',
      '        const parsedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));',
      '        if (Object.prototype.hasOwnProperty.call(parsedPackageJson, requiredPackageJsonKey)) {',
      '          foundPackageJsonPath = packageJsonPath;',
      '          break;',
      '        }',
      '      }',
      '      const parentDirectory = path.dirname(currentDirectory);',
      '      if (parentDirectory === currentDirectory) {',
      '        break;',
      '      }',
      '      currentDirectory = parentDirectory;',
      '    }',
      '    if (!foundPackageJsonPath) {',
      '      process.stderr.write(`package.json key not found: ${requiredPackageJsonKey}`);',
      '      process.exit(2);',
      '    }',
      '    fs.appendFileSync(logPath, `PACKAGE_JSON=${foundPackageJsonPath}\\n`, "utf8");',
      '  }',
      '}',
      'if (configuredStdout) {',
      '  process.stdout.write(configuredStdout);',
      '  process.exit(configuredExitCode);',
      '}',
      'const results = [];',
      'for (const filePath of targetFiles) {',
      '  const text = fs.readFileSync(filePath, "utf8");',
      '  let line = 1;',
      '  let column = 1;',
      '  for (const character of text) {',
      '    if (/\\s/u.test(character)) {',
      '      if (character === "\\n") {',
      '        line += 1;',
      '        column = 1;',
      '      } else if (character !== "\\r") {',
      '        column += 1;',
      '      }',
      '      continue;',
      '    }',
      '    break;',
      '  }',
      '  results.push({',
      '    filePath,',
      '    messages: [{',
      '      ruleId: "semi",',
      '      severity: 2,',
      '      message: "Inline script finding.",',
      '      line,',
      '      column,',
      '    }],',
      '  });',
      '  }',
      'process.stdout.write(JSON.stringify(results));',
      'process.exit(configuredExitCode);',
      '',
    ].join('\n'),
    'utf8',
  );

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\nnode "${helperScriptPath}" "${outputPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nnode '${helperScriptPath}' '${outputPath}' "$@"\n`,
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * HTML inline style 向けの Stylelint ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param options ラッパー動作オプションを表す。
 * @returns 返り値はない。
 */
function writeInlineHtmlStylelintWrapper(
  binDirectory: string,
  outputFileName: string,
  options: {
    expectedExtension?: string;
    requiredPackageJsonKey?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    findingsStream?: 'stdout' | 'stderr';
  } = {},
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const helperScriptPath = path.join(binDirectory, 'stylelint-inline-wrapper.js');
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'stylelint.cmd')
    : path.join(binDirectory, 'stylelint');
  const stdout = typeof options.stdout === 'string' ? options.stdout : '';
  const stderr = typeof options.stderr === 'string' ? options.stderr : '';
  const exitCode = typeof options.exitCode === 'number' ? options.exitCode : 2;
  const findingsStream = options.findingsStream === 'stderr' ? 'stderr' : 'stdout';

  fs.writeFileSync(
    helperScriptPath,
    [
      'const fs = require("fs");',
      'const path = require("path");',
      'const logPath = process.argv[2];',
      `const expectedExtension = ${JSON.stringify(options.expectedExtension || '')};`,
      `const requiredPackageJsonKey = ${JSON.stringify(options.requiredPackageJsonKey || '')};`,
      `const configuredExitCode = ${String(exitCode)};`,
      `const configuredStdout = ${JSON.stringify(stdout)};`,
      `const configuredStderr = ${JSON.stringify(stderr)};`,
      `const findingsStream = ${JSON.stringify(findingsStream)};`,
      'const args = process.argv.slice(3);',
      'const targetFiles = [];',
      'for (let index = 0; index < args.length; index += 1) {',
      '  const argument = args[index];',
      '  if (argument === "--config" || argument === "--formatter") {',
      '    index += 1;',
      '    continue;',
      '  }',
      '  if (argument === "--allow-empty-input") {',
      '    continue;',
      '  }',
      '  if (argument.startsWith("-")) {',
      '    continue;',
      '  }',
      '  targetFiles.push(argument);',
      '}',
      'fs.appendFileSync(logPath, `${args.join(" ")}\\n${targetFiles.map((filePath) => `TARGET=${filePath}`).join("\\n")}\\n`, "utf8");',
      'for (const filePath of targetFiles) {',
      '  if (expectedExtension && path.extname(filePath) !== expectedExtension) {',
      '    process.stderr.write(`unexpected extension: ${path.extname(filePath)}`);',
      '    process.exit(2);',
      '  }',
      '}',
      'if (requiredPackageJsonKey) {',
      '  for (const filePath of targetFiles) {',
      '    let currentDirectory = path.dirname(filePath);',
      '    let foundPackageJsonPath = "";',
      '    while (true) {',
      '      const packageJsonPath = path.join(currentDirectory, "package.json");',
      '      if (fs.existsSync(packageJsonPath)) {',
      '        const parsedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));',
      '        if (Object.prototype.hasOwnProperty.call(parsedPackageJson, requiredPackageJsonKey)) {',
      '          foundPackageJsonPath = packageJsonPath;',
      '          break;',
      '        }',
      '      }',
      '      const parentDirectory = path.dirname(currentDirectory);',
      '      if (parentDirectory === currentDirectory) {',
      '        break;',
      '      }',
      '      currentDirectory = parentDirectory;',
      '    }',
      '    if (!foundPackageJsonPath) {',
      '      process.stderr.write(`package.json key not found: ${requiredPackageJsonKey}`);',
      '      process.exit(2);',
      '    }',
      '    fs.appendFileSync(logPath, `PACKAGE_JSON=${foundPackageJsonPath}\\n`, "utf8");',
      '  }',
      '}',
      'if (configuredStdout) {',
      '  process.stdout.write(configuredStdout);',
      '}',
      'if (configuredStderr) {',
      '  process.stderr.write(configuredStderr);',
      '}',
      'if (configuredStdout || configuredStderr) {',
      '  process.exit(configuredExitCode);',
      '}',
      'const results = [];',
      'for (const filePath of targetFiles) {',
      '  const text = fs.readFileSync(filePath, "utf8");',
      '  let line = 1;',
      '  let column = 1;',
      '  for (const character of text) {',
      '    if (/\\s/u.test(character)) {',
      '      if (character === "\\n") {',
      '        line += 1;',
      '        column = 1;',
      '      } else if (character !== "\\r") {',
      '        column += 1;',
      '      }',
      '      continue;',
      '    }',
      '    break;',
      '  }',
      '  results.push({',
      '    source: filePath,',
      '    warnings: [{',
      '      line,',
      '      column,',
      '      rule: "color-no-invalid-hex",',
      '      severity: "error",',
      "      text: 'Unexpected invalid hex color \"#12\" (color-no-invalid-hex)',",
      '    }],',
      '  });',
      '}',
      'if (findingsStream === "stderr") {',
      '  process.stderr.write(JSON.stringify(results));',
      '} else {',
      '  process.stdout.write(JSON.stringify(results));',
      '}',
      'process.exit(configuredExitCode);',
      '',
    ].join('\n'),
    'utf8',
  );

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\nnode "${helperScriptPath}" "${outputPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nnode '${helperScriptPath}' '${outputPath}' "$@"\n`,
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Maven 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenIssueWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"checkstyle:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"pmd:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedPmdXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * PMD を既定レポートファイルへ出力するテスト用 Maven ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenPmdReportWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');
  const pmdReportPath = path.join(path.dirname(binDirectory), 'target', 'pmd.xml');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"checkstyle:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"pmd:check" >nul',
        `if not errorlevel 1 if not exist "${path.dirname(pmdReportPath)}" mkdir "${path.dirname(pmdReportPath)}"`,
        `if not errorlevel 1 node -e "require('fs').writeFileSync('${pmdReportPath.split('\\').join('\\\\')}', Buffer.from('${encodedPmdXml}','base64').toString('utf8'), 'utf8')"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) mkdir -p '${path.dirname(pmdReportPath)}'; printf '%s' '${pmdXml}' > '${pmdReportPath}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Checkstyle を既定レポートファイルへ出力するテスト用 Maven ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenCheckstyleReportWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');
  const checkstyleReportPath = path.join(path.dirname(binDirectory), 'target', 'checkstyle-result.xml');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"checkstyle:check" >nul',
        `if not errorlevel 1 if not exist "${path.dirname(checkstyleReportPath)}" mkdir "${path.dirname(checkstyleReportPath)}"`,
        `if not errorlevel 1 node -e "require('fs').writeFileSync('${checkstyleReportPath.split('\\').join('\\\\')}', Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'), 'utf8')"`,
        'echo %* | findstr /C:"pmd:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedPmdXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) mkdir -p '${path.dirname(checkstyleReportPath)}'; printf '%s' '${checkstyleXml}' > '${checkstyleReportPath}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-commit の Git 再ステージ検証向け Maven ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param formattedFilePath 整形対象ファイルパスを表す。
 * @returns 返り値はない。
 */
function writeMavenPrecommitGitWrapper(
  binDirectory: string,
  outputFileName: string,
  formattedFilePath: string,
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"spotless:apply" >nul',
        `if not errorlevel 1 >>"${formattedFilePath}" echo // formatted by spotless`,
        'echo %* | findstr /C:"checkstyle:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"pmd:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedPmdXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"spotless:apply"*) printf '%s\n' '// formatted by spotless' >> '${formattedFilePath}' ;;`,
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-commit 検証向けの Git ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @param stagedFilePath ステージ済みファイルのワークスペース相対パスを表す。
 * @param stagedFileAbsolutePath ステージ済みファイルの絶対パスを表す。
 * @param indexSnapshotPath 再ステージ済み内容の退避先を表す。
 * @returns 返り値はない。
 */
function writeGitPrecommitWrapper(
  binDirectory: string,
  outputFileName: string,
  stagedFilePath: string,
  stagedFileAbsolutePath: string,
  indexSnapshotPath: string,
): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const normalizedStagedFilePath = stagedFilePath.split(path.sep).join('/');
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'git.cmd')
    : path.join(binDirectory, 'git');

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"diff --cached --name-only --diff-filter=ACMR" >nul',
        `if not errorlevel 1 echo ${normalizedStagedFilePath}`,
        'echo %* | findstr /C:"diff --cached --name-only --diff-filter=ACMR" >nul',
        'if not errorlevel 1 exit /b 0',
        'echo %* | findstr /C:"add --" >nul',
        `if not errorlevel 1 node -e "const fs=require('fs');const path=require('path');fs.mkdirSync(path.dirname(process.argv[2]),{recursive:true});fs.copyFileSync(process.argv[1], process.argv[2]);" "${stagedFileAbsolutePath}" "${indexSnapshotPath}"`,
        'echo %* | findstr /C:"add --" >nul',
        'if not errorlevel 1 exit /b 0',
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"diff --cached --name-only --diff-filter=ACMR"*) printf '%s\n' '${normalizedStagedFilePath}' ;;`,
      `  *"add --"*) mkdir -p '${path.dirname(indexSnapshotPath)}' && cp '${stagedFileAbsolutePath}' '${indexSnapshotPath}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Gradle 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeGradleIssueWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="4" column="3" severity="warning" message="Gradle Checkstyle finding" source="com.puppycrawl.tools.checkstyle.checks.naming.MemberNameCheck"/></file></checkstyle>';
  const pmdXml = '<?xml version="1.0"?><pmd version="7.0.0"><file name="src/main/java/App.java"><violation beginline="5" begincolumn="7" priority="2" rule="AvoidDuplicateLiterals">Gradle PMD finding</violation></file></pmd>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'gradlew.bat')
    : path.join(path.dirname(binDirectory), 'gradlew');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"checkstyleMain" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"pmdMain" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedPmdXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"checkstyleMain"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmdMain"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-push 向け Gradle 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeGradlePrepushWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const cpdXml = '<?xml version="1.0"?><pmd-cpd><duplication lines="8" tokens="52"><file path="src/main/java/App.java" line="10"/><file path="src/main/java/Other.java" line="18"/></duplication></pmd-cpd>';
  const spotbugsXml = '<?xml version="1.0"?><BugCollection><BugInstance type="DLS_DEAD_LOCAL_STORE" priority="3"><LongMessage>Dead store to local variable</LongMessage><Class classname="App"/><SourceLine classname="App" sourcepath="src/main/java/App.java" start="21"/></BugInstance></BugCollection>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'gradlew.bat')
    : path.join(path.dirname(binDirectory), 'gradlew');

  if (process.platform === 'win32') {
    const encodedCpdXml = Buffer.from(cpdXml, 'utf8').toString('base64');
    const encodedSpotbugsXml = Buffer.from(spotbugsXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"cpdCheck" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCpdXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"spotbugsMain" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedSpotbugsXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"cpdCheck"*) printf '%s' '${cpdXml}' ;;`,
      `  *"spotbugsMain"*) printf '%s' '${spotbugsXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-push 向け Maven 実行結果を返すテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenPrepushWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const cpdXml = '<?xml version="1.0"?><pmd-cpd><duplication lines="6" tokens="40"><file path="src/main/java/App.java" line="8"/><file path="src/main/java/Other.java" line="12"/></duplication></pmd-cpd>';
  const spotbugsXml = '<?xml version="1.0"?><BugCollection><BugInstance type="NP_NULL_ON_SOME_PATH" priority="2"><LongMessage>Possible null pointer dereference</LongMessage><Class classname="App"/><SourceLine classname="App" sourcepath="src/main/java/App.java" start="14"/></BugInstance></BugCollection>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');

  if (process.platform === 'win32') {
    const encodedCpdXml = Buffer.from(cpdXml, 'utf8').toString('base64');
    const encodedSpotbugsXml = Buffer.from(spotbugsXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"pmd:cpd-check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCpdXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"spotbugs:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedSpotbugsXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"pmd:cpd-check"*) printf '%s' '${cpdXml}' ;;`,
      `  *"spotbugs:check"*) printf '%s' '${spotbugsXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * CPD と SpotBugs を既定レポートファイルへ出力するテスト用 Maven ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenPrepushReportWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const cpdXml = '<?xml version="1.0"?><pmd-cpd><duplication lines="6" tokens="40"><file path="src/main/java/App.java" line="8"/><file path="src/main/java/Other.java" line="12"/></duplication></pmd-cpd>';
  const spotbugsXml = '<?xml version="1.0"?><BugCollection><BugInstance type="NP_NULL_ON_SOME_PATH" priority="2"><LongMessage>Possible null pointer dereference</LongMessage><Class classname="App"/><SourceLine classname="App" sourcepath="src/main/java/App.java" start="14"/></BugInstance></BugCollection>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');
  const cpdReportPath = path.join(path.dirname(binDirectory), 'target', 'cpd.xml');
  const spotbugsReportPath = path.join(path.dirname(binDirectory), 'target', 'spotbugsXml.xml');

  if (process.platform === 'win32') {
    const encodedCpdXml = Buffer.from(cpdXml, 'utf8').toString('base64');
    const encodedSpotbugsXml = Buffer.from(spotbugsXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"pmd:cpd-check" >nul',
        `if not errorlevel 1 if not exist "${path.dirname(cpdReportPath)}" mkdir "${path.dirname(cpdReportPath)}"`,
        `if not errorlevel 1 node -e "require('fs').writeFileSync('${cpdReportPath.split('\\').join('\\\\')}', Buffer.from('${encodedCpdXml}','base64').toString('utf8'), 'utf8')"`,
        'echo %* | findstr /C:"spotbugs:check" >nul',
        `if not errorlevel 1 if not exist "${path.dirname(spotbugsReportPath)}" mkdir "${path.dirname(spotbugsReportPath)}"`,
        `if not errorlevel 1 node -e "require('fs').writeFileSync('${spotbugsReportPath.split('\\').join('\\\\')}', Buffer.from('${encodedSpotbugsXml}','base64').toString('utf8'), 'utf8')"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"pmd:cpd-check"*) mkdir -p '${path.dirname(cpdReportPath)}'; printf '%s' '${cpdXml}' > '${cpdReportPath}' ;;`,
      `  *"spotbugs:check"*) mkdir -p '${path.dirname(spotbugsReportPath)}'; printf '%s' '${spotbugsXml}' > '${spotbugsReportPath}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * pre-push 向け Maven 実行結果に Checkstyle finding を含めるテスト用ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeMavenPrepushCheckstyleWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const checkstyleXml = '<?xml version="1.0"?><checkstyle version="10.0"><file name="src/main/java/App.java"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>';
  const cpdXml = '<?xml version="1.0"?><pmd-cpd><duplication lines="6" tokens="40"><file path="src/main/java/App.java" line="8"/><file path="src/main/java/Other.java" line="12"/></duplication></pmd-cpd>';
  const spotbugsXml = '<?xml version="1.0"?><BugCollection><BugInstance type="NP_NULL_ON_SOME_PATH" priority="2"><LongMessage>Possible null pointer dereference</LongMessage><Class classname="App"/><SourceLine classname="App" sourcepath="src/main/java/App.java" start="14"/></BugInstance></BugCollection>';
  const wrapperPath = process.platform === 'win32'
    ? path.join(path.dirname(binDirectory), 'mvnw.cmd')
    : path.join(path.dirname(binDirectory), 'mvnw');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedCpdXml = Buffer.from(cpdXml, 'utf8').toString('base64');
    const encodedSpotbugsXml = Buffer.from(spotbugsXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${outputPath}"`,
        'echo %* | findstr /C:"checkstyle:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCheckstyleXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"pmd:cpd-check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedCpdXml}','base64').toString('utf8'))"`,
        'echo %* | findstr /C:"spotbugs:check" >nul',
        `if not errorlevel 1 node -e "process.stdout.write(Buffer.from('${encodedSpotbugsXml}','base64').toString('utf8'))"`,
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:cpd-check"*) printf '%s' '${cpdXml}' ;;`,
      `  *"spotbugs:check"*) printf '%s' '${spotbugsXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Semgrep 用の SARIF 出力ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param outputFileName 出力ファイル名を表す。
 * @returns 返り値はない。
 */
function writeSemgrepSarifWrapper(binDirectory: string, outputFileName: string): void {
  const outputPath = path.join(binDirectory, outputFileName);
  const sarif = JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'semgrep' } },
        results: [
          {
            ruleId: 'java.lang.security.audit',
            level: 'warning',
            message: { text: 'Potential issue' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/main/java/App.java' },
                  region: { startLine: 1, startColumn: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  });
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'semgrep.cmd')
    : path.join(binDirectory, 'semgrep');

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\necho %*>>"${outputPath}"\r\necho ${sarif}\r\nexit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${outputPath}"`,
      `printf '%s\n' '${sarif}'`,
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

/**
 * Mamori CLI のテストスイートを定義する。
 * @returns 返り値はない。
 */
suite('Mamori CLI Test Suite', () => {
  /**
   * 不正な mode を拒否すること。
   * @returns 返り値はない。
   */
  test('Rejects an invalid mode', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'bogus',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /invalid mode: bogus/u);
  });

  /**
   * file scope では files が必須であること。
   * @returns 返り値はない。
   */
  test('Requires files for file scope', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
    ]);

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /scope=file requires --files/u);
  });

  /**
   * save/file では対象ファイル起点で最寄り設定を探索すること。
   * @returns 返り値はない。
   */
  test('Discovers the nearest ESLint configuration from the target file', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // 対象モジュールディレクトリを表す
    const moduleDirectory = path.join(temporaryDirectory, 'packages', 'app');
    // ソースディレクトリを表す
    const sourceDirectory = path.join(moduleDirectory, 'src');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'main.ts');
    // 設定ファイルパスを表す
    const eslintConfigPath = path.join(moduleDirectory, 'eslint.config.ts');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'export const sample = 1;\n', 'utf8');
    fs.writeFileSync(eslintConfigPath, 'export default [];\n', 'utf8');

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /source=discovery/u);
    assert.match(result.stdout, /eslint\.config\.ts/u);
  });

  /**
   * save/file で Web 系ツールが拡張子ごとに分離された command plan を構築すること。
   * @returns 返り値はない。
   */
  test('Builds save command plans for web files with tool-specific targets', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const javascriptFilePath = path.join(scriptDirectory, 'main.js');
    const cssFilePath = path.join(styleDirectory, 'site.css');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(cssFilePath, 'body { color: black; }\n', 'utf8');
    fs.writeFileSync(htmlFilePath, '<!doctype html>\n<html></html>\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tagname-lowercase": true}\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      [
        path.relative(temporaryDirectory, javascriptFilePath),
        path.relative(temporaryDirectory, cssFilePath),
        path.relative(temporaryDirectory, htmlFilePath),
      ].join(','),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /formatters=prettier:enabled/u);
    assert.match(result.stdout, /checks=eslint:enabled, stylelint:enabled, htmlhint:enabled/u);

    const prettierLine = result.stdout.match(/prettier:prettier[^\n]*/u);
    const eslintLine = result.stdout.match(/eslint:eslint[^,\n]*/u);
    const stylelintLine = result.stdout.match(/stylelint:stylelint[^,\n]*/u);
    const htmlhintLine = result.stdout.match(/htmlhint:htmlhint[^\n]*/u);

    assert.ok(prettierLine);
    assert.ok(eslintLine);
    assert.ok(stylelintLine);
    assert.ok(htmlhintLine);
    assert.match(prettierLine ? prettierLine[0] : '', /main\.js/u);
    assert.match(prettierLine ? prettierLine[0] : '', /site\.css/u);
    assert.match(prettierLine ? prettierLine[0] : '', /index\.html/u);
    assert.match(eslintLine ? eslintLine[0] : '', /main\.js/u);
    assert.doesNotMatch(eslintLine ? eslintLine[0] : '', /site\.css|index\.html/u);
    assert.match(stylelintLine ? stylelintLine[0] : '', /site\.css/u);
    assert.doesNotMatch(stylelintLine ? stylelintLine[0] : '', /main\.js|index\.html/u);
    assert.match(htmlhintLine ? htmlhintLine[0] : '', /index\.html/u);
    assert.doesNotMatch(htmlhintLine ? htmlhintLine[0] : '', /main\.js|site\.css/u);
  });

  /**
   * save/file で TypeScript ファイルを ESLint 対象に含めること。
   * @returns 返り値はない。
   */
  test('Builds save command plans for TypeScript files with ESLint targets', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const targetFilePath = path.join(sourceDirectory, 'main.ts');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'export const sample: number = 1;\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /checks=eslint:enabled/u);
    assert.match(result.stdout, /eslint:eslint --config .*eslint\.config\.mjs/u);
    assert.match(result.stdout, /main\.ts/u);
    assert.doesNotMatch(result.stdout, /formatters=prettier:enabled/u);
  });

  /**
   * save/file で CSS ファイルの Stylelint finding を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Reports direct CSS Stylelint findings during save checks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const cssFilePath = path.join(styleDirectory, 'site.css');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const prettierLogPath = path.join(nodeBinDirectory, 'prettier.log');
    const stylelintLogPath = path.join(nodeBinDirectory, 'stylelint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-css-save.sarif');
    const stylelintOutput = JSON.stringify([
      {
        source: cssFilePath,
        warnings: [
          {
            line: 1,
            column: 15,
            rule: 'color-no-invalid-hex',
            severity: 'error',
            text: 'Unexpected invalid hex color "#12" (color-no-invalid-hex)',
          },
        ],
      },
    ]);

    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.writeFileSync(cssFilePath, 'body { color: #12; }\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {};\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'stylelint', 'stylelint.log', {
      stdout: stylelintOutput,
      exitCode: 2,
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, cssFilePath),
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /stylelint:failed exitCode=2/u);
    assert.match(result.stdout, /Unexpected invalid hex color/u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /site\.css/u);
    assert.match(fs.readFileSync(stylelintLogPath, 'utf8'), /site\.css/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /color-no-invalid-hex/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /site\.css/u);
  });

  /**
   * save/file で HTML 本体の htmlhint finding を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Reports direct HTML htmlhint findings during save checks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const prettierLogPath = path.join(nodeBinDirectory, 'prettier.log');
    const htmlhintLogPath = path.join(nodeBinDirectory, 'htmlhint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-html-save.sarif');
    const htmlhintOutput = JSON.stringify([
      {
        file: htmlFilePath,
        messages: [
          {
            type: 'warning',
            message: 'Tag must be paired.',
            line: 2,
            col: 1,
            rule: { id: 'tag-pair' },
          },
        ],
      },
    ]);

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(htmlFilePath, '<!doctype html>\n<div>\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', {
      stdout: htmlhintOutput,
      exitCode: 1,
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /htmlhint:failed exitCode=1/u);
    assert.match(result.stdout, /Tag must be paired\./u);
    assert.match(result.stdout, /eslint:skipped reason=no-target-files/u);
    assert.match(result.stdout, /stylelint:skipped reason=no-target-files/u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(htmlhintLogPath, 'utf8'), /index\.html/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /tag-pair/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
  });

  /**
   * save/file で TypeScript ファイルの ESLint finding を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Reports direct TypeScript ESLint findings during save checks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const typescriptFilePath = path.join(sourceDirectory, 'main.ts');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-typescript-save.sarif');
    const eslintOutput = JSON.stringify([
      {
        filePath: typescriptFilePath,
        messages: [
          {
            ruleId: '@typescript-eslint/no-unused-vars',
            severity: 2,
            message: 'Unused variable value.',
            line: 1,
            column: 7,
          },
        ],
      },
    ]);

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(typescriptFilePath, 'const value: number = 1;\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log', {
      stdout: eslintOutput,
      exitCode: 1,
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, typescriptFilePath),
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /eslint:failed exitCode=1/u);
    assert.match(result.stdout, /Unused variable value\./u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /main\.ts/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /@typescript-eslint\/no-unused-vars/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /main\.ts/u);
  });

  /**
   * 明示指定がある場合は Semgrep の既定値より優先されること。
   * @returns 返り値はない。
   */
  test('Prefers explicit Semgrep rules over defaults', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'manual',
      '--scope',
      'workspace',
      '--semgrep-rule',
      'custom/rule',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /semgrep: enabled \(source=explicit\)/u);
    assert.match(result.stdout, /rules=custom\/rule/u);
  });

  /**
   * 存在しない対象ファイルを安全に拒否すること。
   * @returns 返り値はない。
   */
  test('Rejects a missing target file safely', () => {
    // CLI 実行結果を表す
    const result = runMamoriCli(process.cwd(), [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      'does-not-exist/main.ts',
    ]);

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /file not found: does-not-exist[\\/]main\.ts/u);
  });

  /**
   * pre-commit の staged 解決では Git CLI が必要であること。
   * @returns 返り値はない。
   */
  test('Reports a clear error when git is unavailable for precommit staged resolution', () => {
    const temporaryDirectory = createTemporaryDirectory();

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
      ],
      {
        env: {
          ...process.env,
          PATH: '',
        },
      },
    );

    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /git CLI was not found in PATH/u);
  });

  /**
   * 退避ファイルを有効設定として誤検知しないこと。
   * @returns 返り値はない。
   */
  test('Ignores backup-like configuration filenames', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // 対象ファイルの親ディレクトリを表す
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'main.ts');
    // 退避ファイルパスを表す
    const backupConfigPath = path.join(temporaryDirectory, 'eslint.config.backup');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'export const sample = 1;\n', 'utf8');
    fs.writeFileSync(backupConfigPath, 'ignored\n', 'utf8');

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /eslint\.config\.backup/u);
    assert.match(result.stdout, /eslint: enabled \(source=default\)/u);
    assert.match(result.stdout, /eslint\.default\.json/u);
  });

  /**
   * 設定未検出時は組み込み Web 設定で checker を有効化すること。
   * @returns 返り値はない。
   */
  test('Enables web checkers with bundled fallback configuration when project configuration is not detected', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const htmlDirectory = path.join(temporaryDirectory, 'public');

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(path.join(scriptDirectory, 'main.js'), 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(path.join(styleDirectory, 'site.css'), 'body { color: black; }\n', 'utf8');
    fs.writeFileSync(path.join(htmlDirectory, 'index.html'), '<!doctype html>\n<html></html>\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /mamori: execution-plan\n  - none/u);
    assert.doesNotMatch(result.stdout, /mamori: command-plan\n  - none/u);
    assert.match(result.stdout, /eslint: enabled \(source=default\)/u);
    assert.match(result.stdout, /stylelint: enabled \(source=default\)/u);
    assert.match(result.stdout, /htmlhint: enabled \(source=default\)/u);
    assert.match(result.stdout, /eslint:enabled/u);
    assert.match(result.stdout, /stylelint:enabled/u);
    assert.match(result.stdout, /htmlhint:enabled/u);
    assert.match(result.stdout, /eslint\.default\.json/u);
    assert.match(result.stdout, /stylelint\.default\.json/u);
    assert.match(result.stdout, /htmlhint\.default\.json/u);
    assert.doesNotMatch(result.stdout, /config-not-detected/u);
  });

  /**
   * 設定未検出時でも組み込み Web 設定ファイルを各 checker 実行へ渡すこと。
   * @returns 返り値はない。
   */
  test('Executes web checkers with bundled fallback configuration files', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const stylelintLogPath = path.join(nodeBinDirectory, 'stylelint.log');
    const htmlhintLogPath = path.join(nodeBinDirectory, 'htmlhint.log');

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(path.join(scriptDirectory, 'main.js'), 'const sample = 1\n', 'utf8');
    fs.writeFileSync(path.join(styleDirectory, 'site.css'), 'body { color: #12; }\n', 'utf8');
    fs.writeFileSync(path.join(htmlDirectory, 'index.html'), '<!doctype html>\n<html><body><div id="a" id="a"></div></body></html>\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log', {
      stdout: '[]',
      exitCode: 0,
      loggedEnvironmentKeys: ['ESLINT_USE_FLAT_CONFIG'],
    });
    writeWebCommandWrapper(nodeBinDirectory, 'stylelint', 'stylelint.log', { stdout: '[]', exitCode: 0 });
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /eslint:ok exitCode=0/u);
    assert.match(result.stdout, /stylelint:ok exitCode=0/u);
    assert.match(result.stdout, /htmlhint:ok exitCode=0/u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /--config .*eslint\.default\.json/u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /ESLINT_USE_FLAT_CONFIG=false/u);
    assert.match(fs.readFileSync(stylelintLogPath, 'utf8'), /--config .*stylelint\.default\.json/u);
    assert.match(fs.readFileSync(htmlhintLogPath, 'utf8'), /--config .*htmlhint\.default\.json/u);
  });

  /**
   * 設定未検出の TypeScript ファイルでは JS 向け ESLint fallback を適用しないこと。
   * @returns 返り値はない。
   */
  test('Skips TypeScript ESLint checks when project configuration is not detected', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const targetFilePath = path.join(sourceDirectory, 'main.ts');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'const value: number = 1;\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /commands=eslint:eslint/u);
    assert.match(result.stdout, /mamori: execution-plan\n  - none/u);
    assert.match(result.stdout, /mamori: command-plan\n  - none/u);
  });

  /**
   * Web 専用ワークスペースでも plan が空にならないこと。
   * @returns 返り値はない。
   */
  test('Keeps execution and command plans non-empty for web-only workspaces', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.writeFileSync(path.join(scriptDirectory, 'main.js'), 'const sample = 1;\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-plan/u);
    assert.match(result.stdout, /workspace:/u);
    assert.match(result.stdout, /mamori: command-plan/u);
    assert.doesNotMatch(result.stdout, /mamori: execution-plan\n  - none/u);
    assert.doesNotMatch(result.stdout, /mamori: command-plan\n  - none/u);
  });

  /**
   * workspace scope でもネストした Web 設定を module 単位で解決できること。
   * @returns 返り値はない。
   */
  test('Builds workspace web modules from nested configuration roots', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const moduleDirectory = path.join(temporaryDirectory, 'packages', 'app');
    const sourceDirectory = path.join(moduleDirectory, 'src');
    const targetFilePath = path.join(sourceDirectory, 'main.js');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(path.join(moduleDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /packages[\\/]app/u);
    assert.match(result.stdout, /checks=eslint:enabled/u);
    assert.match(result.stdout, /commands=eslint:eslint/u);
  });

  /**
   * nested module と root 側の Web ファイルが共存しても両方を計画できること。
   * @returns 返り値はない。
   */
  test('Adds a root fallback web module when root files coexist with nested configured modules', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const rootSourceDirectory = path.join(temporaryDirectory, 'src');
    const moduleDirectory = path.join(temporaryDirectory, 'packages', 'app');
    const moduleSourceDirectory = path.join(moduleDirectory, 'src');

    fs.mkdirSync(rootSourceDirectory, { recursive: true });
    fs.mkdirSync(moduleSourceDirectory, { recursive: true });
    fs.writeFileSync(path.join(rootSourceDirectory, 'root-main.js'), 'const rootValue = 1;\n', 'utf8');
    fs.writeFileSync(path.join(moduleSourceDirectory, 'nested-main.js'), 'const nestedValue = 1;\n', 'utf8');
    fs.writeFileSync(path.join(moduleDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /root-main\.js/u);
    assert.match(result.stdout, /nested-main\.js/u);
    assert.match(result.stdout, /eslint\.default\.json/u);
    assert.match(result.stdout, /packages[\\/]app[\\/]eslint\.config\.mjs/u);
    assert.ok((result.stdout.match(/commands=eslint:eslint/gu) || []).length >= 2);
  });

  /**
   * pre-push の Web checker 失敗時に issue を SARIF 化して gate できること。
   * @returns 返り値はない。
   */
  test('Fails prepush when web checkers report findings and writes SARIF issues', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const scriptDirectory = path.join(temporaryDirectory, 'src');
    const styleDirectory = path.join(temporaryDirectory, 'styles');
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-web-prepush.sarif');
    const javascriptFilePath = path.join(scriptDirectory, 'main.js');
    const cssFilePath = path.join(styleDirectory, 'site.css');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const eslintOutput = JSON.stringify([
      {
        filePath: javascriptFilePath,
        messages: [
          {
            ruleId: 'no-console',
            severity: 2,
            message: 'Unexpected console statement.',
            line: 1,
            column: 1,
          },
        ],
      },
    ]);
    const stylelintOutput = JSON.stringify([
      {
        source: cssFilePath,
        warnings: [
          {
            line: 1,
            column: 8,
            rule: 'color-no-invalid-hex',
            severity: 'error',
            text: 'Unexpected invalid hex color "#12" (color-no-invalid-hex)',
          },
        ],
      },
    ]);
    const htmlhintOutput = JSON.stringify([
      {
        file: htmlFilePath,
        messages: [
          {
            type: 'warning',
            message: 'Tag must be paired.',
            line: 2,
            col: 3,
            rule: { id: 'tag-pair' },
          },
        ],
      },
    ]);

    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(styleDirectory, { recursive: true });
    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'console.log("sample");\n', 'utf8');
    fs.writeFileSync(cssFilePath, 'body { color: #12; }\n', 'utf8');
    fs.writeFileSync(htmlFilePath, '<!doctype html>\n<div>\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log', { stdout: eslintOutput, exitCode: 1 });
    writeWebCommandWrapper(nodeBinDirectory, 'stylelint', 'stylelint.log', { stdout: stylelintOutput, exitCode: 2 });
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: htmlhintOutput, exitCode: 1 });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Unexpected console statement\./u);
    assert.match(result.stdout, /Unexpected invalid hex color/u);
    assert.match(result.stdout, /Tag must be paired\./u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /no-console/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /color-no-invalid-hex/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /tag-pair/u);
  });

  /**
   * pre-push で HTML inline style の Stylelint 診断を元 HTML に逆写像し、一時ファイルを削除すること。
   * @returns 返り値はない。
   */
  test('Maps inline HTML Stylelint findings back to the source file and cleans temporary files', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const stylelintLogPath = path.join(nodeBinDirectory, 'stylelint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-style.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<style>body { color: #12; }</style>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {}\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeInlineHtmlStylelintWrapper(nodeBinDirectory, 'stylelint.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /Unexpected invalid hex color/u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);

    const stylelintLog = fs.readFileSync(stylelintLogPath, 'utf8');
    const targetMatch = stylelintLog.match(/TARGET=(.+)\r?\n/u);
    assert.ok(targetMatch);
    const temporaryInlineStylePath = targetMatch ? targetMatch[1].trim() : '';
    assert.notStrictEqual(temporaryInlineStylePath, '');
    assert.ok(!fs.existsSync(temporaryInlineStylePath));
  });

  /**
   * pre-push で Stylelint が stderr に JSON を出しても HTML inline style 診断を取り込めること。
   * @returns 返り値はない。
   */
  test('Parses inline HTML Stylelint findings from stderr output', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-style-stderr.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<style>body { color: #12; }</style>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {}\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlStylelintWrapper(nodeBinDirectory, 'stylelint.log', {
      findingsStream: 'stderr',
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /Unexpected invalid hex color/u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
  });

  /**
   * save/file で package.json の stylelint 設定を HTML inline style 実行時にも継承できること。
   * @returns 返り値はない。
   */
  test('Uses package.json stylelint configuration for inline HTML style execution', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const stylelintLogPath = path.join(nodeBinDirectory, 'stylelint.log');
    const htmlhintLogPath = path.join(nodeBinDirectory, 'htmlhint.log');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<style>body { color: #12; }</style>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'package.json'),
      JSON.stringify({ stylelint: { rules: { 'color-no-invalid-hex': true } } }, null, 2),
      'utf8',
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlStylelintWrapper(nodeBinDirectory, 'stylelint.log', {
      requiredPackageJsonKey: 'stylelint',
      stdout: '[]',
      exitCode: 0,
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /stylelint:ok exitCode=0/u);
    assert.match(result.stdout, /htmlhint:ok exitCode=0/u);
    assert.match(fs.readFileSync(stylelintLogPath, 'utf8'), /PACKAGE_JSON=.*package\.json/u);
    assert.match(fs.readFileSync(htmlhintLogPath, 'utf8'), /--config .*htmlhint\.default\.json/u);
  });

  /**
   * CSS と互換でない type の inline style は Stylelint 対象外であること。
   * @returns 返り値はない。
   */
  test('Skips non CSS inline style types', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const stylelintLogPath = path.join(nodeBinDirectory, 'stylelint.log');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<style type="text/less">@value: #12;</style>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {}\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlStylelintWrapper(nodeBinDirectory, 'stylelint.log', {
      stdout: '[]',
      exitCode: 0,
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /stylelint:skipped reason=no-target-files/u);
    assert.ok(!fs.existsSync(stylelintLogPath));
  });

  /**
   * data-type は style の type 属性として扱わず、inline style を Stylelint 対象に含めること。
   * @returns 返り値はない。
   */
  test('Lints inline styles when only data-type is present', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const stylelintLogPath = path.join(nodeBinDirectory, 'stylelint.log');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<style data-type="text/less">body { color: #12; }</style>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {}\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlStylelintWrapper(nodeBinDirectory, 'stylelint.log');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /stylelint:failed exitCode=2/u);
    assert.ok(fs.existsSync(stylelintLogPath));
  });

  /**
   * 属性値に > を含む HTML inline style でも本文位置を正しく逆写像できること。
   * @returns 返り値はない。
   */
  test('Maps inline HTML Stylelint findings when style attributes include a greater-than sign', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-style-quoted-attribute.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<style data-label="1>0">body { color: #12; }</style>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeInlineHtmlStylelintWrapper(nodeBinDirectory, 'stylelint.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startColumn": 25/u);
  });

  /**
   * pre-push で HTML inline script の ESLint 診断を元 HTML に逆写像し、一時ファイルを削除すること。
   * @returns 返り値はない。
   */
  test('Maps inline HTML ESLint findings back to the source file and cleans temporary files', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-html.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script>console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /Inline script finding\./u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startColumn": 9/u);

    const eslintLog = fs.readFileSync(eslintLogPath, 'utf8');
    const targetMatch = eslintLog.match(/TARGET=(.+)\r?\n/u);
    assert.ok(targetMatch);
    const temporaryInlineScriptPath = targetMatch ? targetMatch[1].trim() : '';
    assert.notStrictEqual(temporaryInlineScriptPath, '');
    assert.ok(!fs.existsSync(temporaryInlineScriptPath));
  });

  /**
   * pre-push で複数の HTML inline script 診断を元 HTML に逆写像できること。
   * @returns 返り値はない。
   */
  test('Maps multiple inline HTML ESLint findings back to the source file', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-html-multiple.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script>console.log("first")</script>',
        '<div>middle</div>',
        '<script type="module">export const second = 2</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /issues=2/u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(result.stdout, /index\.html:6/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 6/u);

    const eslintLog = fs.readFileSync(eslintLogPath, 'utf8');
    const temporaryInlineScriptPaths = Array.from(
      eslintLog.matchAll(/TARGET=(.+)\r?\n/gu),
      (match) => match[1].trim(),
    );
    assert.strictEqual(temporaryInlineScriptPaths.length, 2);
    assert.match(eslintLog, /TARGET=.*\.js/u);
    assert.match(eslintLog, /TARGET=.*\.mjs/u);
    for (const temporaryInlineScriptPath of temporaryInlineScriptPaths) {
      assert.ok(!fs.existsSync(temporaryInlineScriptPath));
    }
  });

  /**
   * 属性値に > を含む HTML inline script でも本文位置を正しく逆写像できること。
   * @returns 返り値はない。
   */
  test('Maps inline HTML ESLint findings when script attributes include a greater-than sign', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-html-quoted-attribute.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script data-label="1>0">console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startColumn": 26/u);
  });

  /**
   * save/file で package.json の eslintConfig を HTML inline script 実行時にも継承できること。
   * @returns 返り値はない。
   */
  test('Uses package.json eslintConfig for inline HTML script execution', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const htmlhintLogPath = path.join(nodeBinDirectory, 'htmlhint.log');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script>console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(temporaryDirectory, 'package.json'),
      JSON.stringify({ eslintConfig: { rules: { semi: 'error' } } }, null, 2),
      'utf8',
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log', {
      requiredPackageJsonKey: 'eslintConfig',
      stdout: '[]',
      exitCode: 0,
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /eslint:ok exitCode=0/u);
    assert.match(result.stdout, /htmlhint:ok exitCode=0/u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /PACKAGE_JSON=.*package\.json/u);
    assert.match(fs.readFileSync(htmlhintLogPath, 'utf8'), /--config .*htmlhint\.default\.json/u);
  });

  /**
   * save/file で type=module の inline script を .mjs として ESLint へ渡すこと。
   * @returns 返り値はない。
   */
  test('Uses mjs temporary files for module inline scripts', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-module.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script type="module">export const sample = 1;</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default []\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log', {
      expectedExtension: '.mjs',
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /Inline script finding\./u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /TARGET=.*\.mjs/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
  });

  /**
   * save/file でパラメータ付き JavaScript MIME type の inline script も ESLint 対象であること。
   * @returns 返り値はない。
   */
  test('Lints inline scripts with parameterized JavaScript MIME types', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-mime-parameter.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script type="text/javascript; charset=utf-8">console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default []\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log', {
      expectedExtension: '.js',
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /Inline script finding\./u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /TARGET=.*\.js/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
  });

  /**
   * save/file で parameterized な application JavaScript MIME type の inline script も ESLint 対象であること。
   * @returns 返り値はない。
   */
  test('Lints inline scripts with parameterized application JavaScript MIME types', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-application-mime-parameter.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script type="application/javascript; charset=utf-8">console.log("first")</script>',
        '<script type="application/ecmascript; charset=utf-8">console.log("second")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default []\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log', {
      expectedExtension: '.js',
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /issues=2/u);
    assert.match(result.stdout, /Inline script finding\./u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(result.stdout, /index\.html:5/u);
    const eslintLog = fs.readFileSync(eslintLogPath, 'utf8');
    const temporaryInlineScriptPaths = Array.from(
      eslintLog.matchAll(/TARGET=(.+)\r?\n/gu),
      (match) => match[1].trim(),
    );
    assert.strictEqual(temporaryInlineScriptPaths.length, 2);
    assert.match(eslintLog, /TARGET=.*\.js/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 5/u);
  });

  /**
   * save/file で parameterized な非 JavaScript MIME type の inline script は ESLint 対象外であること。
   * @returns 返り値はない。
   */
  test('Skips parameterized non JavaScript inline script MIME types', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script type="text/plain; charset=utf-8">console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default []\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log', {
      stdout: '[]',
      exitCode: 0,
    });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /eslint:skipped reason=no-target-files/u);
    assert.ok(!fs.existsSync(eslintLogPath));
  });

  /**
   * data-src と data-type は script の src/type 属性として扱わず、inline script を ESLint 対象に含めること。
   * @returns 返り値はない。
   */
  test('Lints inline scripts when only data-src and data-type are present', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script data-src="virtual.js" data-type="text/plain">console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default []\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log');

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, htmlFilePath),
      '--execute',
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /eslint:failed exitCode=1/u);
    assert.ok(fs.existsSync(eslintLogPath));
  });

  /**
   * save/file で .js ファイルと非 JavaScript inline script を含む HTML が混在しても、.js だけを ESLint 対象にすること。
   * @returns 返り値はない。
   */
  test('Lints direct JavaScript files while skipping non JavaScript inline HTML scripts', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const javascriptFilePath = path.join(sourceDirectory, 'main.js');
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const prettierLogPath = path.join(nodeBinDirectory, 'prettier.log');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-mixed-negative.sarif');
    const eslintOutput = JSON.stringify([
      {
        filePath: javascriptFilePath,
        messages: [
          {
            ruleId: 'semi',
            severity: 2,
            message: 'Missing semicolon.',
            line: 1,
            column: 17,
          },
        ],
      },
    ]);

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script type="text/plain; charset=utf-8">console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(javascriptFilePath, 'const sample = 1\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default []\n', 'utf8');
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log', { stdout: '[]', exitCode: 0 });
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log', { stdout: eslintOutput, exitCode: 1 });

    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      [
        path.relative(temporaryDirectory, javascriptFilePath),
        path.relative(temporaryDirectory, htmlFilePath),
      ].join(','),
      '--execute',
      '--sarif-output',
      path.relative(temporaryDirectory, sarifOutputPath),
    ]);

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /eslint:failed exitCode=1/u);
    assert.match(result.stdout, /Missing semicolon\./u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /main\.js/u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /index\.html/u);

    const eslintLog = fs.readFileSync(eslintLogPath, 'utf8');
    assert.match(eslintLog, /main\.js/u);
    assert.doesNotMatch(eslintLog, /index\.html/u);
    assert.doesNotMatch(eslintLog, /inline-/u);

    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /main\.js/u);
    assert.doesNotMatch(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
  });

  /**
   * Git hooks をインストールできること。
   * @returns 返り値はない。
   */
  test('Installs managed pre-commit and pre-push hooks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = path.join(temporaryDirectory, '.git', 'hooks');
    const preCommitHookPath = path.join(hooksDirectory, 'pre-commit');
    const prePushHookPath = path.join(hooksDirectory, 'pre-push');

    fs.mkdirSync(hooksDirectory, { recursive: true });

    const result = runMamoriCli(temporaryDirectory, ['hooks', 'install']);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: hooks install completed/u);
    assert.match(result.stdout, /pre-commit/u);
    assert.match(result.stdout, /pre-push/u);
    assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
    assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /--mode precommit --scope staged --execute/u);
    assert.match(fs.readFileSync(prePushHookPath, 'utf8'), /--mode prepush --scope workspace --execute/u);
  });

  /**
   * Mamori 管理下の Git hooks をアンインストールできること。
   * @returns 返り値はない。
   */
  test('Uninstalls only Mamori managed hooks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const hooksDirectory = path.join(temporaryDirectory, '.git', 'hooks');
    const preCommitHookPath = path.join(hooksDirectory, 'pre-commit');
    const prePushHookPath = path.join(hooksDirectory, 'pre-push');
    const postCommitHookPath = path.join(hooksDirectory, 'post-commit');

    fs.mkdirSync(hooksDirectory, { recursive: true });

    runMamoriCli(temporaryDirectory, ['hooks', 'install']);
    fs.writeFileSync(postCommitHookPath, '#!/bin/sh\necho custom\n', 'utf8');

    const result = runMamoriCli(temporaryDirectory, ['hooks', 'uninstall']);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: hooks uninstall completed/u);
    assert.ok(!fs.existsSync(preCommitHookPath));
    assert.ok(!fs.existsSync(prePushHookPath));
    assert.ok(fs.existsSync(postCommitHookPath));
  });

  /**
   * Maven の build-definition を抽出できること。
   * @returns 返り値はない。
   */
  test('Extracts Maven build definitions from pom.xml', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>maven-checkstyle-plugin</artifactId>',
        '        <configuration>',
        '          <configLocation>config/checkstyle/checkstyle.xml</configLocation>',
        '        </configuration>',
        '      </plugin>',
        '      <plugin>',
        '        <artifactId>maven-pmd-plugin</artifactId>',
        '        <configuration>',
        '          <rulesets>',
        '            <ruleset>config/pmd/ruleset.xml</ruleset>',
        '          </rulesets>',
        '        </configuration>',
        '      </plugin>',
        '      <plugin>',
        '        <artifactId>spotless-maven-plugin</artifactId>',
        '      </plugin>',
        '      <plugin>',
        '        <artifactId>spotbugs-maven-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'manual',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: build-definition-summary/u);
    assert.match(result.stdout, /maven:/u);
    assert.match(result.stdout, /checkstyleConfig=config\/checkstyle\/checkstyle\.xml/u);
    assert.match(result.stdout, /pmdRulesets=config\/pmd\/ruleset\.xml/u);
    assert.match(result.stdout, /spotless=configured/u);
    assert.match(result.stdout, /spotbugs=configured/u);
  });

  /**
   * Spotless がある Maven モジュールでは formatter として計画されること。
   * @returns 返り値はない。
   */
  test('Includes spotless as an enabled formatter when Maven defines it', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // ソースディレクトリを表す
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>spotless-maven-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-plan/u);
    assert.match(result.stdout, /formatters=spotless:enabled/u);
    assert.match(result.stdout, /mamori: command-plan/u);
    assert.match(result.stdout, /spotless:mvn -q spotless:apply/u);
  });

  /**
   * file scope では Semgrep の対象ファイルをコマンドへ含めること。
   * @returns 返り値はない。
   */
  test('Builds a file-scoped Semgrep command with the target file', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // ソースディレクトリを表す
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    // 対象ファイルパスを表す
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>maven-checkstyle-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--files',
      path.relative(temporaryDirectory, targetFilePath),
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /semgrep:semgrep scan --sarif --config p\/java/u);
    assert.match(result.stdout, /App\.java/u);
  });

  /**
   * execute オプションで command plan を実行できること。
   * @returns 返り値はない。
   */
  test('Executes the command plan with test command wrappers', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-test.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenIssueWrapper(binDirectory, 'mvn.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-result/u);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /spotless:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Missing Javadoc/u);
    assert.match(result.stdout, /Unused local variable/u);
    assert.match(result.stdout, /Potential issue/u);
    assert.match(result.stdout, /sarif=/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn.log'), 'utf8'), /spotless:apply/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'semgrep.log'), 'utf8'), /App\.java/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"version": "2\.1\.0"/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing Javadoc/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Unused local variable/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Potential issue/u);
  });

  /**
   * save で生成された PMD 既定レポートから finding を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Loads PMD findings from generated Maven report files during save checks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-test.sarif');
    const semgrepLogPath = path.join(binDirectory, 'semgrep-pmd-report.log');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenPmdReportWrapper(binDirectory, 'mvn-pmd-report.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-pmd-report.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-result/u);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Missing Javadoc/u);
    assert.match(result.stdout, /Unused local variable/u);
    assert.match(fs.readFileSync(semgrepLogPath, 'utf8'), /App\.java/u);
    assert.ok(fs.existsSync(path.join(temporaryDirectory, 'target', 'pmd.xml')));
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Unused local variable/u);
  });

  /**
   * save で生成された Checkstyle 既定レポートから finding を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Loads Checkstyle findings from generated Maven report files during save checks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-checkstyle-report.sarif');
    const semgrepLogPath = path.join(binDirectory, 'semgrep-checkstyle-report.log');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenCheckstyleReportWrapper(binDirectory, 'mvn-checkstyle-report.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-checkstyle-report.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-result/u);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Missing Javadoc/u);
    assert.match(result.stdout, /Unused local variable/u);
    assert.match(fs.readFileSync(semgrepLogPath, 'utf8'), /App\.java/u);
    assert.ok(fs.existsSync(path.join(temporaryDirectory, 'target', 'checkstyle-result.xml')));
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing Javadoc/u);
  });

  /**
   * pre-commit で Web formatter 成功後に既存ロジックで再ステージされること。
   * @returns 返り値はない。
   */
  test('Restages web files after successful precommit formatting', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const javascriptFilePath = path.join(sourceDirectory, 'main.js');
    const gitBinDirectory = createCommandBinDirectory(temporaryDirectory);
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const gitLogPath = path.join(gitBinDirectory, 'git.log');
    const prettierLogPath = path.join(nodeBinDirectory, 'prettier.log');
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const indexSnapshotPath = path.join(temporaryDirectory, '.tmp-index', 'main.js');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'const sample = 1;\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    writeGitPrecommitWrapper(
      gitBinDirectory,
      'git.log',
      path.relative(temporaryDirectory, javascriptFilePath),
      javascriptFilePath,
      indexSnapshotPath,
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log', { formattedFilePath: javascriptFilePath });
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(gitBinDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /prettier:ok/u);
    assert.match(result.stdout, /eslint:ok/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /diff --cached --name-only --diff-filter=ACMR/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /add --/u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /main\.js/u);
    assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /main\.js/u);
    assert.match(fs.readFileSync(indexSnapshotPath, 'utf8'), /formatted by prettier/u);
  });

  /**
   * pre-commit の Web checker 失敗時にも整形結果を再ステージしつつ gate できること。
   * @returns 返り値はない。
   */
  test('Fails precommit when web checkers report findings after formatting', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src');
    const javascriptFilePath = path.join(sourceDirectory, 'main.js');
    const gitBinDirectory = createCommandBinDirectory(temporaryDirectory);
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const gitLogPath = path.join(gitBinDirectory, 'git.log');
    const indexSnapshotPath = path.join(temporaryDirectory, '.tmp-index', 'main.js');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-web-precommit.sarif');
    const eslintOutput = JSON.stringify([
      {
        filePath: javascriptFilePath,
        messages: [
          {
            ruleId: 'semi',
            severity: 2,
            message: 'Missing semicolon.',
            line: 1,
            column: 17,
          },
        ],
      },
    ]);

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(javascriptFilePath, 'const sample = 1\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    writeGitPrecommitWrapper(
      gitBinDirectory,
      'git.log',
      path.relative(temporaryDirectory, javascriptFilePath),
      javascriptFilePath,
      indexSnapshotPath,
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log', { formattedFilePath: javascriptFilePath });
    writeWebCommandWrapper(nodeBinDirectory, 'eslint', 'eslint.log', { stdout: eslintOutput, exitCode: 1 });

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(gitBinDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /prettier:ok/u);
    assert.match(result.stdout, /eslint:failed exitCode=1/u);
    assert.match(result.stdout, /Missing semicolon\./u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /add --/u);
    assert.match(fs.readFileSync(indexSnapshotPath, 'utf8'), /formatted by prettier/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing semicolon\./u);
  });

  /**
   * pre-commit の staged HTML で inline script 診断を元 HTML に逆写像し、整形結果を再ステージすること。
   * @returns 返り値はない。
   */
  test('Restages staged HTML files and maps inline ESLint findings back to the source file', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const gitBinDirectory = createCommandBinDirectory(temporaryDirectory);
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const gitLogPath = path.join(gitBinDirectory, 'git.log');
    const prettierLogPath = path.join(nodeBinDirectory, 'prettier.log');
    const eslintLogPath = path.join(nodeBinDirectory, 'eslint.log');
    const htmlhintLogPath = path.join(nodeBinDirectory, 'htmlhint.log');
    const indexSnapshotPath = path.join(temporaryDirectory, '.tmp-index', 'public', 'index.html');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-html-precommit.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<script>console.log("sample")</script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeGitPrecommitWrapper(
      gitBinDirectory,
      'git.log',
      path.relative(temporaryDirectory, htmlFilePath),
      htmlFilePath,
      indexSnapshotPath,
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log', { formattedFilePath: htmlFilePath });
    writeInlineHtmlEslintWrapper(nodeBinDirectory, 'eslint.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(gitBinDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /prettier:ok/u);
    assert.match(result.stdout, /eslint:failed exitCode=1/u);
    assert.match(result.stdout, /htmlhint:ok/u);
    assert.match(result.stdout, /Inline script finding\./u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /diff --cached --name-only --diff-filter=ACMR/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /add --/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /public[\\/]index\.html/u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(htmlhintLogPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(indexSnapshotPath, 'utf8'), /formatted by prettier/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startColumn": 9/u);

    const eslintLog = fs.readFileSync(eslintLogPath, 'utf8');
    const targetMatch = eslintLog.match(/TARGET=(.+)\r?\n/u);
    assert.ok(targetMatch);
    assert.doesNotMatch(eslintLog, /index\.html/u);
    assert.match(eslintLog, /TARGET=.*\.js/u);
    const temporaryInlineScriptPath = targetMatch ? targetMatch[1].trim() : '';
    assert.notStrictEqual(temporaryInlineScriptPath, '');
    assert.ok(!fs.existsSync(temporaryInlineScriptPath));
  });

  /**
   * pre-commit の staged HTML で inline style 診断を元 HTML に逆写像し、整形結果を再ステージすること。
   * @returns 返り値はない。
   */
  test('Restages staged HTML files and maps inline Stylelint findings back to the source file', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const htmlDirectory = path.join(temporaryDirectory, 'public');
    const htmlFilePath = path.join(htmlDirectory, 'index.html');
    const gitBinDirectory = createCommandBinDirectory(temporaryDirectory);
    const nodeBinDirectory = createNodeModulesBinDirectory(temporaryDirectory);
    const gitLogPath = path.join(gitBinDirectory, 'git.log');
    const prettierLogPath = path.join(nodeBinDirectory, 'prettier.log');
    const stylelintLogPath = path.join(nodeBinDirectory, 'stylelint.log');
    const htmlhintLogPath = path.join(nodeBinDirectory, 'htmlhint.log');
    const indexSnapshotPath = path.join(temporaryDirectory, '.tmp-index', 'public', 'index.html');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-inline-style-precommit.sarif');

    fs.mkdirSync(htmlDirectory, { recursive: true });
    fs.writeFileSync(
      htmlFilePath,
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<style>body { color: #12; }</style>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(temporaryDirectory, 'stylelint.config.mjs'), 'export default {};\n', 'utf8');
    fs.writeFileSync(path.join(temporaryDirectory, '.htmlhintrc'), '{"tag-pair": true}\n', 'utf8');
    writeGitPrecommitWrapper(
      gitBinDirectory,
      'git.log',
      path.relative(temporaryDirectory, htmlFilePath),
      htmlFilePath,
      indexSnapshotPath,
    );
    writeWebCommandWrapper(nodeBinDirectory, 'prettier', 'prettier.log', { formattedFilePath: htmlFilePath });
    writeInlineHtmlStylelintWrapper(nodeBinDirectory, 'stylelint.log');
    writeWebCommandWrapper(nodeBinDirectory, 'htmlhint', 'htmlhint.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(gitBinDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 1);
    assert.match(result.stdout, /prettier:ok/u);
    assert.match(result.stdout, /stylelint:failed exitCode=2/u);
    assert.match(result.stdout, /htmlhint:ok/u);
    assert.match(result.stdout, /Unexpected invalid hex color/u);
    assert.match(result.stdout, /index\.html:4/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /diff --cached --name-only --diff-filter=ACMR/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /add --/u);
    assert.match(fs.readFileSync(gitLogPath, 'utf8'), /public[\\/]index\.html/u);
    assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(htmlhintLogPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(indexSnapshotPath, 'utf8'), /formatted by prettier/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /index\.html/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startLine": 4/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /"startColumn": 8/u);

    const stylelintLog = fs.readFileSync(stylelintLogPath, 'utf8');
    const targetMatch = stylelintLog.match(/TARGET=(.+)\r?\n/u);
    assert.ok(targetMatch);
    assert.doesNotMatch(stylelintLog, /index\.html/u);
    assert.match(stylelintLog, /TARGET=.*\.css/u);
    const temporaryInlineStylePath = targetMatch ? targetMatch[1].trim() : '';
    assert.notStrictEqual(temporaryInlineStylePath, '');
    assert.ok(!fs.existsSync(temporaryInlineStylePath));
  });

  /**
   * 実行コマンドが存在しない場合は実行エラーとして扱うこと。
   * @returns 返り値はない。
   */
  test('Returns exit code 2 when an execution command cannot start', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenIssueWrapper(binDirectory, 'mvn.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 2);
    assert.match(result.stdout, /semgrep:error/u);
    assert.match(result.stdout, /failed to start/u);
  });

  /**
   * pre-commit 実行で軽量チェックのみを実行し、Issue を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Executes precommit Maven staged-scope plan and re-stages formatted files from git index', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const unstagedFilePath = path.join(sourceDirectory, 'Other.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-precommit.sarif');
    const gitIndexSnapshotPath = path.join(temporaryDirectory, 'git-index-App.java');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(unstagedFilePath, 'class Other {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenPrecommitGitWrapper(binDirectory, 'mvn-precommit.log', targetFilePath);
    writeGitPrecommitWrapper(
      binDirectory,
      'git-precommit.log',
      path.relative(temporaryDirectory, targetFilePath),
      targetFilePath,
      gitIndexSnapshotPath,
    );
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-precommit.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'precommit',
        '--scope',
        'staged',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-result/u);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /spotless:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /files=.*App\.java/u);
    assert.doesNotMatch(result.stdout, /files=.*Other\.java/u);
    assert.doesNotMatch(result.stdout, /cpd:ok/u);
    assert.doesNotMatch(result.stdout, /spotbugs:ok/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-precommit.log'), 'utf8'), /checkstyle:check/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-precommit.log'), 'utf8'), /pmd:check/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-precommit.log'), 'utf8'), /spotless:apply/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'semgrep-precommit.log'), 'utf8'), /scan --sarif/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'semgrep-precommit.log'), 'utf8'), /App\.java/u);
    assert.doesNotMatch(fs.readFileSync(path.join(binDirectory, 'semgrep-precommit.log'), 'utf8'), /Other\.java/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /diff --cached --name-only --diff-filter=ACMR/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /add --/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /App\.java/u);
    assert.doesNotMatch(fs.readFileSync(path.join(binDirectory, 'git-precommit.log'), 'utf8'), /Other\.java/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing Javadoc/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Unused local variable/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Potential issue/u);
    assert.match(fs.readFileSync(targetFilePath, 'utf8'), /formatted by spotless/u);
    assert.match(fs.readFileSync(gitIndexSnapshotPath, 'utf8'), /formatted by spotless/u);
  });

  /**
   * pre-push で class ルートが無い場合は SpotBugs を警告付きでスキップ計画にすること。
   * @returns 返り値はない。
   */
  test('Marks spotbugs as skipped when prepush workspace has no class roots', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // pom.xml の絶対パスを表す
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');

    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin>',
        '        <artifactId>maven-checkstyle-plugin</artifactId>',
        '      </plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'prepush',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: execution-plan/u);
    assert.match(result.stdout, /spotbugs:disabled status=skipped/u);
    assert.match(
      result.stdout,
      /spotbugs was skipped because no compiled classes were found in target\/classes or build\/classes\/java\/main/u,
    );
  });

  /**
   * Gradle の build-definition を抽出できること。
   * @returns 返り値はない。
   */
  test('Extracts Gradle build definitions from build.gradle', () => {
    // 一時ディレクトリを表す
    const temporaryDirectory = createTemporaryDirectory();
    // Gradle ビルドファイルの絶対パスを表す
    const buildFilePath = path.join(temporaryDirectory, 'build.gradle');

    fs.writeFileSync(
      buildFilePath,
      [
        'plugins {',
        '  id "checkstyle"',
        '  id "pmd"',
        '  id "com.diffplug.spotless" version "6.0.0"',
        '}',
        '',
        'checkstyle {',
        '  configFile = file("config/checkstyle/checkstyle.xml")',
        '}',
        '',
        'pmd {',
        '  ruleSetFiles = files("config/pmd/ruleset.xml")',
        '}',
        '',
        'spotbugs {',
        '  excludeFilter = file("config/spotbugs/exclude.xml")',
        '}',
        '',
        'spotless {',
        '  java {}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    // CLI 実行結果を表す
    const result = runMamoriCli(temporaryDirectory, [
      'run',
      '--mode',
      'manual',
      '--scope',
      'workspace',
    ]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: build-definition-summary/u);
    assert.match(result.stdout, /gradle:/u);
    assert.match(result.stdout, /checkstyleConfig=config\/checkstyle\/checkstyle\.xml/u);
    assert.match(result.stdout, /pmdRulesets=config\/pmd\/ruleset\.xml/u);
    assert.match(result.stdout, /spotless=configured/u);
    assert.match(result.stdout, /spotbugs=configured/u);
    assert.match(result.stdout, /spotbugsExcludeFilter=config\/spotbugs\/exclude\.xml/u);
  });

  /**
   * Gradle 実行でも Checkstyle / PMD / Semgrep を Issue 化できること。
   * @returns 返り値はない。
   */
  test('Executes Gradle command plan and collects issues through shared adapters', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const buildFilePath = path.join(temporaryDirectory, 'build.gradle');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-gradle.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      buildFilePath,
      [
        'plugins {',
        '  id "checkstyle"',
        '  id "pmd"',
        '  id "com.diffplug.spotless" version "6.0.0"',
        '}',
        '',
        'checkstyle {',
        '  configFile = file("config/checkstyle/checkstyle.xml")',
        '}',
        '',
        'pmd {',
        '  ruleSetFiles = files("config/pmd/ruleset.xml")',
        '}',
        '',
        'spotless {',
        '  java {}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    writeGradleIssueWrapper(binDirectory, 'gradle.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-gradle.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'save',
        '--scope',
        'file',
        '--files',
        path.relative(temporaryDirectory, targetFilePath),
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.match(result.stdout, /spotless:ok exitCode=0/u);
    assert.match(result.stdout, /semgrep:ok exitCode=0/u);
    assert.match(result.stdout, /issues=3/u);
    assert.match(result.stdout, /Gradle Checkstyle finding/u);
    assert.match(result.stdout, /Gradle PMD finding/u);
    assert.match(result.stdout, /Potential issue/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'gradle.log'), 'utf8'), /spotlessApply/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Gradle Checkstyle finding/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Gradle PMD finding/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Potential issue/u);
  });

  /**
   * pre-push 実行で CPD と SpotBugs を Issue 化できること。
   * @returns 返り値はない。
   */
  test('Executes prepush Maven plan and collects CPD and SpotBugs issues', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const classDirectory = path.join(temporaryDirectory, 'target', 'classes');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-prepush.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.mkdirSync(classDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'App.java'), 'class App {}\n', 'utf8');
    fs.writeFileSync(path.join(sourceDirectory, 'Other.java'), 'class Other {}\n', 'utf8');
    fs.writeFileSync(path.join(classDirectory, 'App.class'), 'compiled', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotbugs-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenPrepushWrapper(binDirectory, 'mvn-prepush.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-prepush.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'prepush',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /cpd:ok exitCode=0/u);
    assert.match(result.stdout, /spotbugs:ok exitCode=0/u);
    assert.match(result.stdout, /Duplicated block detected/u);
    assert.match(result.stdout, /Possible null pointer dereference/u);
    assert.match(result.stdout, /issues=4/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-prepush.log'), 'utf8'), /spotbugs:check/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Duplicated block detected/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Possible null pointer dereference/u);
  });

  /**
   * pre-push 実行で Checkstyle finding が SARIF に含まれること。
   * @returns 返り値はない。
   */
  test('Includes Checkstyle findings in prepush Maven SARIF output', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const classDirectory = path.join(temporaryDirectory, 'target', 'classes');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-prepush-checkstyle.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.mkdirSync(classDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'App.java'), 'class App {}\n', 'utf8');
    fs.writeFileSync(path.join(sourceDirectory, 'Other.java'), 'class Other {}\n', 'utf8');
    fs.writeFileSync(path.join(classDirectory, 'App.class'), 'compiled', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotbugs-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenPrepushCheckstyleWrapper(binDirectory, 'mvn-prepush-checkstyle.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-prepush-checkstyle.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'prepush',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Missing Javadoc/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'mvn-prepush-checkstyle.log'), 'utf8'), /checkstyle:check/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Missing Javadoc/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /JavadocTypeCheck/u);
  });

  /**
   * pre-push で生成された CPD と SpotBugs の既定レポートから finding を SARIF 化できること。
   * @returns 返り値はない。
   */
  test('Loads CPD and SpotBugs findings from generated Maven report files during prepush checks', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const classDirectory = path.join(temporaryDirectory, 'target', 'classes');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-prepush-report-files.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.mkdirSync(classDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'App.java'), 'class App {}\n', 'utf8');
    fs.writeFileSync(path.join(sourceDirectory, 'Other.java'), 'class Other {}\n', 'utf8');
    fs.writeFileSync(path.join(classDirectory, 'App.class'), 'compiled', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>',
        '      <plugin><artifactId>spotbugs-maven-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeMavenPrepushReportWrapper(binDirectory, 'mvn-prepush-report-files.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-prepush-report-files.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'prepush',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /cpd:ok exitCode=0/u);
    assert.match(result.stdout, /spotbugs:ok exitCode=0/u);
    assert.match(result.stdout, /Duplicated block detected/u);
    assert.match(result.stdout, /Possible null pointer dereference/u);
    assert.match(result.stdout, /issues=4/u);
    assert.ok(fs.existsSync(path.join(temporaryDirectory, 'target', 'cpd.xml')));
    assert.ok(fs.existsSync(path.join(temporaryDirectory, 'target', 'spotbugsXml.xml')));
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Duplicated block detected/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Possible null pointer dereference/u);
  });

  /**
   * Gradle の pre-push 実行でも CPD と SpotBugs を Issue 化できること。
   * @returns 返り値はない。
   */
  test('Executes Gradle prepush plan and collects CPD and SpotBugs issues', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const classDirectory = path.join(temporaryDirectory, 'build', 'classes', 'java', 'main');
    const buildFilePath = path.join(temporaryDirectory, 'build.gradle');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-gradle-prepush.sarif');

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.mkdirSync(classDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'App.java'), 'class App {}\n', 'utf8');
    fs.writeFileSync(path.join(sourceDirectory, 'Other.java'), 'class Other {}\n', 'utf8');
    fs.writeFileSync(path.join(classDirectory, 'App.class'), 'compiled', 'utf8');
    fs.writeFileSync(
      buildFilePath,
      [
        'plugins {',
        '  id "checkstyle"',
        '  id "pmd"',
        '  id "com.diffplug.spotless" version "6.0.0"',
        '  id "com.github.spotbugs" version "6.0.18"',
        '}',
        '',
        'checkstyle {',
        '  configFile = file("config/checkstyle/checkstyle.xml")',
        '}',
        '',
        'pmd {',
        '  ruleSetFiles = files("config/pmd/ruleset.xml")',
        '}',
        '',
        'spotless {',
        '  java {}',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    writeGradlePrepushWrapper(binDirectory, 'gradle-prepush.log');
    writeSemgrepSarifWrapper(binDirectory, 'semgrep-gradle-prepush.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'prepush',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /cpd:ok exitCode=0/u);
    assert.match(result.stdout, /spotbugs:ok exitCode=0/u);
    assert.match(result.stdout, /Duplicated block detected/u);
    assert.match(result.stdout, /Dead store to local variable/u);
    assert.match(result.stdout, /Potential issue/u);
    assert.match(result.stdout, /issues=4/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'gradle-prepush.log'), 'utf8'), /cpdCheck/u);
    assert.match(fs.readFileSync(path.join(binDirectory, 'gradle-prepush.log'), 'utf8'), /spotbugsMain/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Duplicated block detected/u);
    assert.match(fs.readFileSync(sarifOutputPath, 'utf8'), /Dead store to local variable/u);
  });

  /**
   * setup で管理対象ツールを `.mamori` 配下へ導入できること。
   * @returns 返り値はない。
   */
  test('Sets up managed tools into the workspace cache directories', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const mavenSourceDirectory = createManagedToolSourceDirectory(
      temporaryDirectory,
      'maven-distribution',
      'mvn',
      'maven-setup.log',
    );
    const gradleSourceDirectory = createManagedToolSourceDirectory(
      temporaryDirectory,
      'gradle-distribution',
      'gradle',
      'gradle-setup.log',
    );

    writeNpmInstallWrapper(binDirectory, 'npm-setup.log');
    writeCommandWrapper(binDirectory, 'semgrep', 'semgrep-setup.log');

    const semgrepCommandPath = path.join(
      binDirectory,
      process.platform === 'win32' ? 'semgrep.cmd' : 'semgrep',
    );

    const result = runMamoriCli(
      temporaryDirectory,
      ['setup'],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
          MAMORI_TOOL_MAVEN_SOURCE_URL: toFileUrl(mavenSourceDirectory),
          MAMORI_TOOL_GRADLE_SOURCE_URL: toFileUrl(gradleSourceDirectory),
          MAMORI_TOOL_SEMGREP_COMMAND: semgrepCommandPath,
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /mamori: setup completed/u);
    assert.ok(fs.existsSync(path.join(temporaryDirectory, '.mamori', 'tools', 'maven', '3.9.11', 'bin')));
    assert.ok(fs.existsSync(path.join(temporaryDirectory, '.mamori', 'tools', 'gradle', '8.14.4', 'bin')));
    assert.ok(fs.existsSync(path.join(
      temporaryDirectory,
      '.mamori',
      'node',
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'eslint.cmd' : 'eslint',
    )));
    assert.ok(fs.existsSync(path.join(
      temporaryDirectory,
      '.mamori',
      'node',
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'prettier.cmd' : 'prettier',
    )));
    assert.match(fs.readFileSync(path.join(binDirectory, 'npm-setup.log'), 'utf8'), /install/u);
  });

  /**
   * mvn が存在しないときに管理配布物を自動導入して実行できること。
   * @returns 返り値はない。
   */
  test('Auto provisions Maven when mvn is not available', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const pomFilePath = path.join(temporaryDirectory, 'pom.xml');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-auto-maven.sarif');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const mavenSourceDirectory = createManagedToolSourceDirectory(
      temporaryDirectory,
      'maven-auto-distribution',
      'mvn',
      'maven-auto.log',
    );

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      pomFilePath,
      [
        '<project>',
        '  <build>',
        '    <plugins>',
        '      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>',
        '      <plugin><artifactId>maven-pmd-plugin</artifactId></plugin>',
        '    </plugins>',
        '  </build>',
        '</project>',
        '',
      ].join('\n'),
      'utf8',
    );
    writeCommandWrapper(binDirectory, 'semgrep', 'semgrep-auto-maven.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'manual',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: binDirectory,
          MAMORI_TOOL_MAVEN_SOURCE_URL: toFileUrl(mavenSourceDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(
      fs.readFileSync(
        path.join(temporaryDirectory, '.mamori', 'tools', 'maven', '3.9.11', 'bin', 'maven-auto.log'),
        'utf8',
      ),
      /checkstyle:check/u,
    );
    assert.match(
      fs.readFileSync(
        path.join(temporaryDirectory, '.mamori', 'tools', 'maven', '3.9.11', 'bin', 'maven-auto.log'),
        'utf8',
      ),
      /pmd:check/u,
    );
  });

  /**
   * gradle が存在しないときに管理配布物を自動導入して実行できること。
   * @returns 返り値はない。
   */
  test('Auto provisions Gradle when gradle is not available', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const sourceDirectory = path.join(temporaryDirectory, 'src', 'main', 'java');
    const targetFilePath = path.join(sourceDirectory, 'App.java');
    const buildFilePath = path.join(temporaryDirectory, 'build.gradle');
    const sarifOutputPath = path.join(temporaryDirectory, '.mamori', 'out', 'combined-auto-gradle.sarif');
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const gradleSourceDirectory = createManagedToolSourceDirectory(
      temporaryDirectory,
      'gradle-auto-distribution',
      'gradle',
      'gradle-auto.log',
    );

    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(targetFilePath, 'class App {}\n', 'utf8');
    fs.writeFileSync(
      buildFilePath,
      [
        'plugins {',
        '  id "checkstyle"',
        '  id "pmd"',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    writeCommandWrapper(binDirectory, 'semgrep', 'semgrep-auto-gradle.log');

    const result = runMamoriCli(
      temporaryDirectory,
      [
        'run',
        '--mode',
        'manual',
        '--scope',
        'workspace',
        '--execute',
        '--sarif-output',
        path.relative(temporaryDirectory, sarifOutputPath),
      ],
      {
        env: {
          ...process.env,
          PATH: binDirectory,
          MAMORI_TOOL_GRADLE_SOURCE_URL: toFileUrl(gradleSourceDirectory),
        },
      },
    );

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /checkstyle:ok exitCode=0/u);
    assert.match(result.stdout, /pmd:ok exitCode=0/u);
    assert.ok(fs.existsSync(sarifOutputPath));
    assert.match(
      fs.readFileSync(
        path.join(temporaryDirectory, '.mamori', 'tools', 'gradle', '8.14.4', 'bin', 'gradle-auto.log'),
        'utf8',
      ),
      /checkstyleMain/u,
    );
    assert.match(
      fs.readFileSync(
        path.join(temporaryDirectory, '.mamori', 'tools', 'gradle', '8.14.4', 'bin', 'gradle-auto.log'),
        'utf8',
      ),
      /pmdMain/u,
    );
  });

  /**
   * cache-clear で管理キャッシュを削除できること。
   * @returns 返り値はない。
   */
  test('Clears managed tool caches from the workspace', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const binDirectory = createCommandBinDirectory(temporaryDirectory);
    const mavenSourceDirectory = createManagedToolSourceDirectory(
      temporaryDirectory,
      'maven-cache-clear-distribution',
      'mvn',
      'maven-cache-clear.log',
    );
    const gradleSourceDirectory = createManagedToolSourceDirectory(
      temporaryDirectory,
      'gradle-cache-clear-distribution',
      'gradle',
      'gradle-cache-clear.log',
    );

    writeNpmInstallWrapper(binDirectory, 'npm-cache-clear.log');
    writeCommandWrapper(binDirectory, 'semgrep', 'semgrep-cache-clear.log');

    const semgrepCommandPath = path.join(
      binDirectory,
      process.platform === 'win32' ? 'semgrep.cmd' : 'semgrep',
    );

    const setupResult = runMamoriCli(
      temporaryDirectory,
      ['setup'],
      {
        env: {
          ...process.env,
          PATH: buildTestPath(binDirectory),
          MAMORI_TOOL_MAVEN_SOURCE_URL: toFileUrl(mavenSourceDirectory),
          MAMORI_TOOL_GRADLE_SOURCE_URL: toFileUrl(gradleSourceDirectory),
          MAMORI_TOOL_SEMGREP_COMMAND: semgrepCommandPath,
        },
      },
    );

    assert.strictEqual(setupResult.status, 0);
    assert.ok(fs.existsSync(path.join(temporaryDirectory, '.mamori', 'tools')));
    assert.ok(fs.existsSync(path.join(temporaryDirectory, '.mamori', 'node')));

    const cacheClearResult = runMamoriCli(temporaryDirectory, ['cache-clear']);
    assert.strictEqual(cacheClearResult.status, 0);
    assert.match(cacheClearResult.stdout, /mamori: cache-clear completed/u);
    assert.ok(!fs.existsSync(path.join(temporaryDirectory, '.mamori', 'tools')));
    assert.ok(!fs.existsSync(path.join(temporaryDirectory, '.mamori', 'node')));
  });
});