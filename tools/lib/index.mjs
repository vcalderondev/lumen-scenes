// index.json: what Lumen web reads to find scenes for a game (FORMAT.md "Index").
export function buildIndex(results) {
  const scenes = results.filter((r) => r.ok).map((r) => r.entry);
  return { format: 1, scenes };
}
