import type { SqlValue } from 'sql.js';
import type { User, UserRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { getDb } from '../../db/sqlite.js';
import { toDate, dateStr } from '../../db/json.js';

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as string,
    email: row['email'] as string,
    name: row['name'] as string,
    passwordHash: row['password_hash'] as string | undefined,
    role: row['role'] as User['role'],
    isActive: row['is_active'] === 1 || row['is_active'] === true,
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export class SqliteUserRepository implements UserRepositoryPort {
  async findById(id: string): Promise<User | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToUser(row);
    }
    stmt.free();
    return undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return rowToUser(row);
    }
    stmt.free();
    return undefined;
  }

  async findAll(opts?: ListOptions): Promise<User[]> {
    const db = getDb();
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit != null ? opts.limit : -1;
    const stmt = db.prepare('SELECT * FROM users ORDER BY email ASC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
    const results: User[] = [];
    while (stmt.step()) {
      results.push(rowToUser(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async create(input: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const db = getDb();
    const id = generateId();
    const now = dateStr(new Date());

    db.run(
      `INSERT INTO users (id, email, name, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.email, input.name, input.passwordHash ?? null, input.role, input.isActive ? 1 : 0, now, now],
    );

    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return rowToUser(row);
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) throw new Error(`User ${id} not found`);

    const fields: string[] = [];
    const values: SqlValue[] = [];

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlValue);
    };

    if ('email' in patch) add('email', patch.email);
    if ('name' in patch) add('name', patch.name);
    if ('passwordHash' in patch) add('password_hash', patch.passwordHash ?? null);
    if ('role' in patch) add('role', patch.role);
    if ('isActive' in patch) add('is_active', patch.isActive ? 1 : 0);

    add('updated_at', dateStr(new Date()));

    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    values.push(id as SqlValue);
    db.run(sql, values);

    return (await this.findById(id))!;
  }

  seed(user: User): void {
    const db = getDb();
    db.run(
      `INSERT OR REPLACE INTO users (id, email, name, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.id, user.email, user.name, user.passwordHash ?? null, user.role, user.isActive ? 1 : 0, dateStr(user.createdAt), dateStr(user.updatedAt)],
    );
  }
}