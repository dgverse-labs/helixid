#!/usr/bin/env node
/* eslint-disable no-console, @typescript-eslint/explicit-function-return-type */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [
  coveragePath,
  globalLines,
  globalStatements,
  globalBranches,
  globalFunctions,
  fileLines,
  fileStatements,
  fileBranches,
  fileFunctions,
] = process.argv.slice(2);

if (!coveragePath) {
  throw new Error('Usage: check-coverage-thresholds.mjs <coverage-final.json> <global lines> <global statements> <global branches> <global functions> <file lines> <file statements> <file branches> <file functions>');
}

const globalThresholds = {
  lines: Number(globalLines),
  statements: Number(globalStatements),
  branches: Number(globalBranches),
  functions: Number(globalFunctions),
};
const fileThresholds = {
  lines: Number(fileLines),
  statements: Number(fileStatements),
  branches: Number(fileBranches),
  functions: Number(fileFunctions),
};

const coverage = JSON.parse(readFileSync(resolve(coveragePath), 'utf8'));
const totals = {
  lines: { covered: 0, total: 0 },
  statements: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
};
const failures = [];

function pct(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

function check(name, actual, threshold) {
  if (actual + Number.EPSILON < threshold) {
    failures.push(`${name}: ${actual.toFixed(2)}% < ${threshold}%`);
  }
}

for (const [file, data] of Object.entries(coverage)) {
  const statementTotal = Object.keys(data.statementMap ?? {}).length;
  const statementCovered = Object.values(data.s ?? {}).filter((count) => count > 0).length;
  const functionTotal = Object.keys(data.fnMap ?? {}).length;
  const functionCovered = Object.values(data.f ?? {}).filter((count) => count > 0).length;
  const branchTotal = Object.values(data.b ?? {}).reduce((sum, counts) => sum + counts.length, 0);
  const branchCovered = Object.values(data.b ?? {}).reduce(
    (sum, counts) => sum + counts.filter((count) => count > 0).length,
    0,
  );

  // V8 remaps TS line coverage onto statement coverage in this repo.
  const lineTotal = statementTotal;
  const lineCovered = statementCovered;

  totals.statements.covered += statementCovered;
  totals.statements.total += statementTotal;
  totals.functions.covered += functionCovered;
  totals.functions.total += functionTotal;
  totals.branches.covered += branchCovered;
  totals.branches.total += branchTotal;
  totals.lines.covered += lineCovered;
  totals.lines.total += lineTotal;

  const label = file.replace(`${process.cwd()}/`, '');
  check(`${label} lines`, pct(lineCovered, lineTotal), fileThresholds.lines);
  check(`${label} statements`, pct(statementCovered, statementTotal), fileThresholds.statements);
  check(`${label} branches`, pct(branchCovered, branchTotal), fileThresholds.branches);
  check(`${label} functions`, pct(functionCovered, functionTotal), fileThresholds.functions);
}

for (const metric of Object.keys(totals)) {
  check(`global ${metric}`, pct(totals[metric].covered, totals[metric].total), globalThresholds[metric]);
}

if (failures.length > 0) {
  console.error('Coverage thresholds failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Coverage thresholds passed.');
