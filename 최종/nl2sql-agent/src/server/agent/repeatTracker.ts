/**
 * 동일 오류 반복 감지. 숫자(점수·행 번호 등)와 공백 차이는 같은 오류로 본다.
 * 연속으로 limit회 같은 오류 묶음이 나오면 true.
 */
export function createRepeatTracker(limit: number) {
  let last = "";
  let count = 0;
  const normalize = (e: string) => e.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  return {
    record(errors: string[]): boolean {
      const signature = errors.map(normalize).filter(Boolean).sort().join(" | ");
      if (!signature) {
        last = "";
        count = 0;
        return false;
      }
      count = signature === last ? count + 1 : 1;
      last = signature;
      return count >= limit;
    },
  };
}
