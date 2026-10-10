"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

const MAX = 500;

export function QuestionForm({
  running,
  onAsk,
  onCancel,
}: {
  running: boolean;
  onAsk: (q: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (running || !trimmed || trimmed.length > MAX) return;
    onAsk(trimmed);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 IME 조합 중 Enter는 무시
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 items-end gap-3 md:grid-cols-12 md:gap-x-8">
      <label htmlFor="question" className="label hidden md:col-span-3 md:block md:pb-3">
        질문
      </label>
      <div className="flex items-end gap-4 border-b border-ink md:col-span-9">
        <textarea
          id="question"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX}
          placeholder="데이터에 대해 질문하세요"
          className="field-sizing-content max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[17px] leading-[1.55] tracking-[-0.015em] placeholder:text-mute focus:outline-none"
        />
        <span className="pb-3 font-mono text-[11px] tabular-nums text-mute">
          {value.length}/{MAX}
        </span>
        {running ? (
          <button type="button" onClick={onCancel} className="pb-3 text-[14px] font-medium text-accent hover:underline">
            취소
          </button>
        ) : (
          <button
            type="submit"
            disabled={!trimmed}
            className="pb-3 text-[14px] font-medium hover:underline disabled:text-mute disabled:no-underline"
          >
            질문하기
          </button>
        )}
      </div>
    </form>
  );
}
