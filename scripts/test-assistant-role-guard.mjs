import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(process.env.CLARISA_TEST_DEPENDENCIES || import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const root = resolve(import.meta.dirname, "..");
const sql = readFileSync(resolve(root, "sql/assistant-role-deployment.sql"), "utf8");
const patchSql = readFileSync(resolve(root, "sql/assistant-job-date-guard.sql"), "utf8");
const extractFunction = (source) => source.match(/create or replace function public\.guard_assistant_routine_updates\(\)[\s\S]*?\$\$;/)?.[0];
const functionSql = extractFunction(patchSql);
assert.ok(functionSql, "The narrow assistant update migration must define the guard");
assert.equal(extractFunction(sql), functionSql, "Initial deployment and follow-up migration must use the same guard");

const db = new PGlite();
const query = (statement) => db.query(statement);
const jobId = "00000000-0000-4000-8000-000000000001";

test("assistant jobs trigger permits title and notes only", async () => {
  try {
    await db.exec(`
      create type public.staff_role as enum ('assistant', 'owner');
      create function public.has_staff_role(public.staff_role[])
      returns boolean language sql as $$ select true $$;
      create table public.jobs (
        id uuid primary key,
        title text,
        notes text,
        event_date date,
        delivery_date date,
        status text,
        price numeric,
        updated_at timestamptz default now()
      );
    `);
    await db.exec(functionSql);
    await db.exec(`
      create trigger assistant_routine_update_guard
      before update on public.jobs
      for each row execute function public.guard_assistant_routine_updates();
      insert into public.jobs (id, title, notes, event_date, delivery_date, status, price)
      values ('${jobId}', 'Graduación', 'Nota inicial', '2026-11-01', '2026-12-01', 'EDITING', 1000);
    `);

    await query(`update public.jobs set title = 'Graduación escolar' where id = '${jobId}'`);
    await query(`update public.jobs set notes = 'Nota actualizada' where id = '${jobId}'`);

    for (const statement of [
      `update public.jobs set event_date = '2026-11-02' where id = '${jobId}'`,
      `update public.jobs set delivery_date = '2026-12-02' where id = '${jobId}'`,
      `update public.jobs set status = 'READY_TO_PRINT' where id = '${jobId}'`,
      `update public.jobs set price = 9999 where id = '${jobId}'`
    ]) {
      await assert.rejects(query(statement), /datos rutinarios permitidos/);
    }

    const { rows } = await query(`
      select title, notes, event_date::text, delivery_date::text, status, price
      from public.jobs where id = '${jobId}'
    `);
    assert.deepEqual(rows[0], {
      title: "Graduación escolar",
      notes: "Nota actualizada",
      event_date: "2026-11-01",
      delivery_date: "2026-12-01",
      status: "EDITING",
      price: "1000"
    });
  } finally {
    await db.close();
  }
});
