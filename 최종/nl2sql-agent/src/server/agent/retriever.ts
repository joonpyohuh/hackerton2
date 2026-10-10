import type { ContextRetriever } from "./types";
import { renderSchemaContext, type DbMetadata } from "@/server/db/metadata";
import { matchDefinitions, scoreText } from "@/server/semantic/search";
import { renderDefinition } from "@/server/semantic/definitions";
import type { SemanticStore } from "@/server/semantic/store";

/** DB 구조, 질문과 관련된 업무 정의, 담당자 승인 SQL을 함께 검색한다. */
export function createBasicRetriever(options: { getMetadata: () => Promise<DbMetadata>; notesVersion: string; store?: SemanticStore }): ContextRetriever {
  return {
    async retrieve(question) {
      const meta = await options.getMetadata();
      if (options.store) {
        const [definitions, revision] = await Promise.all([options.store.list(), options.store.revision()]);
        const matches = matchDefinitions(question, definitions);
        const selected = matches.map((m) => definitions.find((d) => d.id === m.id)!);
        const tableNames = new Set(selected.flatMap((d) => d.tables));
        for (const table of meta.tables) {
          if (question.toLowerCase().includes(table.name)) tableNames.add(`${table.schema}.${table.name}`);
        }
        const tables = tableNames.size ? meta.tables.filter((t) => tableNames.has(`${t.schema}.${t.name}`)) : meta.tables;
        const selectedIds = new Set(matches.map((m) => m.id));
        const examples = (await options.store.approvedExamples(revision))
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
          sources: tables.map((t) => `${t.schema}.${t.name}`),
          matches,
          exampleMatches: examples.map(({ requestId, question: q, score }) => ({ requestId, question: q, score })),
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
