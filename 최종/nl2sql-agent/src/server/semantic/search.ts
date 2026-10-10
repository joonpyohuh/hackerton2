import type { StoredDefinition } from "./definitions";

export type Match = { id: string; name: string; kind: StoredDefinition["kind"]; score: number; version: number };
const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\bd\+\d+\b/g, "d+n").replace(/\d+일/g, "n일").replace(/\s+/g, " ").trim();
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

/**
 * 개념 하나(예: "유지율", "광고형 요금제")에 대한 동의어 검색.
 * 이름·별칭이 개념과 같거나 서로 포함하면 일치로 본다. 질문 전체가 아니라 개념 단위로 찾기 때문에
 * "요금제" 같은 일반 단어 하나가 질문 전체의 맥락을 대신하지 않는다. 컬럼 사전(col_*)은 제외한다.
 */
export function matchConcept(phrase: string, definitions: StoredDefinition[], limit = 3): Match[] {
  const p = normalize(phrase);
  if (p.length < 2) return [];
  const scoreLabel = (label: string) => {
    const l = normalize(label);
    if (!l) return 0;
    if (l === p) return 200;
    if (l.length >= 2 && p.includes(l)) return 100 + l.length;
    if (l.includes(p)) return 90 + p.length;
    return scoreText(phrase, label);
  };
  return definitions
    .filter((d) => !d.id.startsWith("col_"))
    .map((d) => ({ id: d.id, name: d.name, kind: d.kind, version: d.version, score: Math.max(...[d.name, ...d.aliases].map(scoreLabel)) }))
    .filter((m) => m.score >= 8)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
