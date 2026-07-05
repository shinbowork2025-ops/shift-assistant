import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { addGreedyInitialSolution } from "../js/optimizer-data.js";
import { optimizeBreaks } from "../js/optimizer.js";

const fixtureNames = [
  "rest-01-six-long.json",
  "rest-02-seven-hour-mix.json",
  "rest-03-mixed-15.json",
  "rest-04-required-coverage.json",
  "rest05-data.json"
];

async function loadFixture(name) {
  const url = new URL(`../js/fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(fileURLToPath(url), "utf8"));
}

function expandGroups(groups = []) {
  const employees = [];
  let index = 0;
  for (const group of groups) {
    for (let count = 0; count < group.count; count += 1) {
      employees.push({
        id: `e${index + 1}`,
        name: `employee-${index + 1}`,
        order: index + 1,
        shiftStart: group.shiftStart,
        shiftEnd: group.shiftEnd,
        breaks: []
      });
      index += 1;
    }
  }
  return employees;
}

function coverageFromRanges(ranges = []) {
  const result = Array(96).fill(0);
  for (const range of ranges) {
    for (let minute = range.start; minute < range.end; minute += 15) result[Math.floor(minute / 15)] = range.count;
  }
  return result;
}

test("optimizer smoke", () => {
  const result = optimizeBreaks({ employees: [] }, { seed: 1 });
  assert.equal(result.score, 0);
});

for (const fixtureName of fixtureNames) {
  test(`optimizer fixture: ${fixtureName}`, async () => {
    const fixture = await loadFixture(fixtureName);
    const dayPlan = addGreedyInitialSolution({ employees: expandGroups(fixture.groups) });
    const config = {
      seed: fixture.seed,
      restarts: 3,
      requiredCoverage: coverageFromRanges(fixture.requiredCoverageRanges)
    };
    const first = optimizeBreaks(dayPlan, config);
    const second = optimizeBreaks(dayPlan, config);
    assert.ok(first.score <= first.initialScore, `${first.score} > ${first.initialScore}`);
    assert.equal(first.hardCheck.ok, true, first.hardCheck.issues.join("\n"));
    assert.deepEqual(first.breaks, second.breaks);
  });
}
