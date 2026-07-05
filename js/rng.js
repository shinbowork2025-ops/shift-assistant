// mulberry32: deterministic non-cryptographic PRNG.
// Source: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
export function createMulberry32(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithRng(values, random) {
  const array = [...values];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}
