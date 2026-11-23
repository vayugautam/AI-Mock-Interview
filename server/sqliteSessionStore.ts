import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { InterviewRecord, UserRecord } from './createApp';

/** SQL-backed persistence for account and interview session records. */
export class SqliteSessionStore {
  private database: DatabaseSync;

  constructor(dataDir: string) {
    this.database = new DatabaseSync(path.join(dataDir, 'talentpulse_sessions.sqlite'));
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interview_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        record_json TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_interviews_user_created
        ON interview_sessions(user_id, created_at DESC);
    `);
  }

  private transaction(operation: () => void) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public countUsers(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return Number(row.count);
  }

  public countInterviews(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM interview_sessions').get() as { count: number };
    return Number(row.count);
  }

  public loadUsers(): Record<string, UserRecord> {
    const rows = this.database.prepare('SELECT id, record_json FROM users').all() as Array<{ id: string; record_json: string }>;
    return Object.fromEntries(rows.map((row) => [row.id, JSON.parse(row.record_json) as UserRecord]));
  }

  public loadInterviews(): InterviewRecord[] {
    const rows = this.database.prepare('SELECT record_json FROM interview_sessions ORDER BY created_at').all() as Array<{ record_json: string }>;
    return rows.map((row) => JSON.parse(row.record_json) as InterviewRecord);
  }

  public saveUsers(users: Record<string, UserRecord>) {
    const upsert = this.database.prepare(`
      INSERT INTO users (id, email, created_at, record_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        created_at = excluded.created_at,
        record_json = excluded.record_json
    `);
    this.transaction(() => {
      for (const user of Object.values(users)) {
        upsert.run(user.id, user.email, user.createdAt, JSON.stringify(user));
      }
    });
  }

  public saveInterviews(interviews: InterviewRecord[]) {
    const upsert = this.database.prepare(`
      INSERT INTO interview_sessions (id, user_id, created_at, completed_at, record_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at,
        record_json = excluded.record_json
    `);
    this.transaction(() => {
      for (const interview of interviews) {
        upsert.run(
          interview.id,
          interview.userId,
          interview.createdAt,
          interview.completedAt || null,
          JSON.stringify(interview)
        );
      }
    });
  }

  /** Import existing JSON stores once; the original files are retained as a local backup. */
  public migrateLegacyJson(usersFile: string, interviewsFile: string) {
    if (this.countUsers() === 0 && fs.existsSync(usersFile)) {
      const parsed = JSON.parse(fs.readFileSync(usersFile, 'utf8')) as Record<string, UserRecord>;
      this.saveUsers(parsed);
    }
    if (this.countInterviews() === 0 && fs.existsSync(interviewsFile)) {
      const parsed = JSON.parse(fs.readFileSync(interviewsFile, 'utf8')) as InterviewRecord[];
      const knownUsers = new Set(Object.keys(this.loadUsers()));
      this.saveInterviews(parsed.filter((interview) => knownUsers.has(interview.userId)));
    }
  }
}
