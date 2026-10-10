import { describe, expect, it } from "vitest";
import { InMemoryCatalog } from "./catalog";
import { createStructuralValidator } from "./validator";

// 가상 카탈로그 — 실제 데이터셋 스키마와 무관
const catalog = new InMemoryCatalog(
  [
    { schema: "demo", name: "orders", columns: ["order_id", "customer_id", "amount", "ordered_at", "status"] },
    { schema: "demo", name: "customers", columns: ["customer_id", "region", "joined_at"] },
  ],
  "demo",
);
const validator = createStructuralValidator({ catalog, allowedSchemas: ["demo"] });
const check = (sql: string) => validator.validate(sql);

describe("허용: 읽기 전용 분석 쿼리", () => {
  it.each([
    ["기본 집계", "SELECT region, sum(o.amount) AS total FROM demo.orders o JOIN demo.customers c ON c.customer_id = o.customer_id GROUP BY region ORDER BY total DESC"],
    ["스키마 생략(기본 스키마)", "SELECT count(*) FROM orders WHERE status = 'paid'"],
    [
      "CTE + 윈도우 + 날짜 함수",
      `WITH m AS (SELECT customer_id, date_trunc('month', ordered_at) AS mon, sum(amount) AS amt FROM demo.orders GROUP BY 1, 2)
       SELECT customer_id, mon, amt, lag(amt) OVER (PARTITION BY customer_id ORDER BY mon) AS prev FROM m`,
    ],
    [
      "서브쿼리·CASE·FILTER·형변환",
      `SELECT c.region, count(DISTINCT o.customer_id) FILTER (WHERE o.amount > 0) AS buyers,
              round(avg(CASE WHEN o.status IN ('paid','done') THEN 1 ELSE 0 END)::numeric * 100, 1) AS paid_pct
       FROM demo.customers c LEFT JOIN demo.orders o ON o.customer_id = c.customer_id
       WHERE c.joined_at >= current_date - interval '30 days'
         AND EXISTS (SELECT 1 FROM demo.orders x WHERE x.customer_id = c.customer_id)
       GROUP BY c.region HAVING count(*) > 0`,
    ],
    ["파생 테이블", "SELECT q.total FROM (SELECT sum(amount) AS total FROM demo.orders) q"],
    ["extract (pg_catalog 한정 함수)", "SELECT extract(month FROM ordered_at) AS m, count(*) FROM demo.orders GROUP BY 1"],
    ["주석 안의 위험 문자열", "SELECT 1 /* ; DROP TABLE demo.orders */"],
    ["문자열 리터럴 안의 위험 문자열", "SELECT order_id FROM demo.orders WHERE status = ';DROP TABLE demo.orders'"],
  ])("%s", async (_, sql) => {
    const r = await check(sql);
    expect(r.errors).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("끝의 세미콜론을 정리한 실행용 SQL을 돌려준다", async () => {
    expect((await check("SELECT order_id FROM demo.orders ;  ")).normalizedSql).toBe("SELECT order_id FROM demo.orders");
  });
});

describe("차단: 위험 SQL (§12-8)", () => {
  it.each([
    ["INSERT", "INSERT INTO demo.orders(order_id) VALUES (1)", "INSERT 구문"],
    ["UPDATE", "UPDATE demo.orders SET amount = 0", "UPDATE 구문"],
    ["DELETE", "DELETE FROM demo.orders", "DELETE 구문"],
    ["DROP", "DROP TABLE demo.orders", "DROP 구문"],
    ["ALTER", "ALTER TABLE demo.orders ADD COLUMN x int", "ALTER 구문"],
    ["TRUNCATE", "TRUNCATE demo.orders", "TRUNCATE 구문"],
    ["CREATE", "CREATE TABLE demo.x (a int)", "CREATE 구문"],
    ["COPY", "COPY demo.orders TO STDOUT", "COPY 구문"],
    ["EXPLAIN ANALYZE(실제 실행됨)", "EXPLAIN ANALYZE DELETE FROM demo.orders", "EXPLAIN 구문"],
    ["다중 문장", "SELECT 1; DROP TABLE demo.orders", "여러 개의 SQL 문"],
    ["데이터 변경 CTE", "WITH d AS (DELETE FROM demo.orders RETURNING *) SELECT * FROM d", "DELETE 구문"],
    ["SELECT INTO", "SELECT * INTO demo.copy FROM demo.orders", "SELECT INTO"],
    ["행 잠금", "SELECT * FROM demo.orders FOR UPDATE", "잠금"],
    ["pg_sleep", "SELECT pg_sleep(10)", "pg_sleep()"],
    ["파일 읽기", "SELECT pg_read_file('/etc/passwd')", "pg_read_file()"],
    ["설정 변경", "SELECT set_config('statement_timeout', '0', false)", "set_config()"],
    ["스키마 한정 함수", "SELECT public.my_func(1)", "스키마를 지정한 함수"],
    ["FROM 함수", "SELECT * FROM generate_series(1, 10)", "FROM 절의 함수"],
    ["파라미터", "SELECT * FROM demo.orders WHERE order_id = $1", "바인딩 파라미터"],
    ["시스템 카탈로그", "SELECT * FROM pg_catalog.pg_user", "스키마 pg_catalog"],
    ["information_schema", "SELECT * FROM information_schema.tables", "스키마 information_schema"],
    ["다른 DB", "SELECT * FROM otherdb.demo.orders", "다른 데이터베이스"],
  ])("%s", async (_, sql, expected) => {
    const r = await check(sql);
    expect(r.passed).toBe(false);
    expect(r.normalizedSql).toBeNull();
    expect(r.errors.join(" ")).toContain(expected);
  });
});

describe("차단: 참조 오류 (§12-2, §12-7)", () => {
  it.each([
    ["문법 오류", "SELEC amount FROM demo.orders", "SQL 문법 오류"],
    ["없는 테이블", "SELECT * FROM demo.payments", "테이블 demo.payments이(가) 존재하지 않습니다"],
    ["스키마 생략 + 없는 테이블", "SELECT * FROM pg_user", "테이블 demo.pg_user"],
    ["없는 컬럼(한정)", "SELECT o.revenue FROM demo.orders o", "컬럼 o.revenue"],
    ["없는 컬럼(비한정)", "SELECT revenue FROM demo.orders", "컬럼 revenue"],
    ["없는 별칭", "SELECT x.amount FROM demo.orders o", "별칭 x"],
  ])("%s", async (_, sql, expected) => {
    const r = await check(sql);
    expect(r.passed).toBe(false);
    expect(r.errors.join(" ")).toContain(expected);
  });

  it("SELECT 별칭을 ORDER BY에서 참조하는 것은 허용한다", async () => {
    expect((await check("SELECT sum(amount) AS total FROM demo.orders ORDER BY total")).passed).toBe(true);
  });
});

describe("설정", () => {
  it("허용 스키마가 비어 있으면 모두 거부한다 (fail-closed)", async () => {
    const closed = createStructuralValidator({ catalog, allowedSchemas: [] });
    expect((await closed.validate("SELECT 1")).passed).toBe(false);
  });
});
