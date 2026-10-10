/**
 * 구조 검사기가 참조하는 스키마 카탈로그.
 * TODO(05단계): DB information_schema에서 추출한 메타데이터로 생성한다. 실제 테이블명을 여기에 하드코딩하지 않는다.
 */
export type CatalogTable = { schema: string; name: string; columns: string[] };

export interface SchemaCatalog {
  /** 스키마 미지정 테이블을 해석할 기본 스키마 */
  readonly defaultSchema: string;
  getColumns(schema: string, table: string): ReadonlySet<string> | null;
}

export class InMemoryCatalog implements SchemaCatalog {
  private readonly tables = new Map<string, ReadonlySet<string>>();
  constructor(
    tables: CatalogTable[],
    readonly defaultSchema: string,
  ) {
    for (const t of tables) this.tables.set(`${t.schema}.${t.name}`, new Set(t.columns));
  }
  getColumns(schema: string, table: string): ReadonlySet<string> | null {
    return this.tables.get(`${schema}.${table}`) ?? null;
  }
}
