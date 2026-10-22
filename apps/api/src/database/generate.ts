import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dataSource from './data-source';

async function main(): Promise<void> {
  const rawName = process.argv[2] ?? 'Schema';
  const className = rawName.replace(/[^a-zA-Z0-9]/g, '') || 'Schema';
  const timestamp = Date.now();
  const directory = join(__dirname, 'migrations');
  const filename = join(directory, `${timestamp}-${rawName}.ts`);

  await dataSource.initialize();
  try {
    const sql = await dataSource.driver.createSchemaBuilder().log();
    if (sql.upQueries.length === 0) {
      console.log('实体与数据库一致，没有生成新的 migration。');
      return;
    }

    const up = sql.upQueries
      .map((query) => `    await queryRunner.query(${JSON.stringify(query.query)});`)
      .join('\n');
    const down = [...sql.downQueries]
      .reverse()
      .map((query) => `    await queryRunner.query(${JSON.stringify(query.query)});`)
      .join('\n');

    const content = `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className}${timestamp} implements MigrationInterface {
  name = '${className}${timestamp}';

  public async up(queryRunner: QueryRunner): Promise<void> {
${up}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
${down}
  }
}
`;

    mkdirSync(directory, { recursive: true });
    writeFileSync(filename, content, 'utf8');
    console.log(`已生成 ${filename}（${sql.upQueries.length} 条语句）。`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
