import dataSource from './data-source';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  await dataSource.initialize();

  try {
    if (command === 'show') {
      const pending = await dataSource.showMigrations();
      console.log(pending ? '存在待执行的 migration。' : '没有待执行的 migration。');
      return;
    }

    if (command === 'reset') {
      await dataSource.dropDatabase();
      const executed = await dataSource.runMigrations({ transaction: 'each' });
      console.log(`已重置数据库并执行 ${executed.length} 个 migration。`);
      return;
    }

    if (command === 'revert') {
      await dataSource.undoLastMigration({ transaction: 'each' });
      console.log('已回滚最后一个 migration。');
      return;
    }

    if (command === 'check') {
      const sql = await dataSource.driver.createSchemaBuilder().log();
      if (sql.upQueries.length > 0) {
        console.error('实体与 migration 不一致，缺少以下变更：');
        for (const query of sql.upQueries) console.error(`  ${query.query}`);
        process.exitCode = 1;
        return;
      }
      console.log('schema 与实体一致。');
      return;
    }

    const executed = await dataSource.runMigrations({ transaction: 'each' });
    if (executed.length === 0) {
      console.log('数据库已是最新，无需执行。');
    } else {
      console.log(`已执行 ${executed.length} 个 migration：`);
      for (const migration of executed) console.log(`  - ${migration.name}`);
    }
    const pending = await dataSource.showMigrations();
    if (pending) {
      console.error('仍有待执行的 migration，请检查。');
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
