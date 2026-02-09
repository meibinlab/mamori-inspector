#!/usr/bin/env node

'use strict';

// プロセスの終了関数を表す
const { exit } = require('process');

// コマンドライン引数を取得する
const args = process.argv.slice(2);
// 実行されたサブコマンドを取得する
const command = args[0] || 'help';

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
      '  mamori.js help',
      '',
      'Notes:',
      '  This is a minimal bootstrap. Implementations will be added incrementally.',
      '',
    ].join('\n'),
  );
}

/**
 * 最小CLIの実行結果を返す。
 * @returns {number} 終了コードを返す。
 */
function runMinimal() {
  // 最小CLIの動作を確認するための仮実装
  // --mode の位置を表す
  const modeIndex = args.indexOf('--mode');
  // --scope の位置を表す
  const scopeIndex = args.indexOf('--scope');
  // 実行モードを表す
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'unknown';
  // 実行スコープを表す
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : 'unknown';

  process.stdout.write(`mamori: run (mode=${mode}, scope=${scope})\n`);
  // 実装が未完了であることを示す
  process.stdout.write('mamori: minimal runner is not implemented yet.\n');
  return 0;
}

switch (command) {
  case 'run':
    exit(runMinimal());
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    printHelp();
    exit(0);
}
