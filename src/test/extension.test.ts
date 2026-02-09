// 断言ユーティリティを表す
import * as assert from 'assert';

// VS Code API を表す
import * as vscode from 'vscode';

/**
 * 拡張のテストスイートを定義する。
 * @returns 返り値はない。
 */
suite('Extension Test Suite', () => {
  // テスト開始の通知メッセージを表す
  const message = 'Start all tests.';
  vscode.window.showInformationMessage(message);

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
});
