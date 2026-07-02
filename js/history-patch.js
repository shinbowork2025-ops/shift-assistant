function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]));
  }
  return false;
}

function snapshotValue(object, key) {
  const exists = Object.hasOwn(object, key);
  return { exists, value: exists ? object[key] : undefined };
}

function appendDifference(patch, path, before, after) {
  if (before.exists !== after.exists) {
    patch.push({
      path,
      before: { exists: before.exists, value: cloneValue(before.value) },
      after: { exists: after.exists, value: cloneValue(after.value) }
    });
    return;
  }
  if (!before.exists || valuesEqual(before.value, after.value)) return;

  if (isPlainObject(before.value) && isPlainObject(after.value)) {
    const keys = new Set([...Object.keys(before.value), ...Object.keys(after.value)]);
    for (const key of keys) {
      appendDifference(
        patch,
        [...path, key],
        snapshotValue(before.value, key),
        snapshotValue(after.value, key)
      );
    }
    return;
  }

  patch.push({
    path,
    before: { exists: true, value: cloneValue(before.value) },
    after: { exists: true, value: cloneValue(after.value) }
  });
}

export function createHistoryPatch(beforeDocument, afterDocument) {
  if (!isPlainObject(beforeDocument) || !isPlainObject(afterDocument)) {
    throw new TypeError("履歴差分の対象はオブジェクトである必要があります。");
  }
  const patch = [];
  const keys = new Set([...Object.keys(beforeDocument), ...Object.keys(afterDocument)]);
  for (const key of keys) {
    appendDifference(
      patch,
      [key],
      snapshotValue(beforeDocument, key),
      snapshotValue(afterDocument, key)
    );
  }
  return patch;
}

function applyValue(document, path, snapshot) {
  if (!path.length) throw new Error("空の履歴パスは適用できません。");
  let target = document;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(target[key])) target[key] = {};
    target = target[key];
  }
  const key = path.at(-1);
  if (snapshot.exists) target[key] = cloneValue(snapshot.value);
  else delete target[key];
}

export function applyHistoryPatch(document, patch, direction) {
  if (!isPlainObject(document)) throw new TypeError("履歴差分の適用先はオブジェクトである必要があります。");
  if (!Array.isArray(patch)) throw new TypeError("履歴差分は配列である必要があります。");
  if (direction !== "before" && direction !== "after") throw new Error("履歴差分の適用方向が不正です。");

  for (const operation of patch) {
    applyValue(document, operation.path, operation[direction]);
  }
  return document;
}
