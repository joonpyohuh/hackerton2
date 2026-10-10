import type { ContextRetriever } from "./types";
import { renderSchemaContext, type DbMetadata } from "@/server/db/metadata";

/**
 * 기본 맥락 검색기: DB 메타데이터(구조) + 데이터 특성 노트.
 * TODO(06단계): 승인된 지표 정의를 semanticContext로 주입
 * TODO(07단계): pgvector로 질문 유사 사례(GOLD_VERIFIED / HUMAN_APPROVED만) 검색 → examples
 */
export function createBasicRetriever(options: { getMetadata: () => Promise<DbMetadata>; notesVersion: string }): ContextRetriever {
  return {
    async retrieve() {
      const meta = await options.getMetadata();
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
