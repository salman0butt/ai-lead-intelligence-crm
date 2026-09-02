export function editSimilarity(left: string, right: string): number {
  if (left === right) return 1;

  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  if (leftChars.length === 0 || rightChars.length === 0) return 0;

  const [columns, rows] = leftChars.length <= rightChars.length
    ? [leftChars, rightChars]
    : [rightChars, leftChars];

  let previous = Array.from({ length: columns.length + 1 }, (_, index) => index);

  for (let row = 1; row <= rows.length; row += 1) {
    const current = new Array<number>(columns.length + 1);
    current[0] = row;

    for (let column = 1; column <= columns.length; column += 1) {
      const substitutionCost = rows[row - 1] === columns[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + substitutionCost,
      );
    }

    previous = current;
  }

  const distance = previous[columns.length]!;
  return 1 - distance / Math.max(leftChars.length, rightChars.length);
}

export function tokenJaccard(left: string, right: string): number {
  const leftTokens = toTokenSet(left);
  const rightTokens = toTokenSet(right);

  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return unionSize === 0 ? 1 : intersection / unionSize;
}

function toTokenSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}
