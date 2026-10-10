import OpenAI from "openai";
import { StageError } from "@/server/agent/errors";

export type ChatRequest = { model: string; system: string; user: string; json: boolean };
export type ChatResult = { content: string; inputTokens: number; outputTokens: number };
/** 테스트에서 교체할 수 있도록 함수 하나로 추상화한다. */
export type ChatClient = (request: ChatRequest, signal: AbortSignal) => Promise<ChatResult>;

export function createOpenAIChat(apiKey: string): ChatClient {
  // SDK 자체 재시도는 끈다 — 재시도·타임아웃은 파이프라인이 관리하고 로그에 남긴다.
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return async (req, signal) => {
    try {
      const res = await client.chat.completions.create(
        {
          model: req.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
        },
        { signal },
      );
      const content = res.choices[0]?.message?.content;
      if (!content) throw new StageError("invalid_response", "모델 응답이 비어 있습니다.", true);
      return { content, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
    } catch (e) {
      throw toLlmStageError(e);
    }
  };
}

/** OpenAI 오류 → 재시도 가능 여부가 구분된 StageError. 순서 주의: 하위 클래스부터 검사한다. */
export function toLlmStageError(e: unknown): StageError {
  if (e instanceof StageError) return e;
  if (e instanceof OpenAI.APIUserAbortError) return new StageError("aborted", "요청이 취소되었습니다.", false, { cause: e });
  if (e instanceof OpenAI.APIConnectionTimeoutError)
    return new StageError("timeout", "모델 응답 시간이 초과되었습니다.", true, { cause: e });
  if (e instanceof OpenAI.APIConnectionError)
    return new StageError("upstream", "모델 서버에 연결할 수 없습니다.", true, { cause: e });
  if (e instanceof OpenAI.APIError) {
    const status = e.status;
    if (status === 401 || status === 403)
      return new StageError("config", `모델 API 인증에 실패했습니다. API 키와 권한을 확인하세요. (HTTP ${status})`, false, { cause: e });
    if (status === 400 || status === 404)
      return new StageError("config", `모델 요청이 거부되었습니다. 모델 이름과 파라미터를 확인하세요. (HTTP ${status})`, false, { cause: e });
    if (status === 429) return new StageError("upstream", "모델 API 요청 한도를 초과했습니다. (HTTP 429)", true, { cause: e });
    if (status !== undefined && status >= 500)
      return new StageError("upstream", `모델 서버 일시 오류입니다. (HTTP ${status})`, true, { cause: e });
    return new StageError("upstream", `모델 API 오류입니다. (HTTP ${status ?? "?"})`, false, { cause: e });
  }
  return new StageError("upstream", "모델 호출 중 알 수 없는 오류가 발생했습니다.", false, { cause: e });
}
