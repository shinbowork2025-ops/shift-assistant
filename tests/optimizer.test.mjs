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

test("optimizer smoke", () => {
  const result = optimizeBreaks({ employees: [] }, { seed: 1 });
  assert.equal(result.score, 0);
});

test("fixtures load", async () => {
  for (const name of fixtureNames) {
    const fixture = await loadFixture(name);
    const dayPlan = addGreedyInitialSolution({ employees: expandGroups(fixture.groups) });
    assert.ok(dayPlan.employees.length > 0);
  }
});
