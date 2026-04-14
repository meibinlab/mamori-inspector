'use strict';

// 子プロセス実行 API を表す
const { spawn } = require('child_process');
// ファイルシステム操作を表す
const fs = require('fs');
// パス操作を表す
const path = require('path');

/**
 * cmd.exe へ渡す Windows コマンド引数を常にダブルクォートで囲む。
 * @param {string} argument クォート対象引数を表す。
 * @returns {string} クォート済み引数文字列を返す。
 */
function quoteWindowsCommandArgument(argument) {
  return `"${String(argument).replace(/"/g, '""')}"`;
}

/**
 * スペース等の特殊文字を含む場合のみ Windows コマンド引数をクォートする。
 * @param {string} argument クォート対象引数を表す。
 * @returns {string} 必要に応じてクォートした引数文字列を返す。
 */
function quoteWindowsArgIfNeeded(argument) {
  const str = String(argument);
  if (!/[ \t\n\v"&|<>^%!]/.test(str)) {
    return str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Windows の PATHEXT を考慮してコマンドのフルパスを解決する。
 * @param {string} command コマンド名を表す。
 * @param {string} cwd 作業ディレクトリを表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {string} 解決できた実行ファイルパスを返す。解決できない場合は元のコマンドを返す。
 */
function resolveWindowsCommand(command, cwd, env) {
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return command;
  }

  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const searchDirectories = [
    cwd,
    ...String(env.PATH || '').split(path.delimiter).filter(Boolean),
  ];

  for (const dir of searchDirectories) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const lowerCandidate = path.join(dir, `${command}${ext.toLowerCase()}`);
      if (fs.existsSync(lowerCandidate)) {
        return lowerCandidate;
      }
    }
  }

  return command;
}

/**
 * Windows の .cmd/.bat ファイルを cmd.exe 経由で実行するための起動情報を返す。
 * それ以外のコマンドは shell を介さず直接起動する。
 * @param {string} command 実行コマンドを表す。
 * @param {string[]} args 引数一覧を表す。
 * @param {string} cwd 作業ディレクトリを表す。
 * @param {NodeJS.ProcessEnv} env 環境変数を表す。
 * @returns {{command: string, args: string[], shell: boolean, windowsVerbatimArguments?: boolean}} 起動情報を返す。
 */
function getCommandInvocation(command, args, cwd, env) {
  if (process.platform !== 'win32') {
    return { command, args, shell: false };
  }

  const resolvedCommand = resolveWindowsCommand(command, cwd, env);
  const extension = path.extname(resolvedCommand).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') {
    return { command: resolvedCommand, args, shell: false };
  }

  const commandLine = [
    quoteWindowsCommandArgument(resolvedCommand),
    ...args.map(quoteWindowsArgIfNeeded),
  ].join(' ');
  return {
    command: env.ComSpec || process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    shell: false,
    windowsVerbatimArguments: true,
  };
}

/**
 * 外部コマンドを実行する。
 * @param {string} command 実行するコマンド名を表す。
 * @param {string[]} args コマンド引数一覧を表す。
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number}=} options 実行オプションを表す。
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} 実行結果を返す。
 */
function execCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const cwd = options.cwd || process.cwd();
    const env = options.env || process.env;
    const invocation = getCommandInvocation(command, args, cwd, env);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      shell: invocation.shell,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
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
