'use strict';

/**
 * SpotBugs XML から Issue 一覧を構築する。
 * @param {string} rawXml SpotBugs XML を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseSpotbugsXml(rawXml) {
  if (typeof rawXml !== 'string' || !rawXml.includes('<BugCollection')) {
    return [];
  }

  const issues = [];
  const bugPattern = /<BugInstance\s+type="([^"]+)"\s+priority="([^"]+)"[^>]*>([\s\S]*?)<LongMessage>([\s\S]*?)<\/LongMessage>[\s\S]*?<SourceLine\s+classname="[^"]+"\s+sourcepath="([^"]+)"\s+start="(\d+)"[^>]*\/>[\s\S]*?<\/BugInstance>/gu;

  for (const bugMatch of rawXml.matchAll(bugPattern)) {
    const priority = Number(bugMatch[2]);
    issues.push({
      tool: 'spotbugs',
      ruleId: bugMatch[1],
      message: (bugMatch[4] || 'spotbugs finding').trim(),
      severity: priority <= 2 ? 'error' : 'warning',
      filePath: bugMatch[5],
      line: Number(bugMatch[6]),
      column: 1,
    });
  }

  return issues;
}

module.exports = {
  parseSpotbugsXml,
};