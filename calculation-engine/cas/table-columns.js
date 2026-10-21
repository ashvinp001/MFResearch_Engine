/**
 * Column-band helpers for reading true tables from positional rows.
 *
 * Input:  header rows (cells with x/right) and a list of column classifiers.
 * Output: ordered columns { key, label, left, right, center } whose bands
 *         are split at midpoints between neighbouring column centres.
 *  - buildColumns(headerRows, classifiers) → columns
 *  - assignCellsToColumns(cells, columns) → { [key]: "joined cell text" }
 * Header text often wraps over 2–3 lines; fragments that overlap horizontally
 * are merged into one column label before classification.
 */

const OVERLAP_PADDING = 2;

export function buildColumns(headerRows, classifiers) {
  const fragments = headerRows
    .flatMap((row) => row.cells.map((cell) => ({ ...cell, y: row.y })))
    .sort((p, q) => p.x - q.x);
  const groups = [];

  for (const cell of fragments) {
    const group = groups.find(
      (g) => cell.x <= g.right + OVERLAP_PADDING && cell.right >= g.left - OVERLAP_PADDING
    );
    if (group) {
      group.left = Math.min(group.left, cell.x);
      group.right = Math.max(group.right, cell.right);
      group.parts.push(cell);
    } else {
      groups.push({ left: cell.x, right: cell.right, parts: [cell] });
    }
  }

  const used = new Set();
  return groups
    .sort((p, q) => p.left - q.left)
    .map((group) => {
      // Read wrapped header text top-to-bottom, then left-to-right.
      const label = [...group.parts]
        .sort((p, q) => q.y - p.y || p.x - q.x)
        .map((part) => part.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const match = classifiers.find((c) => !used.has(c.key) && c.test(label));
      if (match) used.add(match.key);
      return { key: match?.key ?? null, label, left: group.left, right: group.right, center: (group.left + group.right) / 2 };
    });
}

/** Assign each cell to the column band containing its centre. */
export function assignCellsToColumns(cells, columns) {
  const result = {};
  for (const cell of cells) {
    const column = columnForX((cell.x + cell.right) / 2, columns);
    if (!column?.key) continue;
    result[column.key] = result[column.key] ? `${result[column.key]} ${cell.str}` : cell.str;
  }
  return result;
}

export function columnForX(x, columns) {
  for (let i = 0; i < columns.length; i++) {
    const next = columns[i + 1];
    const boundary = next ? (columns[i].center + next.center) / 2 : Infinity;
    if (x < boundary) return columns[i];
  }
  return null;
}

/** True when every key in `keys` was classified in `columns`. */
export function hasColumns(columns, keys) {
  return keys.every((key) => columns.some((column) => column.key === key));
}
