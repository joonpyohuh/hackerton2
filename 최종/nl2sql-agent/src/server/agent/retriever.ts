import type { ContextRetriever, RetrievedContext } from "./types";
import { renderSchemaContext, schemaFingerprint, type DbMetadata } from "@/server/db/metadata";
import { matchConcept, matchDefinitions, scoreText } from "@/server/semantic/search";
import { renderDefinition, type StoredDefinition } from "@/server/semantic/definitions";
import type { SemanticStore } from "@/server/semantic/store";

/** 표현 일치(lexical)로 추가하는 보조 정의의 최소 점수. 라벨 전체가 질문에 들어 있을 때(100+)만 인정한다. */
const LEXICAL_SUPPORT_MIN = 100;

/**
 * DB 구조, 질문 의미에 맞는 업무 정의, 담당자 승인 SQL을 함께 검색한다.
 * 1순위: Semantic Resolver가 의미로 고른 정의(focusIds). 2순위: 라벨이 질문에 그대로 들어 있는 차원·용어.
 * 다른 지표(metric)는 표현만 겹친다는 이유로 넣지 않는다 — 생성 모델이 엉뚱한 산식을 고르지 않게 한다.
 * 점수는 검색 관련도 휴리스틱이며 정답률과 무관하다.
 */
export function createBasicRetriever(options: { getMetadata: () => Promise<DbMetadata>; notesVersion: string; store?: SemanticStore }): ContextRetriever {
  return {
    async retrieve(question, _signal, focusIds = [], concepts = []) {
      const meta = await options.getMetadata();
      if (options.store) {
        const [definitions, revision] = await Promise.all([options.store.list(), options.store.revision()]);
        const byId = new Map(definitions.map((d) => [d.id, d]));
        const lexical = matchDefinitions(question, definitions.filter(isSearchable(question)), 12);

        const focus = [...new Set([...focusIds, ...concepts.flatMap((c) => c.ids)])].filter((id) => byId.has(id));
        // 개념별 동의어 검색 — 화면·로그에서 개념마다 무엇이 검색됐는지 확인하게 한다.
        // 생성 컨텍스트에는 Resolver가 확정한 정의만 넣는다(동의어 후보가 다른 산식을 끌어오지 않게).
        const conceptHits = concepts.map((c) => ({
          phrase: c.phrase, role: c.role, ids: c.ids.filter((id) => byId.has(id)),
          synonyms: matchConcept(c.phrase, definitions).map((m) => m.id).filter((id) => !c.ids.includes(id)),
        }));
        const matches: NonNullable<RetrievedContext["matches"]> = focus.map((id) => {
          const d = byId.get(id)!;
          const hit = lexical.find((m) => m.id === id);
          return { id, name: d.name, kind: d.kind, version: d.version, score: hit?.score ?? 0, via: "resolver" as const };
        });
        const extra = focus.length
          ? lexical.filter((m) => !focus.includes(m.id) && m.kind !== "metric" && m.score >= LEXICAL_SUPPORT_MIN)
          : lexical;
        for (const m of extra.slice(0, Math.max(0, 6 - matches.length))) matches.push({ ...m, via: "lexical" });

        const selected = matches.map((m) => byId.get(m.id)!);
        const tableNames = new Set(selected.flatMap((d) => d.tables));
        for (const table of meta.tables) {
          if (question.toLowerCase().includes(table.name)) tableNames.add(`${table.schema}.${table.name}`);
        }
        const tables = tableNames.size ? meta.tables.filter((t) => tableNames.has(`${t.schema}.${t.name}`)) : meta.tables;
        const selectedIds = new Set(matches.map((m) => m.id));
        const examples = (await options.store.approvedExamples(revision, schemaFingerprint(meta.tables)))
          .map((example) => ({
            ...example,
            score: scoreText(question, example.question) +
              example.definitionIds.filter((id) => selectedIds.has(id)).length * 100,
          }))
          .filter((example) => example.score >= 8)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        const unavailable = selected.filter((d) => d.status === "needs_data");
        return {
          schemaContext: renderSchemaContext(tables),
          semanticContext: selected.map(renderDefinition).join("\n\n"),
          examples: examples.map((e) => `질문: ${e.question}\n승인 SQL: ${e.sql}`).join("\n\n"),
          isAmbiguous: unavailable.length > 0,
          clarificationQuestion: unavailable.length ? unavailable.map((d) => `${d.name}: ${d.missing}`).join(" ") : null,
          missingDefinitions: unavailable.map((d) => d.name),
          definitionVersion: `semantic.v${revision}`,
          schemaVersion: schemaFingerprint(meta.tables),
          sources: tables.map((t) => `${t.schema}.${t.name}`),
          matches,
          exampleMatches: examples.map(({ requestId, question: q, score }) => ({ requestId, question: q, score })),
          definitions: selected,
          concepts: conceptHits,
        };
      }
      return {
        schemaContext: renderSchemaContext(meta.tables),
        semanticContext: "",
        examples: "",
        isAmbiguous: false,
        clarificationQuestion: null,
        missingDefinitions: [],
        definitionVersion: options.notesVersion,
        sources: meta.tables.map((t) => `${t.schema}.${t.name}`),
      };
    },
  };
}

/** 컬럼 사전(col_*)은 질문에 실제 컬럼명이 적혀 있을 때만 검색한다. 일반 단어("요금제", "고객")로 끌려오지 않게 한다. */
function isSearchable(question: string) {
  const q = question.toLowerCase();
  return (d: StoredDefinition) => !d.id.startsWith("col_") || d.aliases.some((a) => q.includes(a.toLowerCase()));
}
