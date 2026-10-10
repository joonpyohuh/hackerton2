export const encodeNdjson = (value: unknown): string => JSON.stringify(value) + "\n";

/** 청크 경계에 상관없이 완성된 줄만 파싱한다. 검증 실패는 parse가 예외로 던진다. */
export function createNdjsonParser<T>(parse: (value: unknown) => T) {
  let buffer = "";
  const parseLine = (line: string) => parse(JSON.parse(line));
  return {
    push(chunk: string): T[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.filter((l) => l.trim().length > 0).map(parseLine);
    },
    flush(): T[] {
      const rest = buffer.trim();
      buffer = "";
      return rest ? [parseLine(rest)] : [];
    },
  };
}
