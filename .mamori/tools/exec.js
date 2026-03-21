'use strict';

// 子プロセス実行 API を表す
const { spawn } = require('child_process');

/**
 * 外部コマンドを実行する。
 * @param {string} command 実行するコマンド名を表す。
 * @param {string[]} args コマンド引数一覧を表す。
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number}=} options 実行オプションを表す。
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} 実行結果を返す。
 */
function execCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timeoutId;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (finished) {
          return;
        }
        finished = true;
        child.kill();
        reject(new Error(`Command timeout after ${options.timeoutMs}ms: ${command}`));
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

module.exports = {
  execCommand,
};