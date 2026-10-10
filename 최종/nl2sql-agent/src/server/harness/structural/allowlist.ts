/**
 * AST 허용 목록. 여기에 없는 노드·함수는 모두 거부한다 (deny-by-default).
 * 노드 목록은 libpg-query(PG18)로 분석용 샘플 쿼리를 파싱해 실제 등장한 타입에서 추렸다.
 * 추가할 때는 그 노드가 데이터 변경·외부 접근·부수효과를 만들 수 없는지 확인한다.
 */
export const ALLOWED_NODES: ReadonlySet<string> = new Set([
  "SelectStmt",
  "ResTarget",
  "ColumnRef",
  "A_Star",
  "A_Const",
  "A_Expr",
  "A_ArrayExpr",
  "A_Indices",
  "A_Indirection",
  "String",
  "List",
  "BoolExpr",
  "BooleanTest",
  "NullTest",
  "CaseExpr",
  "CaseWhen",
  "CoalesceExpr",
  "MinMaxExpr",
  "RowExpr",
  "TypeCast",
  "CollateClause",
  "FuncCall",
  "SQLValueFunction", // current_date, current_timestamp
  "RangeVar",
  "RangeSubselect",
  "JoinExpr",
  "SubLink",
  "SortBy",
  "WindowDef",
  "GroupingSet",
  "CommonTableExpr",
]);

/** 사용자에게 보여줄 거부 사유. 대표적인 위험 노드만 별도 문구를 둔다. */
export const NODE_REJECTION: Record<string, string> = {
  InsertStmt: "INSERT",
  UpdateStmt: "UPDATE",
  DeleteStmt: "DELETE",
  MergeStmt: "MERGE",
  CreateStmt: "CREATE",
  CreateTableAsStmt: "CREATE TABLE AS",
  DropStmt: "DROP",
  AlterTableStmt: "ALTER",
  TruncateStmt: "TRUNCATE",
  CopyStmt: "COPY",
  GrantStmt: "GRANT",
  VariableSetStmt: "SET",
  TransactionStmt: "트랜잭션 제어",
  DoStmt: "DO 블록",
  CallStmt: "CALL",
  ExplainStmt: "EXPLAIN",
  LockingClause: "FOR UPDATE/SHARE 잠금",
  ParamRef: "바인딩 파라미터($n)",
  RangeFunction: "FROM 절의 함수 호출",
};

/** 함수는 스키마 미지정 또는 pg_catalog 한정만 허용한다. 이름은 소문자 기준. */
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // 집계
  "count", "sum", "avg", "min", "max", "stddev", "stddev_samp", "stddev_pop", "variance", "var_samp", "var_pop",
  "percentile_cont", "percentile_disc", "mode", "string_agg", "array_agg", "bool_and", "bool_or", "every", "corr",
  // 윈도우
  "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile", "lag", "lead",
  "first_value", "last_value", "nth_value",
  // 수치
  "abs", "round", "ceil", "ceiling", "floor", "trunc", "sign", "sqrt", "power", "ln", "log", "exp", "mod", "div",
  "width_bucket",
  // 날짜
  "date_trunc", "date_part", "extract", "age", "make_date", "make_interval", "to_char", "to_date", "to_timestamp",
  "date_bin", "justify_days", "timezone",
  // 문자열
  "lower", "upper", "length", "char_length", "substring", "substr", "btrim", "ltrim", "rtrim", "replace",
  "split_part", "concat", "concat_ws", "left", "right", "position", "strpos", "starts_with", "initcap", "lpad", "rpad",
  // 배열
  "array_length", "cardinality",
]);

export const MAX_SQL_LENGTH = 20_000;
