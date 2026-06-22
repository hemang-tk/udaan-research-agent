/**
 * Postgres-backed persistence for research sessions (History). Optional: when no
 * DATABASE_URL is configured, a no-op store is used and runs stay ephemeral.
 */
import { Pool } from "pg";
import type { ResearchBrief } from "@udaan/contracts";

export interface ResearchSummary {
  id: string;
  query: string;
  createdAt: string;
  totalClaims: number;
  sections: number;
}

export interface ResearchRecord {
  id: string;
  query: string;
  projectId: string;
  brief: ResearchBrief;
  createdAt: string;
}

export interface ResearchStore {
  save(r: { id: string; query: string; projectId: string; brief: ResearchBrief }): Promise<void>;
  list(): Promise<ResearchSummary[]>;
  get(id: string): Promise<ResearchRecord | null>;
}

/** Used when DATABASE_URL is unset — the app runs, History is just empty. */
const noopStore: ResearchStore = {
  async save() {},
  async list() {
    return [];
  },
  async get() {
    return null;
  },
};

class PgResearchStore implements ResearchStore {
  private readonly ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS research (
          id text PRIMARY KEY,
          query text NOT NULL,
          project_id text NOT NULL,
          brief jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
      )
      .then(() => undefined);
  }

  async save(r: { id: string; query: string; projectId: string; brief: ResearchBrief }): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO research (id, query, project_id, brief)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET query = EXCLUDED.query, project_id = EXCLUDED.project_id, brief = EXCLUDED.brief`,
      [r.id, r.query, r.projectId, JSON.stringify(r.brief)],
    );
  }

  async list(): Promise<ResearchSummary[]> {
    await this.ready;
    const res = await this.pool.query(
      `SELECT id, query, created_at,
        COALESCE((brief -> 'metadata' ->> 'totalClaims')::int, 0) AS total_claims,
        COALESCE(jsonb_array_length(brief -> 'sections'), 0) AS sections
       FROM research ORDER BY created_at DESC LIMIT 100`,
    );
    return res.rows.map((row) => ({
      id: row.id as string,
      query: row.query as string,
      createdAt: new Date(row.created_at).toISOString(),
      totalClaims: Number(row.total_claims),
      sections: Number(row.sections),
    }));
  }

  async get(id: string): Promise<ResearchRecord | null> {
    await this.ready;
    const res = await this.pool.query(
      `SELECT id, query, project_id, brief, created_at FROM research WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id as string,
      query: row.query as string,
      projectId: row.project_id as string,
      brief: row.brief as ResearchBrief,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}

export function createResearchStore(databaseUrl?: string): ResearchStore {
  if (!databaseUrl) return noopStore;
  return new PgResearchStore(new Pool({ connectionString: databaseUrl }));
}
