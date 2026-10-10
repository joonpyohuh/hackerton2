import { connection } from "next/server";
import { Suspense } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { getEnv } from "@/server/config/env";

async function Screen() {
  await connection(); // 런타임 환경변수(AGENT_MODE) 기준으로 렌더링
  let mode: "mock" | "live" = "mock";
  try {
    mode = getEnv().AGENT_MODE;
  } catch {
    // 설정 오류는 /api/health와 질문 시 응답에서 안내한다
  }
  return <Workspace mode={mode}/>;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}
