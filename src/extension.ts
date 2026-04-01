// VS Code 拡張APIを表す
import * as vscode from 'vscode';
// 子プロセス実行 API を表す
import { spawn } from 'child_process';
// Node のファイルシステム API を表す
import * as fs from 'fs';
// Node のパス操作 API を表す
import * as path from 'path';
// hooks 成功通知の整形処理を表す
import {
  reportHooksCommandSuccess,
  type HooksCommandMessages,
  type MamoriHooksAction,
} from './hooks-command-report';
// SARIF Diagnostics 変換器を表す
import { loadSarifFindings, SarifFinding } from './sarif-diagnostics';
// 保存時チェックのスケジューラーを表す
import { SaveCheckScheduler } from './save-check-scheduler';

// 診断コレクション名を表す
const DIAGNOSTIC_COLLECTION_NAME = 'mamori-inspector';
// 手動実行向けの SARIF 出力先を表す
const MANUAL_SARIF_OUTPUT = path.join('.mamori', 'out', 'combined.sarif');
// 保存時実行向けの SARIF 出力先を表す
const SAVE_SARIF_OUTPUT = path.join('.mamori', 'out', 'combined-save.sarif');
// 保存時自動チェック対象の言語一覧を表す
const AUTO_SAVE_LANGUAGE_IDS = new Set([
  'java',
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'css',
  'scss',
  'sass',
  'html',
]);
// 実行中の追随再実行を抑止する拡張子一覧を表す
const AUTO_SAVE_NON_QUEUE_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
  '.css',
  '.scss',
  '.sass',
  '.html',
  '.htm',
]);
// 保存時チェックのデバウンス時間を表す
const SAVE_DEBOUNCE_MILLISECONDS = 400;
// 自己再帰抑止時間を表す
const SAVE_SUPPRESSION_MILLISECONDS = 1500;

/** ローカライズ埋め込み引数を表す。 */
type LocalizationArguments = Array<string | number | boolean> | Record<string, string | number | boolean>;

/**
 * 既定英語文言をローカライズする。
 * @param message 既定文言を表す。
 * @param comment 翻訳向け補足を表す。
 * @param args 埋め込み引数を表す。
 * @returns ローカライズ済み文言を返す。
 */
function localize(
  message: string,
  comment: string | string[],
  args?: LocalizationArguments,
): string {
  return vscode.l10n.t({ message, comment, args });
}

/**
 * ワークスペース未選択時の警告文言を返す。
 * @returns 警告文言を返す。
 */
function getOpenWorkspaceMessage(): string {
  return localize(
    'Mamori Inspector: Open a workspace first.',
    'Warning message shown when a command requires an open workspace.',
  );
}

/**
 * ワークスペース選択プレースホルダーを返す。
 * @returns プレースホルダー文言を返す。
 */
function getWorkspaceSelectionPlaceholder(): string {
  return localize(
    'Select the workspace for Mamori Inspector.',
    'Placeholder text shown when the user must choose a workspace folder.',
  );
}

/**
 * hooks 進捗タイトルを返す。
 * @param action hooks 操作種別を表す。
 * @returns 進捗タイトルを返す。
 */
function getHooksProgressTitle(action: MamoriHooksAction): string {
  return action === 'install'
    ? localize(
      'Installing Mamori Inspector Git hooks',
      'Progress notification title while installing Git hooks.',
    )
    : localize(
      'Uninstalling Mamori Inspector Git hooks',
      'Progress notification title while uninstalling Git hooks.',
    );
}

/**
 * hooks 失敗通知文言を返す。
 * @param action hooks 操作種別を表す。
 * @param details 失敗詳細を表す。
 * @returns エラー通知文言を返す。
 */
function getHooksFailureMessage(action: MamoriHooksAction, details: string): string {
  return action === 'install'
    ? localize(
      'Mamori Inspector: Failed to install Git hooks. {0}',
      'Error message shown when installing Git hooks fails.',
      [details],
    )
    : localize(
      'Mamori Inspector: Failed to uninstall Git hooks. {0}',
      'Error message shown when uninstalling Git hooks fails.',
      [details],
    );
}

/**
 * hooks 成功通知文言を返す。
 * @returns hooks 通知文言を返す。
 */
function getHooksCommandMessages(): HooksCommandMessages {
  return {
    installSuccessMessage: localize(
      'Mamori Inspector: Installed Git hooks.',
      'Information message shown after Git hooks are installed successfully.',
    ),
    uninstallSuccessMessage: localize(
      'Mamori Inspector: Uninstalled Git hooks.',
      'Information message shown after Git hooks are uninstalled successfully.',
    ),
    buildWarningMessage: (warnings: string) => localize(
      'Mamori Inspector: Git hooks were processed, but some hooks were left unchanged. {0}',
      'Warning message shown when Git hooks processing succeeds with skipped hooks.',
      [warnings],
    ),
  };
}

/**
 * 保守コマンド進捗タイトルを返す。
 * @param action 保守コマンド種別を表す。
 * @returns 進捗タイトルを返す。
 */
function getMaintenanceProgressTitle(action: MamoriMaintenanceAction): string {
  return action === 'setup'
    ? localize(
      'Setting up Mamori Inspector managed tools',
      'Progress notification title while managed tools are being set up.',
    )
    : localize(
      'Clearing Mamori Inspector cache',
      'Progress notification title while the extension cache is being cleared.',
    );
}

/**
 * 保守コマンド成功通知文言を返す。
 * @param action 保守コマンド種別を表す。
 * @returns 情報通知文言を返す。
 */
function getMaintenanceSuccessMessage(action: MamoriMaintenanceAction): string {
  return action === 'setup'
    ? localize(
      'Mamori Inspector: Set up managed tools.',
      'Information message shown after managed tools are set up successfully.',
    )
    : localize(
      'Mamori Inspector: Cleared the cache.',
      'Information message shown after the extension cache is cleared successfully.',
    );
}

/**
 * 保守コマンド失敗通知文言を返す。
 * @param action 保守コマンド種別を表す。
 * @param details 失敗詳細を表す。
 * @returns エラー通知文言を返す。
 */
function getMaintenanceFailureMessage(action: MamoriMaintenanceAction, details: string): string {
  return action === 'setup'
    ? localize(
      'Mamori Inspector: Failed to set up managed tools. {0}',
      'Error message shown when managed tools setup fails.',
      [details],
    )
    : localize(
      'Mamori Inspector: Failed to clear the cache. {0}',
      'Error message shown when cache clearing fails.',
      [details],
    );
}

/**
 * 保存時チェック結果のステータスバー文言を返す。
 * @param diagnosticsCount 診断件数を表す。
 * @returns ステータスバー文言を返す。
 */
function getSaveCheckStatusMessage(diagnosticsCount: number): string {
  return localize(
    'Mamori Inspector: Reflected {0} save-check diagnostics.',
    'Status bar message shown after save-check diagnostics are published.',
    [diagnosticsCount],
  );
}

/**
 * 利用可能ワークスペースなしの警告文言を返す。
 * @returns 警告文言を返す。
 */
function getNoAvailableWorkspaceMessage(): string {
  return localize(
    'Mamori Inspector: No available workspace folders were found.',
    'Warning message shown when all workspace folders are missing.',
  );
}

/**
 * 手動実行の進捗タイトルを返す。
 * @returns 進捗タイトルを返す。
 */
function getWorkspaceCheckProgressTitle(): string {
  return localize(
    'Running Mamori Inspector',
    'Progress notification title while a manual workspace check is running.',
  );
}

/**
 * 手動実行成功通知文言を返す。
 * @param diagnosticsCount 診断件数を表す。
 * @returns 情報通知文言を返す。
 */
function getWorkspaceCheckSuccessMessage(diagnosticsCount: number): string {
  return localize(
    'Mamori Inspector: Reflected {0} diagnostics.',
    'Information message shown after a manual workspace check publishes diagnostics.',
    [diagnosticsCount],
  );
}

/**
 * 手動実行失敗通知文言を返す。
 * @param details 失敗詳細を表す。
 * @returns エラー通知文言を返す。
 */
function getWorkspaceCheckFailureMessage(details: string): string {
  return localize(
    'Mamori Inspector: Execution failed. {0}',
    'Error message shown when a manual workspace check fails.',
    [details],
  );
}

/**
 * Mamori CLI 実行条件を表す。
 */
interface MamoriCliRunOptions {
  /** 実行モードを表す。 */
  mode: 'manual' | 'save';
  /** 実行スコープを表す。 */
  scope: 'workspace' | 'file';
  /** SARIF 出力パスを表す。 */
  sarifOutputPath: string;
  /** 対象ファイル一覧を表す。 */
  files?: string[];
}

/**
 * Mamori CLI 実行結果を表す。
 */
interface MamoriCliCommandResult {
  /** 標準出力を表す。 */
  stdout: string;
  /** 標準エラー出力を表す。 */
  stderr: string;
}

/**
 * Mamori CLI の保守コマンド種別を表す。
 */
type MamoriMaintenanceAction = 'setup' | 'cache-clear';

/**
 * URI ごとの Diagnostics 収集結果を表す。
 */
interface DiagnosticsByUriEntry {
  /** 対象 URI を表す。 */
  uri: vscode.Uri;
  /** Diagnostics 一覧を表す。 */
  diagnostics: vscode.Diagnostic[];
}

/**
 * ワークスペース直下の Mamori CLI パスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns CLI スクリプトパスを返す。
 */
function getWorkspaceMamoriCliPath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, '.mamori', 'mamori.js');
}

/**
 * 拡張同梱の Mamori CLI パスを返す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns CLI スクリプトパスを返す。
 */
function getBundledMamoriCliPath(extensionRootPath: string): string {
  return path.join(extensionRootPath, '.mamori', 'mamori.js');
}

/**
 * 実行に利用する Mamori CLI パスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns 利用する CLI スクリプトパスを返す。
 */
function getMamoriCliPath(workspaceFolder: vscode.WorkspaceFolder, extensionRootPath: string): string {
  const workspaceCliPath = getWorkspaceMamoriCliPath(workspaceFolder);
  if (fs.existsSync(workspaceCliPath)) {
    return workspaceCliPath;
  }

  return getBundledMamoriCliPath(extensionRootPath);
}

/**
 * Mamori CLI の実行に使う親プロセスを返す。
 * @returns 実行ファイルパスを返す。
 */
function getMamoriCliExecutablePath(): string {
  const configuredExecutablePath = process.env.MAMORI_CLI_NODE_PATH;
  if (configuredExecutablePath && fs.existsSync(configuredExecutablePath)) {
    return configuredExecutablePath;
  }

  return process.execPath;
}

/**
 * Mamori CLI 失敗時に表示する詳細メッセージを返す。
 * @param stdout 標準出力を表す。
 * @param stderr 標準エラー出力を表す。
 * @param code 終了コードを表す。
 * @returns 利用者向けの失敗詳細を返す。
 */
function getMamoriCliFailureMessage(stdout: string, stderr: string, code: number | null): string {
  const normalizedStderr = stderr.trim();
  if (normalizedStderr !== '') {
    return normalizedStderr;
  }

  const normalizedStdout = stdout.trim();
  if (normalizedStdout === '') {
    return `Mamori CLI exited with code ${String(code)}`;
  }

  const warningMatch = normalizedStdout.match(/(?:^|\r?\n)\s*warnings=(.+)$/mu);
  if (warningMatch && warningMatch[1]) {
    return warningMatch[1].trim();
  }

  const errorMatch = normalizedStdout.match(/(?:^|\r?\n)\s*-\s+([^\r\n]+:error message=.+)$/mu);
  if (errorMatch && errorMatch[1]) {
    return errorMatch[1].trim();
  }

  const lines = normalizedStdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1) || `Mamori CLI exited with code ${String(code)}`;
}

/**
 * ワークスペース向けの既定 SARIF パスを返す。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns SARIF パスを返す。
 */
function getSarifOutputPath(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): string {
  return path.join(workspaceFolder.uri.fsPath, relativePath);
}

/**
 * Mamori CLI の引数一覧を構築する。
 * @param options 実行条件を表す。
 * @returns CLI 引数一覧を返す。
 */
function buildMamoriCliArguments(options: MamoriCliRunOptions): string[] {
  const argumentsList = [
    'run',
    '--mode',
    options.mode,
    '--scope',
    options.scope,
    '--execute',
    '--sarif-output',
    options.sarifOutputPath,
  ];

  if (options.scope === 'file' && Array.isArray(options.files) && options.files.length > 0) {
    argumentsList.push('--files', options.files.join(','));
  }

  return argumentsList;
}

/**
 * Mamori hooks CLI の引数一覧を構築する。
 * @param action hooks 操作種別を表す。
 * @returns CLI 引数一覧を返す。
 */
function buildMamoriHooksArguments(action: MamoriHooksAction): string[] {
  return ['hooks', action];
}

/**
 * Mamori 保守コマンドの引数一覧を構築する。
 * @param action 保守コマンド種別を表す。
 * @returns CLI 引数一覧を返す。
 */
function buildMamoriMaintenanceArguments(action: MamoriMaintenanceAction): string[] {
  return [action];
}

/**
 * SARIF level を VS Code の重要度へ変換する。
 * @param level SARIF level を表す。
 * @returns VS Code の重要度を返す。
 */
function toDiagnosticSeverity(level: string | undefined): vscode.DiagnosticSeverity {
  switch (level) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'note':
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/**
 * SARIF finding の URI を VS Code URI へ変換する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param finding SARIF finding を表す。
 * @returns VS Code URI を返す。
 */
function toDocumentUri(workspaceFolder: vscode.WorkspaceFolder, finding: SarifFinding): vscode.Uri {
  if (path.isAbsolute(finding.uri)) {
    return vscode.Uri.file(finding.uri);
  }

  return vscode.Uri.file(path.resolve(workspaceFolder.uri.fsPath, finding.uri));
}

/**
 * Mamori CLI を実行する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @returns 実行完了を待つ Promise を返す。
 */
function runMamoriCli(
  workspaceFolder: vscode.WorkspaceFolder,
  options: MamoriCliRunOptions,
  extensionRootPath: string,
): Promise<MamoriCliCommandResult> {
  return runMamoriCliCommand(workspaceFolder, buildMamoriCliArguments(options), extensionRootPath);
}

/**
 * 任意の Mamori CLI 引数を実行する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param argumentsList CLI 引数一覧を表す。
 * @returns 実行完了を待つ Promise を返す。
 */
function runMamoriCliCommand(
  workspaceFolder: vscode.WorkspaceFolder,
  argumentsList: string[],
  extensionRootPath: string,
): Promise<MamoriCliCommandResult> {
  const cliPath = getMamoriCliPath(workspaceFolder, extensionRootPath);
  const cliExecutablePath = getMamoriCliExecutablePath();

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(workspaceFolder.uri.fsPath)) {
      reject(new Error(`Workspace folder was not found: ${workspaceFolder.uri.fsPath}`));
      return;
    }

    if (!fs.existsSync(cliPath)) {
      reject(new Error(`Mamori CLI was not found: ${cliPath}`));
      return;
    }

    const child = spawn(
      cliExecutablePath,
      [cliPath, ...argumentsList],
      {
        cwd: workspaceFolder.uri.fsPath,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (typeof code === 'number' && code <= 1) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(getMamoriCliFailureMessage(stdout, stderr, code ?? null)));
    });
  });
}

/**
 * 存在するワークスペースフォルダーだけを返す。
 * @param workspaceFolders ワークスペースフォルダー一覧を表す。
 * @param outputChannel 出力チャネルを表す。
 * @returns 存在するワークスペースフォルダー一覧を返す。
 */
function filterExistingWorkspaceFolders(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  outputChannel: vscode.OutputChannel,
): vscode.WorkspaceFolder[] {
  const existingWorkspaceFolders: vscode.WorkspaceFolder[] = [];

  for (const workspaceFolder of workspaceFolders) {
    if (fs.existsSync(workspaceFolder.uri.fsPath)) {
      existingWorkspaceFolders.push(workspaceFolder);
      continue;
    }

    outputChannel.appendLine(
      `Mamori Inspector skipped missing workspace folder: ${workspaceFolder.uri.fsPath}`,
    );
  }

  return existingWorkspaceFolders;
}

/**
 * 単一ワークスペース対象の操作に使うフォルダーを返す。
 * @returns 選択されたワークスペースフォルダーを返す。
 */
async function resolveWorkspaceFolderForSingleTargetCommand(): Promise<vscode.WorkspaceFolder | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  if (workspaceFolders.length === 1) {
    return workspaceFolders[0];
  }

  const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
  if (activeDocumentUri) {
    const activeWorkspaceFolder = getWorkspaceFolderForUri(activeDocumentUri);
    if (activeWorkspaceFolder) {
      return activeWorkspaceFolder;
    }
  }

  const selectedItem = await vscode.window.showQuickPick(
    workspaceFolders.map((workspaceFolder) => ({
      label: workspaceFolder.name,
      description: workspaceFolder.uri.fsPath,
      workspaceFolder,
    })),
    {
      ignoreFocusOut: true,
      placeHolder: getWorkspaceSelectionPlaceholder(),
    },
  );

  return selectedItem?.workspaceFolder;
}

/**
 * hooks 管理コマンドを作成する。
 * @param action hooks 操作種別を表す。
 * @param outputChannel 出力チャネルを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns コマンド本体を返す。
 */
function createManageHooksCommand(
  action: MamoriHooksAction,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): () => Promise<void> {
  return async() => {
    const workspaceFolder = await resolveWorkspaceFolderForSingleTargetCommand();
    if (!workspaceFolder) {
      void vscode.window.showWarningMessage(getOpenWorkspaceMessage());
      return;
    }

    try {
      let commandResult: MamoriCliCommandResult | undefined;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: getHooksProgressTitle(action),
          cancellable: false,
        },
        async() => {
          commandResult = await runMamoriCliCommand(
            workspaceFolder,
            buildMamoriHooksArguments(action),
            extensionRootPath,
          );
        },
      );

      reportHooksCommandSuccess(
        action,
        commandResult ? commandResult.stdout : '',
        outputChannel,
        vscode.window,
        getHooksCommandMessages(),
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
        `Mamori Inspector hooks ${action} failed: ${details}`,
      );
      void vscode.window.showErrorMessage(getHooksFailureMessage(action, details));
    }
  };
}

/**
 * setup / cache-clear 管理コマンドを作成する。
 * @param action 保守コマンド種別を表す。
 * @param outputChannel 出力チャネルを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns コマンド本体を返す。
 */
function createManageMaintenanceCommand(
  action: MamoriMaintenanceAction,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): () => Promise<void> {
  return async() => {
    const workspaceFolder = await resolveWorkspaceFolderForSingleTargetCommand();
    if (!workspaceFolder) {
      void vscode.window.showWarningMessage(getOpenWorkspaceMessage());
      return;
    }

    const progressTitle = getMaintenanceProgressTitle(action);

    try {
      let commandResult: MamoriCliCommandResult | undefined;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: progressTitle,
          cancellable: false,
        },
        async() => {
          commandResult = await runMamoriCliCommand(
            workspaceFolder,
            buildMamoriMaintenanceArguments(action),
            extensionRootPath,
          );
        },
      );

      if (commandResult && commandResult.stdout.trim() !== '') {
        outputChannel.appendLine(commandResult.stdout.trim());
      }
      void vscode.window.showInformationMessage(getMaintenanceSuccessMessage(action));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
        `Mamori Inspector maintenance ${action} failed: ${details}`,
      );
      void vscode.window.showErrorMessage(getMaintenanceFailureMessage(action, details));
    }
  };
}

/**
 * SARIF の内容を URI ごとの Diagnostics へ変換する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param sarifPath SARIF パスを表す。
 * @returns URI ごとの Diagnostics 一覧を返す。
 */
function buildDiagnosticsByUri(
  workspaceFolder: vscode.WorkspaceFolder,
  sarifPath: string,
): Map<string, DiagnosticsByUriEntry> {
  const findings = loadSarifFindings(sarifPath);
  const diagnosticsByUri = new Map<string, DiagnosticsByUriEntry>();

  for (const finding of findings) {
    const documentUri = toDocumentUri(workspaceFolder, finding);
    const range = new vscode.Range(
      finding.startLine - 1,
      finding.startColumn - 1,
      finding.startLine - 1,
      finding.startColumn,
    );
    const diagnostic = new vscode.Diagnostic(
      range,
      finding.message,
      toDiagnosticSeverity(finding.level),
    );

    if (finding.ruleId) {
      diagnostic.code = finding.ruleId;
    }

    const existing = diagnosticsByUri.get(documentUri.toString()) || {
      uri: documentUri,
      diagnostics: [],
    };
    existing.diagnostics.push(diagnostic);
    diagnosticsByUri.set(documentUri.toString(), existing);
  }

  return diagnosticsByUri;
}

/**
 * URI ごとの Diagnostics を集約する。
 * @param target 集約先を表す。
 * @param source 集約元を表す。
 * @returns 返り値はない。
 */
function mergeDiagnosticsByUri(
  target: Map<string, DiagnosticsByUriEntry>,
  source: Map<string, DiagnosticsByUriEntry>,
): void {
  for (const [uriKey, entry] of source.entries()) {
    const existing = target.get(uriKey) || {
      uri: entry.uri,
      diagnostics: [],
    };
    existing.diagnostics.push(...entry.diagnostics);
    target.set(uriKey, existing);
  }
}

/**
 * 集約済み Diagnostics を DiagnosticsCollection へ反映する。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param diagnosticsByUri URI ごとの Diagnostics を表す。
 * @returns 反映件数を返す。
 */
function publishCollectedDiagnostics(
  diagnosticCollection: vscode.DiagnosticCollection,
  diagnosticsByUri: Map<string, DiagnosticsByUriEntry>,
): number {
  diagnosticCollection.clear();

  let totalDiagnostics = 0;
  for (const entry of diagnosticsByUri.values()) {
    diagnosticCollection.set(entry.uri, entry.diagnostics);
    totalDiagnostics += entry.diagnostics.length;
  }

  return totalDiagnostics;
}

/**
 * SARIF の内容を DiagnosticsCollection へ反映する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param diagnosticCollection 診断コレクションを表す。
 * @returns 反映件数を返す。
 */
function publishDiagnostics(
  workspaceFolder: vscode.WorkspaceFolder,
  diagnosticCollection: vscode.DiagnosticCollection,
  sarifPath: string,
): number {
  return publishCollectedDiagnostics(
    diagnosticCollection,
    buildDiagnosticsByUri(workspaceFolder, sarifPath),
  );
}

/**
 * 対象 URI に対応するワークスペースフォルダーを返す。
 * @param resourceUri 対象 URI を表す。
 * @returns ワークスペースフォルダーを返す。
 */
function getWorkspaceFolderForUri(resourceUri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(resourceUri);
}

/**
 * 保存時自動チェック対象か判定する。
 * @param document 対象ドキュメントを表す。
 * @returns 対象なら true を返す。
 */
function shouldRunAutomaticSaveCheck(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file'
    && AUTO_SAVE_LANGUAGE_IDS.has(document.languageId)
    && Boolean(vscode.workspace.getWorkspaceFolder(document.uri));
}

/**
 * 実行中保存の追随再実行を許可するか判定する。
 * @param filePath 対象ファイルパスを表す。
 * @returns 追随再実行する場合は true を返す。
 */
function shouldQueueSaveCheckWhileRunning(filePath: string): boolean {
  return !AUTO_SAVE_NON_QUEUE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * 単一ファイルの保存時チェックを実行する。
 * @param workspaceFolder ワークスペースフォルダーを表す。
 * @param filePath 対象ファイルパスを表す。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param outputChannel 出力チャネルを表す。
 * @returns 実行完了を待つ Promise を返す。
 */
async function runSaveCheck(
  workspaceFolder: vscode.WorkspaceFolder,
  filePath: string,
  diagnosticCollection: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): Promise<void> {
  const sarifPath = getSarifOutputPath(workspaceFolder, SAVE_SARIF_OUTPUT);

  try {
    await runMamoriCli(workspaceFolder, {
      mode: 'save',
      scope: 'file',
      files: [filePath],
      sarifOutputPath: sarifPath,
    }, extensionRootPath);
    const diagnosticsCount = publishDiagnostics(workspaceFolder, diagnosticCollection, sarifPath);
    void vscode.window.setStatusBarMessage(
      getSaveCheckStatusMessage(diagnosticsCount),
      3000,
    );
  } catch (error) {
    outputChannel.appendLine(
      `Mamori Inspector save check failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * ワークスペースチェックコマンドを作成する。
 * @param diagnosticCollection 診断コレクションを表す。
 * @param outputChannel 出力チャネルを表す。
 * @param extensionRootPath 拡張ルートパスを表す。
 * @returns コマンド本体を返す。
 */
function createRunWorkspaceCheckCommand(
  diagnosticCollection: vscode.DiagnosticCollection,
  outputChannel: vscode.OutputChannel,
  extensionRootPath: string,
): () => Promise<void> {
  return async() => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      void vscode.window.showWarningMessage(getOpenWorkspaceMessage());
      return;
    }

    const existingWorkspaceFolders = filterExistingWorkspaceFolders(workspaceFolders, outputChannel);
    if (existingWorkspaceFolders.length === 0) {
      diagnosticCollection.clear();
      void vscode.window.showWarningMessage(getNoAvailableWorkspaceMessage());
      return;
    }

    try {
      const sarifOutputs = existingWorkspaceFolders.map((workspaceFolder) => ({
        workspaceFolder,
        sarifPath: getSarifOutputPath(workspaceFolder, MANUAL_SARIF_OUTPUT),
      }));
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: getWorkspaceCheckProgressTitle(),
          cancellable: false,
        },
        async(progress) => {
          for (const [index, sarifOutput] of sarifOutputs.entries()) {
            progress.report({
              increment: 100 / sarifOutputs.length,
              message: `${sarifOutput.workspaceFolder.name} (${String(index + 1)}/${String(sarifOutputs.length)})`,
            });
            await runMamoriCli(sarifOutput.workspaceFolder, {
              mode: 'manual',
              scope: 'workspace',
              sarifOutputPath: sarifOutput.sarifPath,
            }, extensionRootPath);
          }
        },
      );

      const diagnosticsByUri = new Map<string, DiagnosticsByUriEntry>();
      for (const sarifOutput of sarifOutputs) {
        mergeDiagnosticsByUri(
          diagnosticsByUri,
          buildDiagnosticsByUri(sarifOutput.workspaceFolder, sarifOutput.sarifPath),
        );
      }

      const diagnosticsCount = publishCollectedDiagnostics(diagnosticCollection, diagnosticsByUri);
      void vscode.window.showInformationMessage(getWorkspaceCheckSuccessMessage(diagnosticsCount));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      diagnosticCollection.clear();
      outputChannel.appendLine(
        `Mamori Inspector workspace check failed: ${details}`,
      );
      void vscode.window.showErrorMessage(getWorkspaceCheckFailureMessage(details));
    }
  };
}

/**
 * 拡張の初期化処理を行う。
 * @param context 拡張コンテキストを表す。
 * @returns 返り値はない。
 */
export function activate(context: vscode.ExtensionContext): void {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION_NAME);
  const outputChannel = vscode.window.createOutputChannel('Mamori Inspector');
  const extensionRootPath = context.extensionUri.fsPath;
  const saveCheckScheduler = new SaveCheckScheduler({
    debounceMilliseconds: SAVE_DEBOUNCE_MILLISECONDS,
    suppressionMilliseconds: SAVE_SUPPRESSION_MILLISECONDS,
    shouldQueueDuringRun: shouldQueueSaveCheckWhileRunning,
    executeCheck: async(filePath: string) => {
      const workspaceFolder = getWorkspaceFolderForUri(vscode.Uri.file(filePath));
      if (!workspaceFolder) {
        return;
      }

      await runSaveCheck(workspaceFolder, filePath, diagnosticCollection, outputChannel, extensionRootPath);
    },
  });

  context.subscriptions.push(diagnosticCollection);
  context.subscriptions.push(outputChannel);
  context.subscriptions.push({
    dispose: () => saveCheckScheduler.dispose(),
  });
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.runWorkspaceCheck',
      createRunWorkspaceCheckCommand(diagnosticCollection, outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.installGitHooks',
      createManageHooksCommand('install', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.uninstallGitHooks',
      createManageHooksCommand('uninstall', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.setupTools',
      createManageMaintenanceCommand('setup', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mamori-inspector.clearToolCache',
      createManageMaintenanceCommand('cache-clear', outputChannel, extensionRootPath),
    ),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!shouldRunAutomaticSaveCheck(document)) {
        return;
      }
      saveCheckScheduler.schedule(document.uri.fsPath);
    }),
  );
}

/**
 * 拡張の終了処理を行う。
 * @returns 返り値はない。
 */
export function deactivate(): void {}
