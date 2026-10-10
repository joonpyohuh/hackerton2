# Runtime Prompts

에이전트가 **실행 중에 LLM에 보내는 프롬프트**만 이곳에 둔다.
`CLAUDE.md`는 개발 규칙 문서이며 런타임에 로드하지 않는다.

| 파일 | 사용처 | 상태 |
|---|---|---|
| `sql-generator.v0.md` | SQL Generator (`GENERATOR_MODEL`) | 초안 — 08단계에서 확정 |
| `sql-verifier.v0.md` | Semantic Verifier (`VERIFIER_MODEL`) | 초안 — 04단계에서 확정 |

규칙
- 파일명에 버전을 붙인다(`.v0`, `.v1`). 검증 로그에는 사용한 프롬프트 버전을 함께 기록한다.
- `{{placeholder}}`는 서버 코드가 채운다. 스키마·지표 정의를 프롬프트에 하드코딩하지 않는다(Semantic Layer에서 주입).
- 프롬프트를 바꾸면 벤치마크를 다시 돌려 이전 버전과 비교한다.
