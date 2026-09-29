import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const requireFromRepo = createRequire(input.packageJsonPath);
  const initSqlJs = requireFromRepo('sql.js');
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(path.dirname(input.packageJsonPath), 'node_modules', 'sql.js', 'dist', file),
  });
  const db = new SQL.Database(fs.readFileSync(input.dbPath));

  try {
    const columns = new Set(db.exec('PRAGMA table_info(users)')[0]?.values.map((row) => String(row[1])) ?? []);
    if (!columns.has('recovery_code_hash')) {
      throw new Error('Open PrintOps once after updating it, then close it before issuing a recovery code.');
    }

    const email = String(input.email || '').trim().toLowerCase();
    const query = db.prepare('SELECT id, is_active FROM users WHERE lower(email) = lower(?)');
    query.bind([email]);
    const rows = [];
    while (query.step()) rows.push(query.getAsObject());
    query.free();

    if (rows.length !== 1 || Number(rows[0].is_active) !== 1) {
      throw new Error('An active PrintOps account with this email was not found exactly once; no change was made.');
    }

    const recoveryCode = randomBytes(24).toString('base64url');
    const codeHash = createHash('sha256').update(recoveryCode).digest('hex');
    db.run('UPDATE users SET recovery_code_hash = ? WHERE id = ? AND is_active = 1', [codeHash, rows[0].id]);
    if (db.getRowsModified() !== 1) throw new Error('The recovery-code update did not affect exactly one account.');

    const temporaryPath = `${input.dbPath}.recovery-${process.pid}.tmp`;
    fs.rmSync(temporaryPath, { force: true });
    fs.writeFileSync(temporaryPath, Buffer.from(db.export()));
    fs.renameSync(temporaryPath, input.dbPath);
    process.stdout.write(`${recoveryCode}\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Recovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
