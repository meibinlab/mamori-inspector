// VS Code 拡張APIを表す
import * as vscode from 'vscode';

/**
 * 拡張の初期化処理を行う。
 * @param context 拡張コンテキストを表す。
 * @returns 返り値はない。
 */
export function activate(context: vscode.ExtensionContext): void {
  // 拡張の起動ログを表す
  console.log('Congratulations, your extension "mamori-inspector" is now active!');

  // コマンド登録を表す
  const disposable = vscode.commands.registerCommand('mamori-inspector.helloWorld', () => {
    // 通知メッセージを表す
    const message = 'Hello World from Mamori Inspector!';
    vscode.window.showInformationMessage(message);
  });

  context.subscriptions.push(disposable);
}

/**
 * 拡張の終了処理を行う。
 * @returns 返り値はない。
 */
export function deactivate(): void {}
