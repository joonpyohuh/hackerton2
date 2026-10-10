"use client";

import { useState } from "react";

export function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="relative bg-surface">
      <button
        type="button"
        onClick={copy}
        className="label absolute right-3 top-2.5 hover:text-ink focus-visible:text-ink focus-visible:outline-none"
      >
        {copied ? "복사됨" : "복사"}
      </button>
      <pre className="overflow-x-auto px-5 py-4 pr-16 font-mono text-[12.5px] leading-[1.75] tracking-normal text-ink">
        <code>{sql}</code>
      </pre>
    </div>
  );
}
