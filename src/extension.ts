// VS Code 拡張APIを表す
import * as vscode from 'vscode';
// 子プロセス実行 API を表す
import { spawn } from 'child_process';
// Node のファイルシステム API を表す
import * as fs from 'fs';
// Node のパス操作 API を表す
import * as path from 'path';
// hooks 成功通知の整形処理を表す
import { reportHooksCommandSuccess, type MamoriHooksAction } from './hooks-command-report';
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
      reject(new Error(stderr || `Mamori CLI exited with code ${String(code)}`));
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
      placeHolder: 'Mamori Inspector の対象ワークスペースを選択してください。',
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
      void vscode.window.showWarningMessage('Mamori Inspector: ワークスペースを開いてください。');
      return;
    }

    try {
      let commandResult: MamoriCliCommandResult | undefined;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: action === 'install'
            ? 'Mamori Inspector の Git hooks をインストール中'
            : 'Mamori Inspector の Git hooks をアンインストール中',
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

      reportHooksCommandSuccess(action, commandResult ? commandResult.stdout : '', outputChannel, vscode.window);
    } catch (error) {
      outputChannel.appendLine(
        `Mamori Inspector hooks ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      void vscode.window.showErrorMessage(
        `Mamori Inspector: Git hooks の${action === 'install' ? 'インストール' : 'アンインストール'}に失敗しました。${error instanceof Error ? error.message : String(error)}`,
      );
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
      `Mamori Inspector: ${diagnosticsCount} 件の保存時チェック結果を反映しました。`,
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
      void vscode.window.showWarningMessage('Mamori Inspector: ワークスペースを開いてください。');
      return;
    }

    const existingWorkspaceFolders = filterExistingWorkspaceFolders(workspaceFolders, outputChannel);
    if (existingWorkspaceFolders.length === 0) {
      diagnosticCollection.clear();
      void vscode.window.showWarningMessage('Mamori Inspector: 利用可能なワークスペースがありません。');
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
          title: 'Mamori Inspector を実行中',
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
      void vscode.window.showInformationMessage(
        `Mamori Inspector: ${diagnosticsCount} 件の問題を反映しました。`,
      );
    } catch (error) {
      diagnosticCollection.clear();
      outputChannel.appendLine(
        `Mamori Inspector workspace check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      void vscode.window.showErrorMessage(
        `Mamori Inspector: 実行に失敗しました。${error instanceof Error ? error.message : String(error)}`,
      );
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
