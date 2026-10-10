/** 정의의 근거 표시. 공식 자료 근거가 아니면 후보로 둔다. */
export type Authority = { authority: "official" | "candidate"; source: string };

export const PDF = "2026 해커톤 문제1 PDF";
export const official = (source: string): Authority => ({ authority: "official", source: `${PDF} ${source}` });
export const candidate = (source: string): Authority => ({ authority: "candidate", source });
