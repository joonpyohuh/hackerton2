export type StageErrorKind = "timeout" | "aborted" | "invalid_response" | "upstream" | "execution" | "config";

/**
 * 파이프라인 단계에서 발생한 오류. retryable=true면 다음 시도로 넘어가고,
 * false면 루프를 즉시 종료한다 (예: API 키 오류, 설정 누락, 사용자 취소).
 */
export class StageError extends Error {
  constructor(
    public readonly kind: StageErrorKind,
    message: string,
    public readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StageError";
  }
}

/** 알 수 없는 오류는 보수적으로 재시도 불가로 취급한다. */
export const toStageError = (e: unknown, fallback: string): StageError =>
  e instanceof StageError ? e : new StageError("upstream", fallback, false, { cause: e });

/** 부모 취소 신호 + 단계별 타임아웃. 구현체가 signal을 무시해도 여기서 끊는다. */
export function runStage<T>(fn: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  if (parent.aborted) return Promise.reject(new StageError("aborted", "요청이 취소되었습니다.", false));
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        parent.aborted
          ? new StageError("aborted", "요청이 취소되었습니다.", false)
          : new StageError("timeout", `응답 시간(${timeoutMs}ms)을 초과했습니다.`, true),
      );
    signal.addEventListener("abort", onAbort, { once: true });
    fn(signal)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}
