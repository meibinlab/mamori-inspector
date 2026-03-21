'use strict';

/**
 * Semgrep の SARIF 出力から Issue 一覧を構築する。
 * @param {string} rawSarif Semgrep の SARIF 文字列を表す。
 * @returns {Array<{tool: string, ruleId?: string, message: string, severity: string, filePath?: string, line?: number, column?: number}>} Issue 一覧を返す。
 */
function parseSemgrepSarif(rawSarif) {
  if (typeof rawSarif !== 'string' || rawSarif.trim() === '') {
    return [];
  }

  const parsed = JSON.parse(rawSarif);
  const runs = Array.isArray(parsed.runs) ? parsed.runs : [];

  return runs.flatMap((run) => {
    const results = Array.isArray(run.results) ? run.results : [];
    return results.map((result) => {
      const firstLocation = Array.isArray(result.locations) ? result.locations[0] : undefined;
      const physicalLocation = firstLocation && firstLocation.physicalLocation
        ? firstLocation.physicalLocation
        : undefined;
      const region = physicalLocation && physicalLocation.region
        ? physicalLocation.region
        : undefined;

      return {
        tool: 'semgrep',
        ruleId: result.ruleId,
        message: result.message && typeof result.message.text === 'string'
          ? result.message.text
          : 'semgrep finding',
        severity: result.level === 'error'
          ? 'error'
          : result.level === 'warning'
            ? 'warning'
            : 'info',
        filePath: physicalLocation && physicalLocation.artifactLocation
          ? physicalLocation.artifactLocation.uri
          : undefined,
        line: region && typeof region.startLine === 'number' ? region.startLine : undefined,
        column: region && typeof region.startColumn === 'number' ? region.startColumn : undefined,
      };
    });
  });
}

module.exports = {
  parseSemgrepSarif,
};