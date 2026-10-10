import type { StoredDefinition } from "@/server/semantic/definitions";
import type { KeywordCatalog } from "@/lib/workspace";

export function keywordCatalog(definitions: StoredDefinition[], coverage: { start: string; end: string }, latestObservation: string): KeywordCatalog {
  const business = definitions.filter((d) => !/^(col_|table_)/.test(d.id));
  const entry = (d: StoredDefinition) => ({ id: d.id, definitionId: d.id, label: d.name, enabled: d.authority === "official" && d.status === "ready", reason: d.status === "needs_data" ? d.missing : d.authority !== "official" ? "공식 산식 검토가 필요한 후보 정의입니다." : d.description });
  const metrics = business.filter((d) => d.kind === "metric");
  const now = new Date().toISOString().slice(0, 10);
  const current = now <= coverage.end;
  return {
    connected: true, coverage, latestObservation, definitions: definitions.length,
    recommendations: metrics.filter((d) => d.authority === "official" && d.status === "ready").slice(0, 4).map((d) => `${coverage.start}부터 ${coverage.end}까지 가입 고객의 ${d.name}을 알려줘.`),
    groups: [
      { id: "target", label: "분석 대상", items: [{ id: "all", label: "전체 가입 고객", enabled: true, reason: "등록된 가입 고객 코호트 전체" }, ...business.filter((d) => d.kind === "term" && /고객/.test(d.name)).map(entry)] },
      { id: "metric", label: "분석 지표", items: metrics.map(entry) },
      { id: "period", label: "분석 기간", items: [{ id: "available", label: "전체 관측 기간", enabled: true, reason: `${coverage.start} ~ ${coverage.end}` }, { id: "custom", label: "사용자 지정", enabled: true, reason: "가입일 관측 범위 안에서 선택" }, ...["최근 7일", "최근 30일", "지난달", "최근 3개월"].map((label, i) => ({ id: `relative_${i}`, label, enabled: current, reason: current ? "현재 날짜 기준" : `현재 날짜 기준 기간은 데이터 범위 밖입니다. 가입일: ${coverage.start} ~ ${coverage.end}` }))] },
      { id: "method", label: "분석 방식", items: [{ id: "total", label: "전체 요약", enabled: true, reason: "선택한 지표의 전체 값" }, { id: "trend", label: "가입 월별 추이", enabled: true, reason: "가입 월 코호트 기준 비교" }, ...business.filter((d) => d.kind === "dimension").map((d) => ({ ...entry(d), label: `${d.name}별 비교` }))] },
    ],
  };
}
