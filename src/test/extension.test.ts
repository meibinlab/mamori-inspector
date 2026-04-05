// 断言ユーティリティを表す
import * as assert from 'assert';
// 子プロセス同期実行 API を表す
import { spawnSync } from 'child_process';
// ファイルシステム API を表す
import * as fs from 'fs';
// OS 固有 API を表す
import * as os from 'os';
// パス操作 API を表す
import * as path from 'path';
// hooks 通知補助関数を表す
import { reportHooksCommandSuccess } from '../hooks-command-report';
// SARIF 読み込み関数を表す
import { loadSarifFindings } from '../sarif-diagnostics';

/** VS Code API 型を表す。 */
type VscodeModule = typeof import('vscode');
/** VS Code ワークスペースフォルダー型を表す。 */
type VscodeWorkspaceFolder = import('vscode').WorkspaceFolder;

// 保存時の SARIF 出力先を表す
const SAVE_SARIF_OUTPUT = path.join('.mamori', 'out', 'combined-save.sarif');
// 保存時統合テストの待機上限を表す
const DEFAULT_TIMEOUT_MILLISECONDS = 10000;
// 待機時のポーリング間隔を表す
const POLLING_INTERVAL_MILLISECONDS = 100;

/**
 * 条件が成立するまで待機する。
 * @param predicate 成立判定を表す。
 * @param timeoutMilliseconds タイムアウト時間を表す。
 * @returns 条件成立まで待つ Promise を返す。
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds: number = DEFAULT_TIMEOUT_MILLISECONDS,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, POLLING_INTERVAL_MILLISECONDS);
    });
  }

  throw new Error(`Timed out after ${timeoutMilliseconds}ms`);
}

/**
 * 指定時間だけ待機する。
 * @param milliseconds 待機時間を表す。
 * @returns 待機完了を待つ Promise を返す。
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * 指定ワークスペース配下の Diagnostics 総件数を返す。
 * @param vscodeApi VS Code API を表す。
 * @param workspaceRoot 対象ワークスペースルートを表す。
 * @returns Diagnostics 総件数を返す。
 */
function countWorkspaceDiagnostics(vscodeApi: VscodeModule, workspaceRoot: string): number {
  return vscodeApi.languages.getDiagnostics().reduce((count, [uri, diagnostics]) => {
    return uri.fsPath.startsWith(workspaceRoot) ? count + diagnostics.length : count;
  }, 0);
}

/**
 * 診断件数反映通知の検証用正規表現を返す。
 * @param diagnosticsCount 診断件数を表す。
 * @returns 英日どちらの通知文言にも一致する正規表現を返す。
 */
function getDiagnosticsReflectedPattern(diagnosticsCount: number): RegExp {
  return new RegExp(
    `(?:Mamori Inspector: Reflected ${diagnosticsCount} diagnostics\\.|${diagnosticsCount} 件の問題を反映しました。)`,
    'u',
  );
}

/**
 * VS Code API を安全に読み込む。
 * @returns 読み込めた場合は VS Code API を返す。
 */
function loadVscode(): VscodeModule | undefined {
  try {
    return require('vscode') as VscodeModule;
  } catch {
    return undefined;
  }
}

/**
 * テスト用にワークスペース単位の Mamori 有効化設定を更新する。
 * @param vscodeApi VS Code API を表す。
 * @param enabled 設定する有効状態を表す。
 * @returns 更新完了を待つ Promise を返す。
 */
async function setWorkspaceMamoriEnabled(
  vscodeApi: VscodeModule,
  enabled: boolean | undefined,
): Promise<void> {
  const workspaceFolder = vscodeApi.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  await updateWorkspaceMamoriEnabledSetting(vscodeApi, workspaceFolder.uri.fsPath, enabled);
}

/**
 * 指定パスに対応するワークスペースフォルダーを返す。
 * @param vscodeApi VS Code API を表す。
 * @param workspaceRoot 対象ワークスペースルートを表す。
 * @returns 対応するワークスペースフォルダーを返す。
 */
function findWorkspaceFolderByPath(
  vscodeApi: VscodeModule,
  workspaceRoot: string,
): VscodeWorkspaceFolder | undefined {
  return vscodeApi.workspace.workspaceFolders?.find(
    (workspaceFolder) => workspaceFolder.uri.fsPath === workspaceRoot,
  );
}

/**
 * ワークスペース設定 API を使って Mamori 有効化設定を更新する。
 * @param vscodeApi VS Code API を表す。
 * @param workspaceRoot 対象ワークスペースルートを表す。
 * @param enabled 設定する有効状態を表す。
 * @returns 更新完了を待つ Promise を返す。
 */
async function updateWorkspaceMamoriEnabledSetting(
  vscodeApi: VscodeModule,
  workspaceRoot: string,
  enabled: boolean | undefined,
): Promise<void> {
  const workspaceFolder = findWorkspaceFolderByPath(vscodeApi, workspaceRoot);
  if (workspaceFolder) {
    try {
      await vscodeApi.workspace.getConfiguration('mamori-inspector', workspaceFolder.uri).update(
        'enabled',
        enabled,
        vscodeApi.ConfigurationTarget.WorkspaceFolder,
      );
      return;
    } catch (error) {
      if (!(error instanceof Error) || !/no resource is provided/i.test(error.message)) {
        throw error;
      }
    }
  }

  await updateWorkspaceMamoriEnabledSettingFile(workspaceRoot, enabled);
}

/**
 * ワークスペース設定ファイルへ Mamori 有効化設定を書き込む。
 * @param workspaceRoot 対象ワークスペースルートを表す。
 * @param enabled 設定する有効状態を表す。
 * @returns 更新完了を待つ Promise を返す。
 */
async function updateWorkspaceMamoriEnabledSettingFile(
  workspaceRoot: string,
  enabled: boolean | undefined,
): Promise<void> {
  const settingsDirectoryPath = path.join(workspaceRoot, '.vscode');
  const settingsPath = path.join(settingsDirectoryPath, 'settings.json');
  const settings = readJsonObjectFile(settingsPath);

  if (typeof enabled === 'undefined') {
    delete settings['mamori-inspector.enabled'];
  } else {
    settings['mamori-inspector.enabled'] = enabled;
  }

  if (Object.keys(settings).length === 0) {
    fs.rmSync(settingsPath, { force: true });
    return;
  }

  fs.mkdirSync(settingsDirectoryPath, { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/**
 * JSON オブジェクトファイルをコメント許容で読み込む。
 * @param filePath 対象ファイルパスを表す。
 * @returns 読み込んだ JSON オブジェクトを返す。
 */
function readJsonObjectFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(rawContent) as Record<string, unknown>;
  } catch {
    const sanitizedContent = stripJsonComments(rawContent);
    return JSON.parse(sanitizedContent) as Record<string, unknown>;
  }
}

/**
 * JSON 文字列内を壊さずにコメントだけを除去する。
 * @param input コメントを含む JSON 文字列を表す。
 * @returns コメント除去後の JSON 文字列を返す。
 */
function stripJsonComments(input: string): string {
  let result = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let isEscaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const currentCharacter = input[index];
    const nextCharacter = index + 1 < input.length ? input[index + 1] : '';

    if (inLineComment) {
      if (currentCharacter === '\n' || currentCharacter === '\r') {
        inLineComment = false;
        result += currentCharacter;
      }
      continue;
    }

    if (inBlockComment) {
      if (currentCharacter === '*' && nextCharacter === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      result += currentCharacter;
      if (isEscaped) {
        isEscaped = false;
      } else if (currentCharacter === '\\') {
        isEscaped = true;
      } else if (currentCharacter === '"') {
        inString = false;
      }
      continue;
    }

    if (currentCharacter === '"') {
      inString = true;
      result += currentCharacter;
      continue;
    }

    if (currentCharacter === '/' && nextCharacter === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (currentCharacter === '/' && nextCharacter === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += currentCharacter;
  }

  return result;
}

/**
 * 現在の実行パス環境変数を返す。
 * @returns 実行パス文字列を返す。
 */
function getExecutablePathEnvironment(): string {
  return process.env.PATH || process.env.Path || '';
}

/**
 * 実行パス環境変数を更新する。
 * @param value 設定する実行パス文字列を表す。
 * @returns 返り値はない。
 */
function setExecutablePathEnvironment(value: string): void {
  process.env.PATH = value;
  process.env.Path = value;
}

/**
 * 現在の Semgrep コマンド上書き設定を返す。
 * @returns Semgrep コマンド上書き設定を返す。
 */
function getSemgrepCommandOverride(): string | undefined {
  return process.env.MAMORI_TOOL_SEMGREP_COMMAND;
}

/**
 * Semgrep コマンド上書き設定を更新する。
 * @param value 設定するコマンドパスを表す。
 * @returns 返り値はない。
 */
function setSemgrepCommandOverride(value: string | undefined): void {
  if (typeof value === 'string' && value.trim() !== '') {
    process.env.MAMORI_TOOL_SEMGREP_COMMAND = value;
    return;
  }

  delete process.env.MAMORI_TOOL_SEMGREP_COMMAND;
}

/**
 * 外部実プロジェクトのルートパスを解決する。
 * @param vscodeApi VS Code API を表す。
 * @returns 解決できた外部実プロジェクトルートを返す。
 */
function resolveRealProjectRoot(vscodeApi: VscodeModule): string | undefined {
  const environmentRoot = process.env.MAMORI_REAL_PROJECT_ROOT;
  if (environmentRoot && fs.existsSync(environmentRoot)) {
    return environmentRoot;
  }

  const primaryWorkspaceRoot = vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!primaryWorkspaceRoot) {
    return undefined;
  }

  const siblingWorkspaceRoot = path.resolve(
    primaryWorkspaceRoot,
    '..',
    '..',
    'meibinlab-spring-boot-wrapper',
  );
  return fs.existsSync(siblingWorkspaceRoot) ? siblingWorkspaceRoot : undefined;
}

/**
 * hooks コマンドをテスト環境に応じて実行する。
 * @param action hooks 操作種別を表す。
 * @param workspaceRoot ワークスペースルートを表す。
 * @returns 実行完了を待つ Promise を返す。
 */
async function runHooksCommandForTest(
  action: 'install' | 'uninstall',
  workspaceRoot: string,
): Promise<void> {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const cliScriptPath = path.join(repositoryRoot, '.mamori', 'mamori.js');
  const result = spawnSync(process.execPath, [cliScriptPath, 'hooks', action], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `hooks ${action} failed`);
  }
}

/**
 * 保存時モードの CLI コマンドをテスト用に実行する。
 * @param workspaceRoot ワークスペースルートを表す。
 * @param filePath 対象ファイルパスを表す。
 * @param sarifOutputPath SARIF 出力パスを表す。
 * @returns 実行完了を待つ Promise を返す。
 */
async function runSaveCommandForTest(
  workspaceRoot: string,
  filePath: string,
  sarifOutputPath: string,
): Promise<void> {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const cliScriptPath = path.join(repositoryRoot, '.mamori', 'mamori.js');
  const result = spawnSync(
    process.execPath,
    [
      cliScriptPath,
      'run',
      '--mode',
      'save',
      '--scope',
      'file',
      '--execute',
      '--sarif-output',
      sarifOutputPath,
      '--files',
      filePath,
    ],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: process.env,
    },
  );

  if (typeof result.status !== 'number' || result.status > 1) {
    throw new Error(result.stderr || result.stdout || `save command failed for ${filePath}`);
  }
}

/**
 * ワークスペース基準の相対 URI を返す。
 * @param workspacePath ワークスペースパスを表す。
 * @param filePath 対象ファイルパスを表す。
 * @returns SARIF/XML 向けの相対 URI を返す。
 */
function toWorkspaceRelativeUri(workspacePath: string, filePath: string): string {
  return path.relative(workspacePath, filePath).split(path.sep).join('/');
}

/**
 * 実行可能ファイルに権限を付与する。
 * @param filePath 対象ファイルパスを表す。
 * @returns 返り値はない。
 */
function makeExecutable(filePath: string): void {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
}

/**
 * 対象ファイルの復元処理を作成する。
 * @param filePath 対象ファイルパスを表す。
 * @returns 復元関数を返す。
 */
function createRestoreAction(filePath: string): () => void {
  const existed = fs.existsSync(filePath);
  const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mamori-restore-'));
  const backupPath = path.join(backupDirectory, path.basename(filePath));

  if (existed) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(filePath, backupPath);
  }

  return () => {
    if (existed) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.copyFileSync(backupPath, filePath);
    } else {
      fs.rmSync(filePath, { force: true });
    }
    fs.rmSync(backupDirectory, { recursive: true, force: true });
  };
}

/**
 * テスト用 Maven ラッパーを作成する。
 * @param workspacePath ワークスペースパスを表す。
 * @param logPath 実行ログパスを表す。
 * @param targetFileUri 対象ファイル URI を表す。
 * @returns 返り値はない。
 */
function writeMavenWrapper(workspacePath: string, logPath: string, targetFileUri: string): void {
  const checkstyleXml = `<?xml version="1.0"?><checkstyle version="10.0"><file name="${targetFileUri}"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>`;
  const pmdXml = `<?xml version="1.0"?><pmd version="7.0.0"><file name="${targetFileUri}"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>`;
  const wrapperPath = process.platform === 'win32'
    ? path.join(workspacePath, 'mvnw.cmd')
    : path.join(workspacePath, 'mvnw');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
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
      `printf '%s\n' "$*" >> "${logPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * PMD を既定レポートファイルへ出力するテスト用 Maven ラッパーを作成する。
 * @param workspacePath ワークスペースパスを表す。
 * @param logPath 実行ログパスを表す。
 * @param targetFileUri 対象ファイル URI を表す。
 * @returns 返り値はない。
 */
function writeMavenReportFileWrapper(workspacePath: string, logPath: string, targetFileUri: string): void {
  const checkstyleXml = `<?xml version="1.0"?><checkstyle version="10.0"><file name="${targetFileUri}"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>`;
  const pmdXml = `<?xml version="1.0"?><pmd version="7.0.0"><file name="${targetFileUri}"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>`;
  const wrapperPath = process.platform === 'win32'
    ? path.join(workspacePath, 'mvnw.cmd')
    : path.join(workspacePath, 'mvnw');
  const pmdReportPath = path.join(workspacePath, 'target', 'pmd.xml');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
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
      `printf '%s\n' "$*" >> "${logPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) printf '%s' '${checkstyleXml}' ;;`,
      `  *"pmd:check"*) mkdir -p '${path.dirname(pmdReportPath)}'; printf '%s' '${pmdXml}' > '${pmdReportPath}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * Checkstyle を既定レポートファイルへ出力するテスト用 Maven ラッパーを作成する。
 * @param workspacePath ワークスペースパスを表す。
 * @param logPath 実行ログパスを表す。
 * @param targetFileUri 対象ファイル URI を表す。
 * @returns 返り値はない。
 */
function writeMavenCheckstyleReportFileWrapper(workspacePath: string, logPath: string, targetFileUri: string): void {
  const checkstyleXml = `<?xml version="1.0"?><checkstyle version="10.0"><file name="${targetFileUri}"><error line="2" column="5" severity="warning" message="Missing Javadoc" source="com.puppycrawl.tools.checkstyle.checks.javadoc.JavadocTypeCheck"/></file></checkstyle>`;
  const pmdXml = `<?xml version="1.0"?><pmd version="7.0.0"><file name="${targetFileUri}"><violation beginline="3" begincolumn="9" priority="3" rule="UnusedLocalVariable">Unused local variable</violation></file></pmd>`;
  const wrapperPath = process.platform === 'win32'
    ? path.join(workspacePath, 'mvnw.cmd')
    : path.join(workspacePath, 'mvnw');
  const checkstyleReportPath = path.join(workspacePath, 'target', 'checkstyle-result.xml');

  if (process.platform === 'win32') {
    const encodedCheckstyleXml = Buffer.from(checkstyleXml, 'utf8').toString('base64');
    const encodedPmdXml = Buffer.from(pmdXml, 'utf8').toString('base64');
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
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
      `printf '%s\n' "$*" >> "${logPath}"`,
      'case "$*" in',
      `  *"checkstyle:check"*) mkdir -p '${path.dirname(checkstyleReportPath)}'; printf '%s' '${checkstyleXml}' > '${checkstyleReportPath}' ;;`,
      `  *"pmd:check"*) printf '%s' '${pmdXml}' ;;`,
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * テスト用 Semgrep ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param logPath 実行ログパスを表す。
 * @param targetFileUri 対象ファイル URI を表す。
 * @returns 返り値はない。
 */
function writeSemgrepWrapper(binDirectory: string, logPath: string, targetFileUri: string): void {
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'semgrep.cmd')
    : path.join(binDirectory, 'semgrep');
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
                  artifactLocation: { uri: targetFileUri },
                  region: { startLine: 1, startColumn: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\necho %*>>"${logPath}"\r\necho ${sarif}\r\nexit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${logPath}"`,
      `printf '%s\n' '${sarif}'`,
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * finding を出さない Semgrep ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param logPath 実行ログパスを表す。
 * @returns 返り値はない。
 */
function writeEmptySemgrepWrapper(binDirectory: string, logPath: string): void {
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'semgrep.cmd')
    : path.join(binDirectory, 'semgrep');
  const sarif = JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'semgrep' } },
        results: [],
      },
    ],
  });

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      `@echo off\r\necho %*>>"${logPath}"\r\necho ${sarif}\r\nexit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${logPath}"`,
      `printf '%s\n' '${sarif}'`,
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * ログ出力専用の Web コマンドラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param commandName コマンド名を表す。
 * @param logPath 実行ログパスを表す。
 * @param stdout 実行時に標準出力へ書き出す内容を表す。
 * @param exitCode 実行終了コードを表す。
 * @returns 返り値はない。
 */
function writeWebLoggingWrapper(
  binDirectory: string,
  commandName: string,
  logPath: string,
  stdout: string = '',
  exitCode: number = 0,
): void {
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, `${commandName}.cmd`)
    : path.join(binDirectory, commandName);

  if (process.platform === 'win32') {
    const outputLines = stdout
      ? [
        'setlocal enabledelayedexpansion',
        `set MAMORI_STDOUT=${stdout.replace(/\r?\n/gu, '')}`,
        'if not "!MAMORI_STDOUT!"=="" echo !MAMORI_STDOUT!',
      ]
      : [];
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
        ...outputLines,
        `exit /b ${String(exitCode)}`,
        '',
      ].join('\r\n'),
      'utf8',
    );
    return;
  }

  const escapedStdout = stdout.replace(/'/gu, String.raw`'"'"'`);
  const outputLines = stdout
    ? [`printf '%s\n' '${escapedStdout}'`]
    : [];
  fs.writeFileSync(
    wrapperPath,
    [
      '#!/bin/sh',
      `printf '%s\n' "$*" >> "${logPath}"`,
      ...outputLines,
      `exit ${String(exitCode)}`,
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * 整形結果をファイルへ追記する Prettier ラッパーを作成する。
 * @param binDirectory ラッパーディレクトリを表す。
 * @param logPath 実行ログパスを表す。
 * @returns 返り値はない。
 */
function writePrettierWrapper(binDirectory: string, logPath: string): void {
  const wrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'prettier.cmd')
    : path.join(binDirectory, 'prettier');

  if (process.platform === 'win32') {
    fs.writeFileSync(
      wrapperPath,
      [
        '@echo off',
        `echo %*>>"${logPath}"`,
        'node -e "const fs=require(\'fs\');for (const value of process.argv.slice(1)) { if (value === \"--write\" || value.startsWith(\"-\")) { continue; } fs.appendFileSync(value, \"\\n// formatted by prettier\\n\"); }" %*',
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
      `printf '%s\n' "$*" >> "${logPath}"`,
      'for value in "$@"; do',
      '  case "$value" in',
      '    --write) continue ;;',
      '    -*) continue ;;',
      '    *) printf "\\n// formatted by prettier\\n" >> "$value" ;;',
      '  esac',
      'done',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  makeExecutable(wrapperPath);
}

/**
 * 保存時統合テスト用 fixture を構築する。
 * @param workspacePath ワークスペースパスを表す。
 * @returns 対象 Java ファイルと関連パスを返す。
 */
function setupSaveIntegrationFixture(workspacePath: string): {
  fixtureDirectory: string;
  javaFilePath: string;
  mavenLogPath: string;
  semgrepLogPath: string;
} {
  const fixtureDirectory = path.join(workspacePath, '.tmp-save-check');
  const sourceDirectory = path.join(fixtureDirectory, 'src', 'main', 'java');
  const binDirectory = path.join(fixtureDirectory, 'bin');
  const javaFilePath = path.join(sourceDirectory, 'App.java');
  const javaFileUri = toWorkspaceRelativeUri(workspacePath, javaFilePath);
  const mavenLogPath = path.join(binDirectory, 'mvn.log');
  const semgrepLogPath = path.join(binDirectory, 'semgrep.log');
  const semgrepWrapperPath = process.platform === 'win32'
    ? path.join(binDirectory, 'semgrep.cmd')
    : path.join(binDirectory, 'semgrep');

  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDirectory, 'pom.xml'),
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
  fs.writeFileSync(
    javaFilePath,
    [
      'public class App {',
      '  void run() {}',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  writeMavenWrapper(fixtureDirectory, mavenLogPath, javaFileUri);
  writeSemgrepWrapper(binDirectory, semgrepLogPath, javaFileUri);
  setSemgrepCommandOverride(semgrepWrapperPath);

  return {
    fixtureDirectory,
    javaFilePath,
    mavenLogPath,
    semgrepLogPath,
  };
}

/**
 * PMD レポートから最初の violation を返す。
 * @param reportPath PMD レポートパスを表す。
 * @returns 最初の violation 情報を返す。
 */
function findFirstPmdViolation(reportPath: string): {
  filePath: string;
  message: string;
} | undefined {
  if (!fs.existsSync(reportPath)) {
    return undefined;
  }

  const reportContent = fs.readFileSync(reportPath, 'utf8');
  const fileMatch = reportContent.match(/<file name="([^"]+\.java)">/u);
  const violationMatch = reportContent.match(/<violation[^>]*>[\s\r\n]*([^<\r\n][^<]*)[\s\r\n]*<\/violation>/u);
  if (!fileMatch || !violationMatch) {
    return undefined;
  }

  return {
    filePath: fileMatch[1],
    message: violationMatch[1].trim(),
  };
}

/**
 * ESLint 保存時統合テスト用 fixture を構築する。
 * @param workspacePath ワークスペースパスを表す。
 * @returns 対象 JavaScript ファイルと関連パスを返す。
 */
function setupWebSaveIntegrationFixture(workspacePath: string): {
  fixtureDirectory: string;
  binDirectory: string;
  javascriptFilePath: string;
  prettierLogPath: string;
  eslintLogPath: string;
} {
  return setupWebSaveIntegrationFixtureWithOptions(workspacePath);
}

/**
 * ESLint 保存時統合テスト用 fixture を構築する。
 * @param workspacePath ワークスペースパスを表す。
 * @param options fixture 構築オプションを表す。
 * @returns 対象 JavaScript ファイルと関連パスを返す。
 */
function setupWebSaveIntegrationFixtureWithOptions(
  workspacePath: string,
  options: {
    createEslintConfig?: boolean;
    targetFileName?: string;
  } = {},
): {
  fixtureDirectory: string;
  binDirectory: string;
  javascriptFilePath: string;
  prettierLogPath: string;
  eslintLogPath: string;
} {
  const fixtureDirectory = path.join(workspacePath, '.tmp-web-save-check');
  const sourceDirectory = path.join(fixtureDirectory, 'src');
  const binDirectory = path.join(fixtureDirectory, 'node_modules', '.bin');
  const targetFileName = options.targetFileName || 'main.js';
  const javascriptFilePath = path.join(sourceDirectory, targetFileName);
  const prettierLogPath = path.join(fixtureDirectory, 'prettier.log');
  const eslintLogPath = path.join(fixtureDirectory, 'eslint.log');
  const shouldCreateEslintConfig = options.createEslintConfig !== false;
  const eslintOutput = JSON.stringify([
    {
      filePath: javascriptFilePath,
      messages: [
        {
          ruleId: 'no-console',
          severity: 2,
          message: 'Unexpected console statement.',
          line: 2,
          column: 1,
        },
      ],
    },
  ]);

  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(binDirectory, { recursive: true });
  if (shouldCreateEslintConfig) {
    fs.writeFileSync(path.join(fixtureDirectory, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
  }
  fs.writeFileSync(javascriptFilePath, 'const sample = 1;\n', 'utf8');
  writeWebLoggingWrapper(binDirectory, 'prettier', prettierLogPath);
  writeWebLoggingWrapper(binDirectory, 'eslint', eslintLogPath, eslintOutput, 1);

  return {
    fixtureDirectory,
    binDirectory,
    javascriptFilePath,
    prettierLogPath,
    eslintLogPath,
  };
}

/**
 * TypeScript 保存時統合テスト用 fixture を構築する。
 * @param workspacePath ワークスペースパスを表す。
 * @returns 対象 TypeScript ファイルと関連パスを返す。
 */
function setupTypeScriptSaveIntegrationFixture(workspacePath: string): {
  fixtureDirectory: string;
  binDirectory: string;
  typescriptFilePath: string;
  eslintLogPath: string;
} {
  const fixture = setupWebSaveIntegrationFixtureWithOptions(workspacePath, {
    targetFileName: 'main.ts',
  });

  return {
    fixtureDirectory: fixture.fixtureDirectory,
    binDirectory: fixture.binDirectory,
    typescriptFilePath: fixture.javascriptFilePath,
    eslintLogPath: fixture.eslintLogPath,
  };
}

/**
 * Git hooks 統合テスト用の復元処理を返す。
 * @param workspacePath ワークスペースパスを表す。
 * @returns hook パスと復元関数を返す。
 */
function setupHooksFixture(workspacePath: string): {
  preCommitHookPath: string;
  prePushHookPath: string;
  restorePreCommitHook: () => void;
  restorePrePushHook: () => void;
} {
  const hooksDirectory = path.join(workspacePath, '.git', 'hooks');
  const preCommitHookPath = path.join(hooksDirectory, 'pre-commit');
  const prePushHookPath = path.join(hooksDirectory, 'pre-push');

  fs.mkdirSync(hooksDirectory, { recursive: true });

  return {
    preCommitHookPath,
    prePushHookPath,
    restorePreCommitHook: createRestoreAction(preCommitHookPath),
    restorePrePushHook: createRestoreAction(prePushHookPath),
  };
}

/**
 * Mamori Inspector 拡張を取得する。
 * @returns 拡張情報を返す。
 */
function getMamoriExtension(vscodeApi: VscodeModule): VscodeModule['extensions']['all'][number] {
  const extension = vscodeApi.extensions.all.find(
    (candidate) => candidate.packageJSON.name === 'mamori-inspector',
  );
  if (!extension) {
    throw new Error('Mamori Inspector extension was not found');
  }
  return extension;
}

/**
 * hooks 通知テスト用の通知記録先を作成する。
 * @returns 記録先を返す。
 */
function createHooksMessageRecorder(): {
  informationMessages: string[];
  warningMessages: string[];
  presenter: {
    showInformationMessage: (message: string) => Promise<void>;
    showWarningMessage: (message: string) => Promise<void>;
  };
  } {
  const informationMessages: string[] = [];
  const warningMessages: string[] = [];

  return {
    informationMessages,
    warningMessages,
    presenter: {
      showInformationMessage: async(message: string) => {
        informationMessages.push(message);
      },
      showWarningMessage: async(message: string) => {
        warningMessages.push(message);
      },
    },
  };
}

/**
 * VS Code の通知メッセージを一時的に記録する。
 * @param vscodeApi VS Code API を表す。
 * @returns 記録内容と復元関数を返す。
 */
function captureWindowMessages(vscodeApi: VscodeModule): {
  informationMessages: string[];
  errorMessages: string[];
  restore: () => void;
} {
  const informationMessages: string[] = [];
  const errorMessages: string[] = [];
  const windowApi = vscodeApi.window as unknown as Record<string, unknown>;
  const originalShowInformationMessage = windowApi.showInformationMessage;
  const originalShowErrorMessage = windowApi.showErrorMessage;

  Object.defineProperty(windowApi, 'showInformationMessage', {
    configurable: true,
    writable: true,
    value: async(message: string) => {
      informationMessages.push(message);
      return undefined;
    },
  });
  Object.defineProperty(windowApi, 'showErrorMessage', {
    configurable: true,
    writable: true,
    value: async(message: string) => {
      errorMessages.push(message);
      return undefined;
    },
  });

  return {
    informationMessages,
    errorMessages,
    restore: () => {
      Object.defineProperty(windowApi, 'showInformationMessage', {
        configurable: true,
        writable: true,
        value: originalShowInformationMessage,
      });
      Object.defineProperty(windowApi, 'showErrorMessage', {
        configurable: true,
        writable: true,
        value: originalShowErrorMessage,
      });
    },
  };
}

/**
 * 指定出力チャネルへ追記された行を捕捉する。
 * @param vscodeApi VS Code API を表す。
 * @param channelName 捕捉対象の出力チャネル名を表す。
 * @returns 捕捉結果と復元関数を返す。
 */
function captureOutputChannelLines(
  vscodeApi: VscodeModule,
  channelName: string,
): {
  outputLines: string[];
  restore: () => void;
} {
  const outputLines: string[] = [];
  const windowApi = vscodeApi.window as unknown as Record<string, unknown>;
  const originalCreateOutputChannel = windowApi.createOutputChannel;

  Object.defineProperty(windowApi, 'createOutputChannel', {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => {
      const createOutputChannel = originalCreateOutputChannel as (...innerArgs: unknown[]) => { appendLine: (value: string) => void };
      const outputChannel = createOutputChannel(...args);
      if (args[0] !== channelName) {
        return outputChannel;
      }

      const originalAppendLine = outputChannel.appendLine.bind(outputChannel);
      outputChannel.appendLine = (value: string) => {
        outputLines.push(value);
        originalAppendLine(value);
      };
      return outputChannel;
    },
  });

  return {
    outputLines,
    restore: () => {
      Object.defineProperty(windowApi, 'createOutputChannel', {
        configurable: true,
        writable: true,
        value: originalCreateOutputChannel,
      });
    },
  };
}

/**
 * 拡張補助機能のテストスイートを定義する。
 * @returns 返り値はない。
 */
suite('Extension Utility Test Suite', () => {
  /** 保存時通知ヘルパーを表す。 */
  const extensionHelpers = require('../save-check-notifications') as {
    getSaveCheckStartToastMessage: (fileName: string, toolLabel: string) => string;
    getSaveCheckToolLabel: (toolId: string) => string;
    parseSaveCheckToolStartLine: (outputLine: string) => string | undefined;
  };

  /**
   * サンプルテストを実行する。
   * @returns 返り値はない。
   */
  test('Sample test', () => {
    // 配列に含まれない値を表す
    const missing = -1;
    assert.strictEqual(missing, [1, 2, 3].indexOf(5));
    assert.strictEqual(missing, [1, 2, 3].indexOf(0));
  });

  /**
   * install 競合 warning が通知と Output Channel に記録されること。
   * @returns 返り値はない。
   */
  test('Reports install hook warnings to notifications and output channel', () => {
    const outputLines: string[] = [];
    const { informationMessages, warningMessages, presenter } = createHooksMessageRecorder();

    reportHooksCommandSuccess(
      'install',
      'mamori: hooks warnings=pre-commit already exists and was left unchanged | pre-push already exists and was left unchanged',
      {
        appendLine: (value: string) => {
          outputLines.push(value);
        },
      },
      presenter,
    );

    assert.deepStrictEqual(outputLines, [
      'Mamori Inspector hooks install warnings: pre-commit already exists and was left unchanged | pre-push already exists and was left unchanged',
    ]);
    assert.deepStrictEqual(warningMessages, [
      'Mamori Inspector: Git hooks were processed, but some hooks were left unchanged. pre-commit already exists and was left unchanged / pre-push already exists and was left unchanged',
    ]);
    assert.deepStrictEqual(informationMessages, [
      'Mamori Inspector: Installed Git hooks.',
    ]);
  });

  /**
   * uninstall 競合 warning が通知と Output Channel に記録されること。
   * @returns 返り値はない。
   */
  test('Reports uninstall hook warnings to notifications and output channel', () => {
    const outputLines: string[] = [];
    const { informationMessages, warningMessages, presenter } = createHooksMessageRecorder();

    reportHooksCommandSuccess(
      'uninstall',
      'mamori: hooks warnings=pre-commit is not managed by Mamori Inspector and was left unchanged',
      {
        appendLine: (value: string) => {
          outputLines.push(value);
        },
      },
      presenter,
    );

    assert.deepStrictEqual(outputLines, [
      'Mamori Inspector hooks uninstall warnings: pre-commit is not managed by Mamori Inspector and was left unchanged',
    ]);
    assert.deepStrictEqual(warningMessages, [
      'Mamori Inspector: Git hooks were processed, but some hooks were left unchanged. pre-commit is not managed by Mamori Inspector and was left unchanged',
    ]);
    assert.deepStrictEqual(informationMessages, [
      'Mamori Inspector: Uninstalled Git hooks.',
    ]);
  });

  /**
   * 保存時ツール開始行から個別ツール通知を組み立てられること。
   * @returns 返り値はない。
   */
  test('Parses a save-check tool start line and builds a single-tool toast message', () => {
    const toolId = extensionHelpers.parseSaveCheckToolStartLine(
      'mamori: tool-start tool=checkstyle phase=check moduleRoot=C:\\workspace\\sample',
    );
    const toolLabel = extensionHelpers.getSaveCheckToolLabel(toolId || '');
    const toastMessage = extensionHelpers.getSaveCheckStartToastMessage('App.java', toolLabel);

    assert.strictEqual(toolId, 'checkstyle');
    assert.strictEqual(toolLabel, 'Checkstyle');
    assert.strictEqual(
      toastMessage,
      'Mamori Inspector: App.java - Checkstyle',
    );
  });

  /**
   * warning がない場合は成功通知のみ表示されること。
   * @returns 返り値はない。
   */
  test('Reports only information when hook command output has no warnings', () => {
    const outputLines: string[] = [];
    const { informationMessages, warningMessages, presenter } = createHooksMessageRecorder();

    reportHooksCommandSuccess(
      'install',
      'mamori: hooks completed',
      {
        appendLine: (value: string) => {
          outputLines.push(value);
        },
      },
      presenter,
    );

    assert.deepStrictEqual(outputLines, []);
    assert.deepStrictEqual(warningMessages, []);
    assert.deepStrictEqual(informationMessages, [
      'Mamori Inspector: Installed Git hooks.',
    ]);
  });
});

// 拡張ホスト上でだけ VS Code API 依存テストを登録する
const integrationVscodeApi = loadVscode();

/**
 * 拡張の統合テストスイートを定義する。
 * @returns 返り値はない。
 */
integrationVscodeApi && suite('Extension Test Suite', () => {
  /** 現在利用する VS Code API を表す。 */
  const vscodeApi = integrationVscodeApi as VscodeModule;
  /** 元の PATH を表す。 */
  let originalPath = '';
  /** 元の Semgrep コマンド上書き設定を表す。 */
  let originalSemgrepCommandOverride: string | undefined;

  /**
   * 各テストの前処理を行う。
   * @returns 実行完了を待つ Promise を返す。
   */
  setup(async() => {
    originalPath = getExecutablePathEnvironment();
    originalSemgrepCommandOverride = getSemgrepCommandOverride();
    await setWorkspaceMamoriEnabled(vscodeApi, undefined);
    await vscodeApi.workspace.getConfiguration('files').update(
      'autoSave',
      'off',
      vscodeApi.ConfigurationTarget.Workspace,
    );
    await vscodeApi.workspace.getConfiguration('files').update(
      'saveConflictResolution',
      'overwriteFileOnDisk',
      vscodeApi.ConfigurationTarget.Workspace,
    );
    await vscodeApi.workspace.getConfiguration('editor').update(
      'formatOnSave',
      false,
      vscodeApi.ConfigurationTarget.Workspace,
    );
  });

  /**
   * 各テストの後処理を行う。
   * @returns 実行完了を待つ Promise を返す。
   */
  teardown(async() => {
    await setWorkspaceMamoriEnabled(vscodeApi, undefined);
    setExecutablePathEnvironment(originalPath);
    setSemgrepCommandOverride(originalSemgrepCommandOverride);
  });

  /**
   * 既定では保存時チェックが無効であり、Java ファイルを保存しても実行されないこと。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Does not run save checks for a Java file while the workspace is disabled by default', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(saveSarifPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);

      try {
        const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(javaFilePath));
        await activeVscodeApi.window.showTextDocument(document);
        await getMamoriExtension(activeVscodeApi).activate();

        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.insert(new activeVscodeApi.Position(1, 0), '  int value = 1;\n');
        });
        await document.save();
        await delay(1500);

        assert.strictEqual(activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length, 0);
        assert.ok(!fs.existsSync(saveSarifPath));
        assert.ok(!fs.existsSync(mavenLogPath));
        assert.ok(!fs.existsSync(semgrepLogPath));
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreSaveSarif();
    }
  });

  /**
   * Java ファイル保存時に Mamori CLI が自動実行され、Diagnostics に反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Runs save checks and publishes diagnostics when a Java file is saved', async function() {
    this.timeout(30000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);
    const messageCapture = captureWindowMessages(activeVscodeApi);

    try {
      fs.rmSync(saveSarifPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);

      try {
        const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(javaFilePath));
        await activeVscodeApi.window.showTextDocument(document);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.enableInWorkspace');
        assert.strictEqual(
          activeVscodeApi.workspace.getConfiguration('mamori-inspector', document.uri).get('enabled', false),
          true,
        );
        const informationCountBeforeSave = messageCapture.informationMessages.length;

        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.insert(new activeVscodeApi.Position(1, 0), '  int value = 1;\n');
        });
        await document.save();

        await waitFor(() => fs.existsSync(saveSarifPath));
        await waitFor(() => fs.existsSync(mavenLogPath) && fs.existsSync(semgrepLogPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 3);
        await waitFor(() => {
          const saveRunMessages = messageCapture.informationMessages.slice(informationCountBeforeSave);
          return saveRunMessages.includes('Mamori Inspector: App.java - Checkstyle')
            && saveRunMessages.includes('Mamori Inspector: App.java - PMD')
            && saveRunMessages.includes('Mamori Inspector: App.java - Semgrep');
        }, 20000);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath));
        const messages = diagnostics.map((diagnostic) => diagnostic.message);
        const saveRunMessages = messageCapture.informationMessages.slice(informationCountBeforeSave);

        assert.strictEqual(diagnostics.length, 3);
        assert.ok(messages.includes('Missing Javadoc'));
        assert.ok(messages.includes('Unused local variable'));
        assert.ok(messages.includes('Potential issue'));
        assert.ok(saveRunMessages.includes('Mamori Inspector: App.java - Checkstyle'));
        assert.ok(saveRunMessages.includes('Mamori Inspector: App.java - PMD'));
        assert.ok(saveRunMessages.includes('Mamori Inspector: App.java - Semgrep'));
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /checkstyle:check/u);
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /pmd:check/u);
        assert.match(fs.readFileSync(semgrepLogPath, 'utf8'), /App\.java/u);
        assert.ok(fs.existsSync(saveSarifPath));
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      messageCapture.restore();
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreSaveSarif();
    }
  });

  /**
   * Semgrep 起動失敗でも、保存時 SARIF に含まれる Checkstyle と PMD の結果は反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Publishes partial save diagnostics when Semgrep startup fails after Maven results are generated', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const missingSemgrepPath = path.join(workspaceRoot, 'bin', 'missing-semgrep-command');
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(saveSarifPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);
      setSemgrepCommandOverride(missingSemgrepPath);

      try {
        const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(javaFilePath));
        await activeVscodeApi.window.showTextDocument(document);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.enableInWorkspace');
        assert.strictEqual(
          activeVscodeApi.workspace.getConfiguration('mamori-inspector', document.uri).get('enabled', false),
          true,
        );

        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.insert(new activeVscodeApi.Position(1, 0), '  int value = 1;\n');
        });
        await document.save();

        await waitFor(() => fs.existsSync(saveSarifPath));
        await waitFor(() => fs.existsSync(mavenLogPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 2);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath));
        const messages = diagnostics.map((diagnostic) => diagnostic.message);
        const sarifFindings = loadSarifFindings(saveSarifPath);
        const sarifMessages = sarifFindings.map((finding) => finding.message);

        assert.strictEqual(diagnostics.length, 2);
        assert.ok(messages.includes('Missing Javadoc'));
        assert.ok(messages.includes('Unused local variable'));
        assert.ok(!messages.includes('Potential issue'));
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /checkstyle:check/u);
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /pmd:check/u);
        assert.ok(!fs.existsSync(semgrepLogPath));
        assert.ok(sarifMessages.includes('Missing Javadoc'));
        assert.ok(sarifMessages.includes('Unused local variable'));
        assert.ok(!sarifMessages.includes('Potential issue'));
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreSaveSarif();
    }
  });

  /**
   * コマンドで無効化すると既存 Diagnostics を消去し、その後の保存時チェックも停止すること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Disables save checks and clears diagnostics through the workspace command', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(saveSarifPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);

      try {
        const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(javaFilePath));
        await activeVscodeApi.window.showTextDocument(document);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.enableInWorkspace');
        assert.strictEqual(
          activeVscodeApi.workspace.getConfiguration('mamori-inspector', document.uri).get('enabled', false),
          true,
        );

        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.insert(new activeVscodeApi.Position(1, 0), '  int value = 1;\n');
        });
        await document.save();

        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 3);
        await waitFor(() => fs.existsSync(saveSarifPath));

        await activeVscodeApi.commands.executeCommand('mamori-inspector.disableInWorkspace');
        assert.strictEqual(
          activeVscodeApi.workspace.getConfiguration('mamori-inspector', document.uri).get('enabled', true),
          false,
        );
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 0);

        fs.rmSync(saveSarifPath, { force: true });
        fs.rmSync(mavenLogPath, { force: true });
        fs.rmSync(semgrepLogPath, { force: true });

        await editor.edit((editBuilder) => {
          editBuilder.insert(new activeVscodeApi.Position(1, 0), '  int secondValue = 2;\n');
        });
        await document.save();
        await delay(1500);

        assert.strictEqual(activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length, 0);
        assert.ok(!fs.existsSync(saveSarifPath));
        assert.ok(!fs.existsSync(mavenLogPath));
        assert.ok(!fs.existsSync(semgrepLogPath));
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreSaveSarif();
    }
  });

  /**
   * Disable コマンドで保存時設定を無効にしても、手動実行で反映済みの Diagnostics は残ること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Keeps manual diagnostics when the workspace is disabled', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const manualSarifPath = path.join(workspaceRoot, '.mamori', 'out', 'combined.sarif');
    const restoreManualSarif = createRestoreAction(manualSarifPath);
    const restorePomFile = createRestoreAction(path.join(workspaceRoot, 'pom.xml'));
    const restoreMavenWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'mvnw.cmd')
        : path.join(workspaceRoot, 'mvnw'),
    );
    const restoreSemgrepWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
        : path.join(workspaceRoot, 'bin', 'semgrep'),
    );

    try {
      fs.rmSync(manualSarifPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      try {
        setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

        await waitFor(() => fs.existsSync(manualSarifPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 3);

        await activeVscodeApi.commands.executeCommand('mamori-inspector.disableInWorkspace');

        assert.strictEqual(
          activeVscodeApi.workspace.getConfiguration('mamori-inspector', activeVscodeApi.Uri.file(javaFilePath)).get('enabled', true),
          false,
        );
        assert.strictEqual(activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length, 3);
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restoreManualSarif();
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
    }
  });

  /**
   * 手動実行で PMD 既定レポートの finding が Diagnostics と通知へ反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Publishes PMD diagnostics when manual workspace checks read generated Maven report files', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const manualSarifPath = path.join(workspaceRoot, '.mamori', 'out', 'combined.sarif');
    const pmdReportPath = path.join(workspaceRoot, 'target', 'pmd.xml');
    const restoreManualSarif = createRestoreAction(manualSarifPath);
    const restorePmdReport = createRestoreAction(pmdReportPath);
    const restorePomFile = createRestoreAction(path.join(workspaceRoot, 'pom.xml'));
    const restoreMavenWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'mvnw.cmd')
        : path.join(workspaceRoot, 'mvnw'),
    );
    const restoreSemgrepWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
        : path.join(workspaceRoot, 'bin', 'semgrep'),
    );
    const messageCapture = captureWindowMessages(activeVscodeApi);

    try {
      fs.rmSync(manualSarifPath, { force: true });
      fs.rmSync(pmdReportPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      try {
        writeMavenReportFileWrapper(workspaceRoot, mavenLogPath, toWorkspaceRelativeUri(workspaceRoot, javaFilePath));
        writeSemgrepWrapper(path.join(workspaceRoot, 'bin'), semgrepLogPath, toWorkspaceRelativeUri(workspaceRoot, javaFilePath));

        setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

        await waitFor(() => fs.existsSync(manualSarifPath));
        await waitFor(() => fs.existsSync(pmdReportPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).some((diagnostic) => (
          diagnostic.message === 'Unused local variable'
        )));
        await waitFor(() => messageCapture.informationMessages.length > 0 || messageCapture.errorMessages.length > 0);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath));
        const messages = diagnostics.map((diagnostic) => diagnostic.message);

        assert.deepStrictEqual(messageCapture.errorMessages, []);
        assert.ok(messageCapture.informationMessages.some((message) => getDiagnosticsReflectedPattern(3).test(message)));
        assert.ok(messages.includes('Unused local variable'));
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /pmd:check/u);
        assert.match(fs.readFileSync(manualSarifPath, 'utf8'), /Unused local variable/u);
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      messageCapture.restore();
      restoreManualSarif();
      restorePmdReport();
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
    }
  });

  /**
   * 手動実行で Checkstyle 既定レポートの finding が Diagnostics と通知へ反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Publishes Checkstyle diagnostics when manual workspace checks read generated Maven report files', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const manualSarifPath = path.join(workspaceRoot, '.mamori', 'out', 'combined.sarif');
    const checkstyleReportPath = path.join(workspaceRoot, 'target', 'checkstyle-result.xml');
    const restoreManualSarif = createRestoreAction(manualSarifPath);
    const restoreCheckstyleReport = createRestoreAction(checkstyleReportPath);
    const restorePomFile = createRestoreAction(path.join(workspaceRoot, 'pom.xml'));
    const restoreMavenWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'mvnw.cmd')
        : path.join(workspaceRoot, 'mvnw'),
    );
    const restoreSemgrepWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
        : path.join(workspaceRoot, 'bin', 'semgrep'),
    );
    const messageCapture = captureWindowMessages(activeVscodeApi);

    try {
      fs.rmSync(manualSarifPath, { force: true });
      fs.rmSync(checkstyleReportPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      try {
        writeMavenCheckstyleReportFileWrapper(
          workspaceRoot,
          mavenLogPath,
          toWorkspaceRelativeUri(workspaceRoot, javaFilePath),
        );
        writeSemgrepWrapper(path.join(workspaceRoot, 'bin'), semgrepLogPath, toWorkspaceRelativeUri(workspaceRoot, javaFilePath));

        setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

        await waitFor(() => fs.existsSync(manualSarifPath));
        await waitFor(() => fs.existsSync(checkstyleReportPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).some((diagnostic) => (
          diagnostic.message === 'Missing Javadoc'
        )));
        await waitFor(() => messageCapture.informationMessages.length > 0 || messageCapture.errorMessages.length > 0);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath));
        const messages = diagnostics.map((diagnostic) => diagnostic.message);

        assert.deepStrictEqual(messageCapture.errorMessages, []);
        assert.ok(messageCapture.informationMessages.some((message) => getDiagnosticsReflectedPattern(3).test(message)));
        assert.ok(messages.includes('Missing Javadoc'));
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /checkstyle:check/u);
        assert.match(fs.readFileSync(manualSarifPath, 'utf8'), /Missing Javadoc/u);
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      messageCapture.restore();
      restoreManualSarif();
      restoreCheckstyleReport();
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
    }
  });

  /**
   * JavaScript ファイル保存時に Web 系の保存時 finding が Diagnostics へ反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Runs save checks when a JavaScript file is saved', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(pomFilePath, { force: true });
      fs.rmSync(mavenWrapperPath, { force: true });
      fs.rmSync(semgrepWrapperPath, { force: true });
      fs.rmSync(saveSarifPath, { force: true });
      const {
        fixtureDirectory,
        binDirectory,
        javascriptFilePath,
        prettierLogPath,
        eslintLogPath,
      } = setupWebSaveIntegrationFixture(workspaceRoot);
      const restorePrettierLog = createRestoreAction(prettierLogPath);
      const restoreEslintLog = createRestoreAction(eslintLogPath);
      fs.rmSync(prettierLogPath, { force: true });
      fs.rmSync(eslintLogPath, { force: true });

      try {
        setExecutablePathEnvironment(`${binDirectory}${path.delimiter}${originalPath}`);
        fs.appendFileSync(javascriptFilePath, 'console.log(sample);\n', 'utf8');
        await runSaveCommandForTest(workspaceRoot, javascriptFilePath, saveSarifPath);

        await waitFor(() => fs.existsSync(saveSarifPath));
        await waitFor(() => fs.existsSync(prettierLogPath) && fs.existsSync(eslintLogPath));
        await waitFor(() => /Unexpected console statement\./u.test(fs.readFileSync(saveSarifPath, 'utf8')));

        assert.ok(fs.existsSync(saveSarifPath));
        assert.match(fs.readFileSync(saveSarifPath, 'utf8'), /Unexpected console statement\./u);
        assert.match(fs.readFileSync(prettierLogPath, 'utf8'), /main\.js/u);
        assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /main\.js/u);
      } finally {
        restorePrettierLog();
        restoreEslintLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreSaveSarif();
    }
  });

  /**
   * JavaScript 設定ファイルが無い保存時でも組み込み最小 ESLint 設定で finding が Diagnostics と SARIF へ反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Runs save checks with bundled fallback ESLint config when a JavaScript file is saved without project config', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const workspaceEslintConfigPath = path.join(workspaceRoot, 'eslint.config.mjs');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreWorkspaceEslintConfig = createRestoreAction(workspaceEslintConfigPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(pomFilePath, { force: true });
      fs.rmSync(mavenWrapperPath, { force: true });
      fs.rmSync(semgrepWrapperPath, { force: true });
      fs.rmSync(saveSarifPath, { force: true });
      fs.rmSync(workspaceEslintConfigPath, { force: true });
      const {
        fixtureDirectory,
        binDirectory,
        javascriptFilePath,
        prettierLogPath,
        eslintLogPath,
      } = setupWebSaveIntegrationFixtureWithOptions(workspaceRoot, {
        createEslintConfig: false,
      });
      const restorePrettierLog = createRestoreAction(prettierLogPath);
      const restoreEslintLog = createRestoreAction(eslintLogPath);
      fs.rmSync(prettierLogPath, { force: true });
      fs.rmSync(eslintLogPath, { force: true });

      try {
        setExecutablePathEnvironment(`${binDirectory}${path.delimiter}${originalPath}`);
        fs.appendFileSync(javascriptFilePath, 'console.log(sample);\n', 'utf8');
        await runSaveCommandForTest(workspaceRoot, javascriptFilePath, saveSarifPath);

        await waitFor(() => fs.existsSync(saveSarifPath));
        await waitFor(() => fs.existsSync(prettierLogPath) && fs.existsSync(eslintLogPath));
        const findings = loadSarifFindings(saveSarifPath);
        const saveSarif = fs.readFileSync(saveSarifPath, 'utf8');
        const eslintLog = fs.readFileSync(eslintLogPath, 'utf8');
        const prettierLog = fs.readFileSync(prettierLogPath, 'utf8');

        assert.strictEqual(findings.length, 1);
        assert.strictEqual(findings[0]?.message, 'Unexpected console statement.');
        assert.match(saveSarif, /Unexpected console statement\./u);
        assert.match(eslintLog, /--config .*eslint\.default\.json/u);
        assert.match(prettierLog, /main\.js/u);
      } finally {
        restorePrettierLog();
        restoreEslintLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreWorkspaceEslintConfig();
      restoreSaveSarif();
    }
  });

  /**
   * TypeScript ファイル保存時に ESLint finding が SARIF へ反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Runs save checks when a TypeScript file is saved', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(pomFilePath, { force: true });
      fs.rmSync(mavenWrapperPath, { force: true });
      fs.rmSync(semgrepWrapperPath, { force: true });
      fs.rmSync(saveSarifPath, { force: true });
      const {
        fixtureDirectory,
        binDirectory,
        typescriptFilePath,
        eslintLogPath,
      } = setupTypeScriptSaveIntegrationFixture(workspaceRoot);
      const restoreEslintLog = createRestoreAction(eslintLogPath);
      fs.rmSync(eslintLogPath, { force: true });

      try {
        setExecutablePathEnvironment(`${binDirectory}${path.delimiter}${originalPath}`);
        fs.appendFileSync(typescriptFilePath, 'console.log(sample);\n', 'utf8');
        await runSaveCommandForTest(workspaceRoot, typescriptFilePath, saveSarifPath);

        await waitFor(() => fs.existsSync(saveSarifPath));
        await waitFor(() => fs.existsSync(eslintLogPath));
        await waitFor(() => /Unexpected console statement\./u.test(fs.readFileSync(saveSarifPath, 'utf8')));

        assert.ok(fs.existsSync(saveSarifPath));
        assert.match(fs.readFileSync(saveSarifPath, 'utf8'), /Unexpected console statement\./u);
        assert.match(fs.readFileSync(eslintLogPath, 'utf8'), /main\.ts/u);
      } finally {
        restoreEslintLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreSaveSarif();
    }
  });

  /**
   * Java 以外のファイル保存では Mamori CLI が自動実行されないこと。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Does not run save checks when a non-Java file is saved', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const fixtureDirectory = path.join(workspaceRoot, '.tmp-save-check-ignored');
    const sourceDirectory = path.join(fixtureDirectory, 'src', 'main', 'resources');
    const textFilePath = path.join(sourceDirectory, 'notes.txt');
    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const mavenLogPath = path.join(workspaceRoot, 'bin', 'mvn.log');
    const semgrepLogPath = path.join(workspaceRoot, 'bin', 'semgrep.log');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreMavenLog = createRestoreAction(mavenLogPath);
    const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(saveSarifPath, { force: true });
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });
      fs.mkdirSync(sourceDirectory, { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, 'bin'), { recursive: true });
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
      writeMavenWrapper(workspaceRoot, mavenLogPath, 'src/main/java/App.java');
      writeSemgrepWrapper(path.join(workspaceRoot, 'bin'), semgrepLogPath, 'src/main/java/App.java');
      fs.writeFileSync(
        textFilePath,
        ['memo', 'updated', ''].join('\n'),
        'utf8',
      );

      const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(textFilePath));
      await activeVscodeApi.window.showTextDocument(document);
      await getMamoriExtension(activeVscodeApi).activate();

      const editor = activeVscodeApi.window.activeTextEditor;
      if (!editor) {
        throw new Error('Active text editor was not found');
      }

      await editor.edit((editBuilder) => {
        editBuilder.insert(new activeVscodeApi.Position(1, 0), 'ignored\n');
      });
      await document.save();
      await delay(1500);

      assert.strictEqual(activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(textFilePath)).length, 0);
      assert.ok(!fs.existsSync(saveSarifPath));
      assert.ok(!fs.existsSync(mavenLogPath));
      assert.ok(!fs.existsSync(semgrepLogPath));
    } finally {
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreMavenLog();
      restoreSemgrepLog();
      restoreSaveSarif();
    }
  });

  /**
   * ワークスペース外ファイルの保存イベントを無視すること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Ignores save events for files outside the workspace', async function() {
    this.timeout(20000);
    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mamori-outside-save-'));
    const javaFilePath = path.join(outsideDirectory, 'Outside.java');
    const pomFilePath = path.join(workspaceRoot, 'pom.xml');
    const mavenWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'mvnw.cmd')
      : path.join(workspaceRoot, 'mvnw');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
      : path.join(workspaceRoot, 'bin', 'semgrep');
    const mavenLogPath = path.join(workspaceRoot, 'bin', 'mvn.log');
    const semgrepLogPath = path.join(workspaceRoot, 'bin', 'semgrep.log');
    const saveSarifPath = path.join(workspaceRoot, SAVE_SARIF_OUTPUT);
    const restorePomFile = createRestoreAction(pomFilePath);
    const restoreMavenWrapper = createRestoreAction(mavenWrapperPath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreMavenLog = createRestoreAction(mavenLogPath);
    const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);

    try {
      fs.rmSync(saveSarifPath, { force: true });
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });
      fs.mkdirSync(path.join(workspaceRoot, 'bin'), { recursive: true });
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
      writeMavenWrapper(workspaceRoot, mavenLogPath, 'Outside.java');
      writeSemgrepWrapper(path.join(workspaceRoot, 'bin'), semgrepLogPath, 'Outside.java');
      fs.writeFileSync(
        javaFilePath,
        ['public class Outside {', '  void run() {}', '}', ''].join('\n'),
        'utf8',
      );

      const document = await activeVscodeApi.workspace.openTextDocument(activeVscodeApi.Uri.file(javaFilePath));
      await activeVscodeApi.window.showTextDocument(document);
      await getMamoriExtension(activeVscodeApi).activate();

      const editor = activeVscodeApi.window.activeTextEditor;
      if (!editor) {
        throw new Error('Active text editor was not found');
      }

      await editor.edit((editBuilder) => {
        editBuilder.insert(new activeVscodeApi.Position(1, 0), '  int value = 1;\n');
      });
      await document.save();
      await delay(1500);

      assert.strictEqual(activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length, 0);
      assert.ok(!fs.existsSync(saveSarifPath));
      assert.ok(!fs.existsSync(mavenLogPath));
      assert.ok(!fs.existsSync(semgrepLogPath));
    } finally {
      fs.rmSync(outsideDirectory, { recursive: true, force: true });
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreMavenLog();
      restoreSemgrepLog();
      restoreSaveSarif();
    }
  });

  /**
   * install 競合 warning が通知と Output Channel に記録されること。
   * @returns 返り値はない。
   */
  /**
   * Git hooks コマンドで pre-commit と pre-push を作成できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Installs and uninstalls Git hooks through managed hook operations', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const {
      preCommitHookPath,
      prePushHookPath,
      restorePreCommitHook,
      restorePrePushHook,
    } = setupHooksFixture(workspaceRoot);

    try {
      await getMamoriExtension(activeVscodeApi).activate();

      await runHooksCommandForTest('install', workspaceRoot);
      await waitFor(() => fs.existsSync(preCommitHookPath) && fs.existsSync(prePushHookPath));

      assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
      assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /--mode precommit --scope staged --execute/u);
      assert.match(fs.readFileSync(prePushHookPath, 'utf8'), /--mode prepush --scope workspace --execute/u);

      await runHooksCommandForTest('uninstall', workspaceRoot);
      await waitFor(() => !fs.existsSync(preCommitHookPath) && !fs.existsSync(prePushHookPath));
    } finally {
      restorePreCommitHook();
      restorePrePushHook();
    }
  });

  /**
   * 未管理の既存 hook がある場合は保持したまま install を継続できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Keeps unmanaged hooks unchanged when managed hook install encounters conflicts', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const {
      preCommitHookPath,
      prePushHookPath,
      restorePreCommitHook,
      restorePrePushHook,
    } = setupHooksFixture(workspaceRoot);

    try {
      fs.writeFileSync(preCommitHookPath, '#!/bin/sh\necho custom hook\n', 'utf8');
      await getMamoriExtension(activeVscodeApi).activate();

      await runHooksCommandForTest('install', workspaceRoot);
      await waitFor(() => fs.existsSync(prePushHookPath));

      assert.match(fs.readFileSync(preCommitHookPath, 'utf8'), /custom hook/u);
      assert.doesNotMatch(fs.readFileSync(preCommitHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
      assert.match(fs.readFileSync(prePushHookPath, 'utf8'), /mamori-inspector-managed-hook/u);
    } finally {
      restorePreCommitHook();
      restorePrePushHook();
    }
  });

  /**
   * 手動実行で Checkstyle finding が Diagnostics と通知へ反映されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Publishes Checkstyle diagnostics when manual workspace checks find Java issues', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const manualSarifPath = path.join(workspaceRoot, '.mamori', 'out', 'combined.sarif');
    const restoreManualSarif = createRestoreAction(manualSarifPath);
    const restorePomFile = createRestoreAction(path.join(workspaceRoot, 'pom.xml'));
    const restoreMavenWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'mvnw.cmd')
        : path.join(workspaceRoot, 'mvnw'),
    );
    const restoreSemgrepWrapper = createRestoreAction(
      process.platform === 'win32'
        ? path.join(workspaceRoot, 'bin', 'semgrep.cmd')
        : path.join(workspaceRoot, 'bin', 'semgrep'),
    );
    const messageCapture = captureWindowMessages(activeVscodeApi);

    try {
      fs.rmSync(manualSarifPath, { force: true });
      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(workspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });

      try {
        setExecutablePathEnvironment(`${path.join(workspaceRoot, 'bin')}${path.delimiter}${originalPath}`);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

        await waitFor(() => fs.existsSync(manualSarifPath));
        await waitFor(() => fs.existsSync(mavenLogPath) && fs.existsSync(semgrepLogPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 3);
        await waitFor(() => messageCapture.informationMessages.length > 0 || messageCapture.errorMessages.length > 0);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath));
        const messages = diagnostics.map((diagnostic) => diagnostic.message);

        assert.deepStrictEqual(messageCapture.errorMessages, []);
        assert.ok(messageCapture.informationMessages.some((message) => getDiagnosticsReflectedPattern(3).test(message)));
        assert.strictEqual(diagnostics.length, 3);
        assert.ok(messages.includes('Missing Javadoc'));
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /checkstyle:check/u);
        assert.ok(fs.existsSync(manualSarifPath));
        assert.match(fs.readFileSync(manualSarifPath, 'utf8'), /Missing Javadoc/u);
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      messageCapture.restore();
      restorePomFile();
      restoreMavenWrapper();
      restoreSemgrepWrapper();
      restoreManualSarif();
    }
  });

  /**
   * 手動実行で SARIF が生成されない場合でも失敗せず 0 件として完了できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Completes workspace checks when manual execution does not generate SARIF output', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const cliScriptPath = path.join(workspaceRoot, '.mamori', 'mamori.js');
    const manualSarifPath = path.join(workspaceRoot, '.mamori', 'out', 'combined.sarif');
    const restoreCliScript = createRestoreAction(cliScriptPath);
    const restoreManualSarif = createRestoreAction(manualSarifPath);
    const messageCapture = captureWindowMessages(activeVscodeApi);

    try {
      fs.rmSync(manualSarifPath, { force: true });
      fs.writeFileSync(
        cliScriptPath,
        [
          '#!/usr/bin/env node',
          'process.exit(0);',
          '',
        ].join('\n'),
        'utf8',
      );
      makeExecutable(cliScriptPath);

      await getMamoriExtension(activeVscodeApi).activate();
      await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

      await waitFor(() => messageCapture.informationMessages.length > 0 || messageCapture.errorMessages.length > 0);

      assert.deepStrictEqual(messageCapture.errorMessages, []);
      assert.strictEqual(messageCapture.informationMessages.length, 1);
      assert.match(messageCapture.informationMessages[0] || '', getDiagnosticsReflectedPattern(0));
      assert.ok(!fs.existsSync(manualSarifPath));
    } finally {
      messageCapture.restore();
      restoreCliScript();
      restoreManualSarif();
    }
  });

  /**
   * 手動実行失敗時に CLI の詳細 warning を通知へ含めること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Reports CLI warning details when manual workspace execution fails', async function() {
    this.timeout(20000);

    const activeVscodeApi = vscodeApi;
    const workspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const cliScriptPath = path.join(workspaceRoot, '.mamori', 'mamori.js');
    const restoreCliScript = createRestoreAction(cliScriptPath);
    const messageCapture = captureWindowMessages(activeVscodeApi);

    try {
      fs.writeFileSync(
        cliScriptPath,
        [
          '#!/usr/bin/env node',
          "process.stdout.write('mamori: execution-result\\n');",
          "process.stdout.write('  summary=executed:1 failed:1 skipped:0\\n');",
          "process.stdout.write('  warnings=semgrep failed to start in D:/workspace/sample: command not found: semgrep\\n');",
          'process.exit(2);',
          '',
        ].join('\n'),
        'utf8',
      );
      makeExecutable(cliScriptPath);

      await getMamoriExtension(activeVscodeApi).activate();
      await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

      await waitFor(() => messageCapture.errorMessages.length > 0 || messageCapture.informationMessages.length > 0);

      assert.deepStrictEqual(messageCapture.informationMessages, []);
      assert.strictEqual(messageCapture.errorMessages.length, 1);
      assert.match(messageCapture.errorMessages[0] || '', /semgrep failed to start/u);
      assert.match(messageCapture.errorMessages[0] || '', /command not found: semgrep/u);
    } finally {
      messageCapture.restore();
      restoreCliScript();
    }
  });

  /**
   * 手動実行で追加ワークスペースの Java finding も集約できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Publishes diagnostics for additional workspace folders during manual workspace checks', async function() {
    this.timeout(30000);

    const activeVscodeApi = vscodeApi;
    const primaryWorkspaceRoot = activeVscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!primaryWorkspaceRoot) {
      throw new Error('Workspace root was not found');
    }

    const secondaryWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mamori-multi-root-'));
    const manualSarifPath = path.join(secondaryWorkspaceRoot, '.mamori', 'out', 'combined.sarif');
    const messageCapture = captureWindowMessages(activeVscodeApi);
    const updateSucceeded = activeVscodeApi.workspace.updateWorkspaceFolders(
      activeVscodeApi.workspace.workspaceFolders?.length || 0,
      0,
      {
        uri: activeVscodeApi.Uri.file(secondaryWorkspaceRoot),
        name: 'mamori-multi-root-fixture',
      },
    );

    if (!updateSucceeded) {
      messageCapture.restore();
      fs.rmSync(secondaryWorkspaceRoot, { recursive: true, force: true });
      throw new Error('Failed to add workspace folder');
    }

    try {
      await waitFor(() => (activeVscodeApi.workspace.workspaceFolders?.length || 0) >= 2);

      const {
        fixtureDirectory,
        javaFilePath,
        mavenLogPath,
        semgrepLogPath,
      } = setupSaveIntegrationFixture(secondaryWorkspaceRoot);
      const restoreMavenLog = createRestoreAction(mavenLogPath);
      const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
      fs.rmSync(mavenLogPath, { force: true });
      fs.rmSync(semgrepLogPath, { force: true });
      fs.rmSync(manualSarifPath, { force: true });

      try {
        setExecutablePathEnvironment(`${path.join(secondaryWorkspaceRoot, 'bin')}${path.delimiter}${originalPath}`);
        await getMamoriExtension(activeVscodeApi).activate();
        await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

        await waitFor(() => fs.existsSync(manualSarifPath));
        await waitFor(() => fs.existsSync(mavenLogPath) && fs.existsSync(semgrepLogPath));
        await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath)).length === 3);
        await waitFor(() => messageCapture.informationMessages.length > 0 || messageCapture.errorMessages.length > 0);

        const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(javaFilePath));
        const messages = diagnostics.map((diagnostic) => diagnostic.message);

        assert.deepStrictEqual(messageCapture.errorMessages, []);
        assert.ok(messageCapture.informationMessages.length >= 1);
        assert.strictEqual(diagnostics.length, 3);
        assert.ok(messages.includes('Missing Javadoc'));
        assert.ok(messages.includes('Unused local variable'));
        assert.ok(messages.includes('Potential issue'));
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /checkstyle:check/u);
        assert.match(fs.readFileSync(mavenLogPath, 'utf8'), /pmd:check/u);
        assert.match(fs.readFileSync(manualSarifPath, 'utf8'), /Unused local variable/u);
      } finally {
        restoreMavenLog();
        restoreSemgrepLog();
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    } finally {
      messageCapture.restore();
      const workspaceFolders = activeVscodeApi.workspace.workspaceFolders || [];
      const secondaryWorkspaceIndex = workspaceFolders.findIndex(
        (workspaceFolder) => workspaceFolder.uri.fsPath === secondaryWorkspaceRoot,
      );
      if (secondaryWorkspaceIndex >= 0) {
        activeVscodeApi.workspace.updateWorkspaceFolders(secondaryWorkspaceIndex, 1);
        await waitFor(() => !(activeVscodeApi.workspace.workspaceFolders || []).some(
          (workspaceFolder) => workspaceFolder.uri.fsPath === secondaryWorkspaceRoot,
        ));
      }
      fs.rmSync(secondaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  /**
   * 外部実プロジェクトを追加した multi-root 手動実行でも PMD finding を反映できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Publishes PMD diagnostics for an external project during manual workspace checks', async function() {
    this.timeout(120000);

    const activeVscodeApi = vscodeApi;
    const realProjectRoot = resolveRealProjectRoot(activeVscodeApi);
    if (!realProjectRoot || !fs.existsSync(realProjectRoot)) {
      this.skip();
      return;
    }

    const pmdReportPath = path.join(realProjectRoot, 'target', 'pmd.xml');
    const firstViolation = findFirstPmdViolation(pmdReportPath);
    if (!firstViolation || !fs.existsSync(firstViolation.filePath)) {
      this.skip();
      return;
    }
    const semgrepBinDirectory = path.join(realProjectRoot, 'bin');
    const semgrepLogPath = path.join(semgrepBinDirectory, 'semgrep.log');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(semgrepBinDirectory, 'semgrep.cmd')
      : path.join(semgrepBinDirectory, 'semgrep');
    const manualSarifPath = path.join(realProjectRoot, '.mamori', 'out', 'combined.sarif');
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
    const messageCapture = captureWindowMessages(activeVscodeApi);
    const alreadyOpened = (activeVscodeApi.workspace.workspaceFolders || []).some(
      (workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot,
    );
    const updateSucceeded = activeVscodeApi.workspace.updateWorkspaceFolders(
      activeVscodeApi.workspace.workspaceFolders?.length || 0,
      0,
      {
        uri: activeVscodeApi.Uri.file(realProjectRoot),
        name: 'mamori-real-project',
      },
    );

    if (!updateSucceeded && !alreadyOpened) {
      messageCapture.restore();
      throw new Error('Failed to add external project workspace folder');
    }

    try {
      await waitFor(() => (activeVscodeApi.workspace.workspaceFolders?.length || 0) >= 2);
      fs.mkdirSync(semgrepBinDirectory, { recursive: true });
      fs.rmSync(semgrepLogPath, { force: true });
      writeEmptySemgrepWrapper(semgrepBinDirectory, semgrepLogPath);
      fs.rmSync(manualSarifPath, { force: true });
      setSemgrepCommandOverride(semgrepWrapperPath);
      setExecutablePathEnvironment(`${semgrepBinDirectory}${path.delimiter}${originalPath}`);

      await getMamoriExtension(activeVscodeApi).activate();
      await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

      await waitFor(() => fs.existsSync(manualSarifPath), 120000);
      await waitFor(() => messageCapture.informationMessages.length > 0 || messageCapture.errorMessages.length > 0, 120000);
      await waitFor(
        () => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(firstViolation.filePath)).some(
          (diagnostic) => diagnostic.message === firstViolation.message,
        ),
        120000,
      );

      const diagnostics = activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(firstViolation.filePath));
      const messages = diagnostics.map((diagnostic) => diagnostic.message);
      const sarifFindings = loadSarifFindings(manualSarifPath);

      assert.deepStrictEqual(messageCapture.errorMessages, []);
      assert.ok(messageCapture.informationMessages.length >= 1);
      assert.ok(messages.includes(firstViolation.message));
      assert.ok(sarifFindings.some((finding) => finding.message === firstViolation.message));
    } finally {
      messageCapture.restore();
      restoreSemgrepWrapper();
      restoreSemgrepLog();
      const workspaceFolders = activeVscodeApi.workspace.workspaceFolders || [];
      const secondaryWorkspaceIndex = workspaceFolders.findIndex(
        (workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot,
      );
      if (secondaryWorkspaceIndex >= 0) {
        activeVscodeApi.workspace.updateWorkspaceFolders(secondaryWorkspaceIndex, 1);
      }
    }
  });

  /**
   * 外部実プロジェクトの Java 保存時に、実際に開始した各ツール名だけを個別トーストで表示すること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Shows single-tool save toasts for an external Java project file', async function() {
    this.timeout(180000);

    const activeVscodeApi = vscodeApi;
    const realProjectRoot = resolveRealProjectRoot(activeVscodeApi);
    const targetFilePath = realProjectRoot
      ? path.join(
        realProjectRoot,
        'src',
        'main',
        'java',
        'jp',
        'meibinlab',
        'wrapper',
        'service',
        'ApplicationTaskService.java',
      )
      : '';
    if (!realProjectRoot || !fs.existsSync(targetFilePath)) {
      this.skip();
      return;
    }

    const targetFileUri = activeVscodeApi.Uri.file(targetFilePath);
    const saveSarifPath = path.join(realProjectRoot, SAVE_SARIF_OUTPUT);
    const semgrepBinDirectory = path.join(realProjectRoot, 'bin');
    const semgrepLogPath = path.join(semgrepBinDirectory, 'semgrep.log');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(semgrepBinDirectory, 'semgrep.cmd')
      : path.join(semgrepBinDirectory, 'semgrep');
    const restoreTargetFile = createRestoreAction(targetFilePath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);
    const messageCapture = captureWindowMessages(activeVscodeApi);
    const outputCapture = captureOutputChannelLines(activeVscodeApi, 'Mamori Inspector');
    const alreadyOpened = (activeVscodeApi.workspace.workspaceFolders || []).some(
      (workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot,
    );
    const updateSucceeded = activeVscodeApi.workspace.updateWorkspaceFolders(
      activeVscodeApi.workspace.workspaceFolders?.length || 0,
      0,
      {
        uri: activeVscodeApi.Uri.file(realProjectRoot),
        name: 'mamori-real-project-save-toast',
      },
    );

    if (!updateSucceeded && !alreadyOpened) {
      messageCapture.restore();
      outputCapture.restore();
      throw new Error('Failed to add external project workspace folder');
    }

    try {
      let targetDocumentSaved = false;
      const saveListener = activeVscodeApi.workspace.onDidSaveTextDocument((savedDocument) => {
        if (savedDocument.uri.fsPath === targetFilePath) {
          targetDocumentSaved = true;
        }
      });
      try {
        await waitFor(() => (activeVscodeApi.workspace.workspaceFolders?.length || 0) >= 2);
        fs.mkdirSync(semgrepBinDirectory, { recursive: true });
        fs.rmSync(semgrepLogPath, { force: true });
        fs.rmSync(saveSarifPath, { force: true });
        writeEmptySemgrepWrapper(semgrepBinDirectory, semgrepLogPath);
        setSemgrepCommandOverride(semgrepWrapperPath);
        setExecutablePathEnvironment(`${semgrepBinDirectory}${path.delimiter}${originalPath}`);

        await getMamoriExtension(activeVscodeApi).activate();
        const document = await activeVscodeApi.workspace.openTextDocument(targetFileUri);
        await activeVscodeApi.window.showTextDocument(document);
        await activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).update(
          'enabled',
          true,
          activeVscodeApi.ConfigurationTarget.Workspace,
        );
        await waitFor(
          () => activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).get<boolean>('enabled', false),
          120000,
        );
        const informationCountBeforeSave = messageCapture.informationMessages.length;

        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        const originalText = document.getText();
        const insertionOffset = originalText.indexOf('  public void saveError(');
        if (insertionOffset < 0) {
          throw new Error('Target method signature was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.insert(document.positionAt(insertionOffset), '\n');
        });
        await document.save();

        await waitFor(() => targetDocumentSaved, 120000);
        await waitFor(
          () => outputCapture.outputLines.some(
            (line) => line === `Mamori Inspector save check started for ${targetFilePath}.`,
          ),
          120000,
        );
        await waitFor(() => fs.existsSync(saveSarifPath), 120000);
        await waitFor(() => {
          const saveRunMessages = messageCapture.informationMessages.slice(informationCountBeforeSave);
          return saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Spotless')
            && saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Checkstyle')
            && saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - PMD')
            && saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Semgrep');
        }, 120000);

        const saveRunMessages = messageCapture.informationMessages.slice(informationCountBeforeSave);

        assert.deepStrictEqual(messageCapture.errorMessages, []);
        assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Spotless'));
        assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Checkstyle'));
        assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - PMD'));
        assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Semgrep'));
        assert.match(fs.readFileSync(semgrepLogPath, 'utf8'), /ApplicationTaskService\.java/u);
      } finally {
        saveListener.dispose();
      }
    } finally {
      messageCapture.restore();
      outputCapture.restore();
      restoreTargetFile();
      restoreSemgrepWrapper();
      restoreSemgrepLog();
      restoreSaveSarif();
      await activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).update(
        'enabled',
        undefined,
        activeVscodeApi.ConfigurationTarget.Workspace,
      );
      await updateWorkspaceMamoriEnabledSetting(activeVscodeApi, realProjectRoot, undefined);
      const workspaceFolders = activeVscodeApi.workspace.workspaceFolders || [];
      const secondaryWorkspaceIndex = workspaceFolders.findIndex(
        (workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot,
      );
      if (secondaryWorkspaceIndex >= 0) {
        activeVscodeApi.workspace.updateWorkspaceFolders(secondaryWorkspaceIndex, 1);
      }
    }
  });

  /**
   * 外部実プロジェクトで手動実行後に対象 PMD finding を修正して保存すると、save 結果と Problems の両方から消えること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Clears manual PMD diagnostics after a clean save check for ApplicationTaskService in an external project', async function() {
    this.timeout(240000);

    const activeVscodeApi = vscodeApi;
    const realProjectRoot = resolveRealProjectRoot(activeVscodeApi);
    const targetFilePath = realProjectRoot
      ? path.join(
        realProjectRoot,
        'src',
        'main',
        'java',
        'jp',
        'meibinlab',
        'wrapper',
        'service',
        'ApplicationTaskService.java',
      )
      : '';
    if (!realProjectRoot || !fs.existsSync(targetFilePath)) {
      this.skip();
      return;
    }
    const externalWorkspaceUri = activeVscodeApi.Uri.file(realProjectRoot);
    const targetFileUri = activeVscodeApi.Uri.file(targetFilePath);
    const targetMessage = "Parameter 'e' is not assigned and could be declared final";
    const originalSignature = 'public void saveError(ApplicationTask task, long runningTime, Exception e) {';
    const updatedSignature = 'public void saveError(ApplicationTask task, long runningTime, final Exception e) {';
    const targetFileSuffix = 'jp/meibinlab/wrapper/service/ApplicationTaskService.java';
    const semgrepBinDirectory = path.join(realProjectRoot, 'bin');
    const semgrepLogPath = path.join(semgrepBinDirectory, 'semgrep.log');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(semgrepBinDirectory, 'semgrep.cmd')
      : path.join(semgrepBinDirectory, 'semgrep');
    const manualSarifPath = path.join(realProjectRoot, '.mamori', 'out', 'combined.sarif');
    const saveSarifPath = path.join(realProjectRoot, SAVE_SARIF_OUTPUT);
    const restoreTargetFile = createRestoreAction(targetFilePath);
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
    const restoreManualSarif = createRestoreAction(manualSarifPath);
    const restoreSaveSarif = createRestoreAction(saveSarifPath);
    const messageCapture = captureWindowMessages(activeVscodeApi);
    const alreadyOpened = (activeVscodeApi.workspace.workspaceFolders || []).some(
      (workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot,
    );
    const updateSucceeded = activeVscodeApi.workspace.updateWorkspaceFolders(
      activeVscodeApi.workspace.workspaceFolders?.length || 0,
      0,
      {
        uri: externalWorkspaceUri,
        name: 'mamori-real-project-save-check',
      },
    );

    if (!updateSucceeded && !alreadyOpened) {
      messageCapture.restore();
      throw new Error('Failed to add external project workspace folder');
    }

    try {
      await waitFor(() => (activeVscodeApi.workspace.workspaceFolders?.length || 0) >= 2);
      fs.mkdirSync(semgrepBinDirectory, { recursive: true });
      fs.rmSync(semgrepLogPath, { force: true });
      fs.rmSync(manualSarifPath, { force: true });
      fs.rmSync(saveSarifPath, { force: true });
      writeEmptySemgrepWrapper(semgrepBinDirectory, semgrepLogPath);
      setSemgrepCommandOverride(semgrepWrapperPath);
      setExecutablePathEnvironment(`${semgrepBinDirectory}${path.delimiter}${originalPath}`);

      await getMamoriExtension(activeVscodeApi).activate();
      const document = await activeVscodeApi.workspace.openTextDocument(targetFileUri);
      await activeVscodeApi.window.showTextDocument(document);

      await activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).update(
        'enabled',
        false,
        activeVscodeApi.ConfigurationTarget.Workspace,
      );
      await waitFor(
        () => !activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).get<boolean>('enabled', false),
        120000,
      );

      const setupEditor = activeVscodeApi.window.activeTextEditor;
      if (!setupEditor) {
        throw new Error('Active text editor was not found');
      }

      const existingText = document.getText();
      const existingSignatureOffset = existingText.indexOf(updatedSignature);
      if (existingSignatureOffset >= 0) {
        await setupEditor.edit((editBuilder) => {
          editBuilder.replace(
            new activeVscodeApi.Range(
              document.positionAt(existingSignatureOffset),
              document.positionAt(existingSignatureOffset + updatedSignature.length),
            ),
            originalSignature,
          );
        });
        await document.save();
      } else if (!existingText.includes(originalSignature)) {
        throw new Error('Target method signature was not found');
      }

      await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');

      await waitFor(() => fs.existsSync(manualSarifPath), 120000);
      await waitFor(
        () => activeVscodeApi.languages.getDiagnostics(targetFileUri).some(
          (diagnostic) => diagnostic.message === targetMessage,
        ),
        120000,
      );

      await activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).update(
        'enabled',
        true,
        activeVscodeApi.ConfigurationTarget.Workspace,
      );
      await waitFor(
        () => activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).get<boolean>('enabled', false),
        120000,
      );

      const informationCountBeforeSave = messageCapture.informationMessages.length;
      let targetDocumentSaved = false;
      const saveListener = activeVscodeApi.workspace.onDidSaveTextDocument((savedDocument) => {
        if (savedDocument.uri.fsPath === targetFilePath) {
          targetDocumentSaved = true;
        }
      });

      try {
        const editor = activeVscodeApi.window.activeTextEditor;
        if (!editor) {
          throw new Error('Active text editor was not found');
        }

        const signatureOffset = document.getText().indexOf(originalSignature);
        if (signatureOffset < 0) {
          throw new Error('Target method signature was not found');
        }

        await editor.edit((editBuilder) => {
          editBuilder.replace(
            new activeVscodeApi.Range(
              document.positionAt(signatureOffset),
              document.positionAt(signatureOffset + originalSignature.length),
            ),
            updatedSignature,
          );
        });
        await document.save();

        await waitFor(() => targetDocumentSaved, 120000);
        await waitFor(() => fs.existsSync(saveSarifPath), 120000);
        await waitFor(
          () => !activeVscodeApi.languages.getDiagnostics(targetFileUri).some(
            (diagnostic) => diagnostic.message === targetMessage,
          ),
          120000,
        );
        await waitFor(() => {
          const saveRunMessages = messageCapture.informationMessages.slice(informationCountBeforeSave);
          return saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Spotless')
            && saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Checkstyle')
            && saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - PMD')
            && saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Semgrep');
        }, 120000);
      } finally {
        saveListener.dispose();
      }

      const diagnosticsAfterSave = activeVscodeApi.languages.getDiagnostics(targetFileUri);
      const saveFindings = loadSarifFindings(saveSarifPath);
      const saveFindingMessages = saveFindings
        .filter((finding) => finding.uri.replaceAll('\\', '/').endsWith(targetFileSuffix))
        .map((finding) => finding.message);
      const saveRunMessages = messageCapture.informationMessages.slice(informationCountBeforeSave);

      assert.deepStrictEqual(messageCapture.errorMessages, []);
      assert.ok(!diagnosticsAfterSave.some((diagnostic) => diagnostic.message === targetMessage));
      assert.ok(!saveFindingMessages.includes(targetMessage));
      assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Spotless'));
      assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Checkstyle'));
      assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - PMD'));
      assert.ok(saveRunMessages.includes('Mamori Inspector: ApplicationTaskService.java - Semgrep'));
    } finally {
      messageCapture.restore();
      restoreTargetFile();
      restoreSemgrepWrapper();
      restoreSemgrepLog();
      restoreManualSarif();
      restoreSaveSarif();
      await activeVscodeApi.workspace.getConfiguration('mamori-inspector', targetFileUri).update(
        'enabled',
        undefined,
        activeVscodeApi.ConfigurationTarget.Workspace,
      );
      await updateWorkspaceMamoriEnabledSetting(activeVscodeApi, realProjectRoot, undefined);
      const workspaceFolders = activeVscodeApi.workspace.workspaceFolders || [];
      const secondaryWorkspaceIndex = workspaceFolders.findIndex(
        (workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot,
      );
      if (secondaryWorkspaceIndex >= 0) {
        activeVscodeApi.workspace.updateWorkspaceFolders(secondaryWorkspaceIndex, 1);
      }
    }
  });

  /**
   * 外部実プロジェクトを手動実行したとき、workspace enable 設定に関わらず Diagnostics 件数を計測できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Measures external project diagnostics counts for manual workspace checks with workspace enablement toggled', async function() {
    this.timeout(180000);

    const activeVscodeApi = vscodeApi;
    const realProjectRoot = resolveRealProjectRoot(activeVscodeApi);
    if (!realProjectRoot || !fs.existsSync(realProjectRoot)) {
      this.skip();
      return;
    }

    const pmdReportPath = path.join(realProjectRoot, 'target', 'pmd.xml');
    const firstViolation = findFirstPmdViolation(pmdReportPath);
    if (!firstViolation || !fs.existsSync(firstViolation.filePath)) {
      this.skip();
      return;
    }
    const externalWorkspaceUri = activeVscodeApi.Uri.file(realProjectRoot);
    const semgrepBinDirectory = path.join(realProjectRoot, 'bin');
    const semgrepLogPath = path.join(semgrepBinDirectory, 'semgrep.log');
    const semgrepWrapperPath = process.platform === 'win32'
      ? path.join(semgrepBinDirectory, 'semgrep.cmd')
      : path.join(semgrepBinDirectory, 'semgrep');
    const manualSarifPath = path.join(realProjectRoot, '.mamori', 'out', 'combined.sarif');
    const restoreSemgrepWrapper = createRestoreAction(semgrepWrapperPath);
    const restoreSemgrepLog = createRestoreAction(semgrepLogPath);
    const messageCapture = captureWindowMessages(activeVscodeApi);
    const alreadyOpened = (activeVscodeApi.workspace.workspaceFolders || []).some((workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot);
    const updateSucceeded = activeVscodeApi.workspace.updateWorkspaceFolders(activeVscodeApi.workspace.workspaceFolders?.length || 0, 0, {
      uri: externalWorkspaceUri,
      name: 'mamori-real-project-measurement',
    });

    if (!updateSucceeded && !alreadyOpened) {
      messageCapture.restore();
      throw new Error('Failed to add external project workspace folder');
    }

    const manualRunCounts: number[] = [];
    const runManualWorkspaceCheck = async(enabled: boolean): Promise<number> => {
      await updateWorkspaceMamoriEnabledSetting(activeVscodeApi, realProjectRoot, enabled);

      const informationCountBeforeRun = messageCapture.informationMessages.length;
      const errorCountBeforeRun = messageCapture.errorMessages.length;
      await activeVscodeApi.commands.executeCommand('mamori-inspector.runWorkspaceCheck');
      await waitFor(() => messageCapture.informationMessages.length > informationCountBeforeRun || messageCapture.errorMessages.length > errorCountBeforeRun, 120000);
      await waitFor(() => countWorkspaceDiagnostics(activeVscodeApi, realProjectRoot) > 0, 120000);
      await waitFor(() => activeVscodeApi.languages.getDiagnostics(activeVscodeApi.Uri.file(firstViolation.filePath)).some((diagnostic) => diagnostic.message === firstViolation.message), 120000);
      return countWorkspaceDiagnostics(activeVscodeApi, realProjectRoot);
    };

    try {
      await waitFor(() => (activeVscodeApi.workspace.workspaceFolders?.length || 0) >= 2);
      fs.mkdirSync(semgrepBinDirectory, { recursive: true });
      fs.rmSync(semgrepLogPath, { force: true });
      writeEmptySemgrepWrapper(semgrepBinDirectory, semgrepLogPath);
      fs.rmSync(manualSarifPath, { force: true });
      setExecutablePathEnvironment(`${semgrepBinDirectory}${path.delimiter}${originalPath}`);
      await getMamoriExtension(activeVscodeApi).activate();

      manualRunCounts.push(await runManualWorkspaceCheck(false));
      manualRunCounts.push(await runManualWorkspaceCheck(true));

      const sarifFindings = loadSarifFindings(manualSarifPath);
      assert.deepStrictEqual(messageCapture.errorMessages, []);
      assert.strictEqual(manualRunCounts[0], sarifFindings.length);
      assert.strictEqual(manualRunCounts[1], sarifFindings.length);
    } finally {
      messageCapture.restore();
      restoreSemgrepWrapper();
      restoreSemgrepLog();
      await updateWorkspaceMamoriEnabledSetting(activeVscodeApi, realProjectRoot, undefined);
      const workspaceFolders = activeVscodeApi.workspace.workspaceFolders || [];
      const secondaryWorkspaceIndex = workspaceFolders.findIndex((workspaceFolder) => workspaceFolder.uri.fsPath === realProjectRoot);
      if (secondaryWorkspaceIndex >= 0) {
        activeVscodeApi.workspace.updateWorkspaceFolders(secondaryWorkspaceIndex, 1);
      }
    }
  });
});
