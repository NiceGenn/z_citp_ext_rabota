import { state } from './state.js';

const norm = s => s.replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

const levenshtein = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

// Возвращает ВСЕ записи из базы, подходящие по ФИО (массив объектов {fio,login,role,system,normFio})
export function findAllUsers(name) {
  const n = norm(name);

  // 1. Точное совпадение — возвращаем сразу все точные совпадения
  const exactMatches = state.dbNormalized.filter(e => e.normFio === n);
  if (exactMatches.length) return exactMatches;

  const tName = n.split(' ').filter(Boolean);
  if (!tName.length) return [];

  // 2. Расстояние Левенштейна — находим лучший балл, берём все записи с ним
  let bestScore = Infinity;
  const scored = [];

  for (const entry of state.dbNormalized) {
    const tKey = entry.normFio.split(' ').filter(Boolean);
    if (!tKey.length) continue;

    const lastDist = levenshtein(tName[0], tKey[0]);
    const maxLastDist = tName[0].length > 6 ? 2 : (tName[0].length > 4 ? 1 : 0);
    if (lastDist > maxLastDist) continue;

    let score = lastDist * 10;

    if (tName.length > 1 && tKey.length > 1) {
      if (tName[1] === tKey[1])          score += 0;
      else if (tName[1][0] === tKey[1][0]) score += 2;
      else                                score += 100;
    }

    if (tName.length > 2 && tKey.length > 2) {
      if (tName[2] === tKey[2])          score += 0;
      else if (tName[2][0] === tKey[2][0]) score += 2;
      else                                score += 100;
    }

    if (score < 50) {
      if (score < bestScore) bestScore = score;
      scored.push({ entry, score });
    }
  }

  return scored.filter(s => s.score === bestScore).map(s => s.entry);
}
