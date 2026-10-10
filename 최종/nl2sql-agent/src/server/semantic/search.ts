import type { StoredDefinition } from "./definitions";

export type Match = { id: string; name: string; kind: StoredDefinition["kind"]; score: number; version: number };
const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(normalize(s).match(/[\p{L}\p{N}_]{2,}/gu) ?? []);

export function scoreText(question: string, text: string): number {
  const q = normalize(question);
  const t = normalize(text);
  if (!q || !t) return 0;
  if (q.includes(t)) return 100 + t.length;
  const qWords = words(q);
  return [...words(t)].reduce((n, word) => n + (qWords.has(word) || q.includes(word) ? Math.min(word.length, 10) : 0), 0);
}

export function matchDefinitions(question: string, definitions: StoredDefinition[], limit = 6): Match[] {
  return definitions
    .map((item) => {
      const labelScore = Math.max(...[item.name, ...item.aliases].map((label) => scoreText(question, label)));
      return { id: item.id, name: item.name, kind: item.kind, version: item.version, score: labelScore };
    })
    .filter((item) => item.score >= 8)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
