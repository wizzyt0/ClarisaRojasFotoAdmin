import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(process.env.CLARISA_TEST_DEPENDENCIES || import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const readSql = name => readFileSync(new URL(`../sql/${name}`, import.meta.url), "utf8");
const legacy = readSql("assistant-routine-writes.sql")
  .match(/create or replace function public\.assistant_record_deposit\([\s\S]*?\$\$;/)?.[0];
assert.ok(legacy);

test("deposit requests are append-only for assistants and replay the original receipt", async () => {
  const db = new PGlite();
  const job = "00000000-0000-4000-8000-000000000001";
  const assistant = "00000000-0000-4000-8000-000000000002";
  const owner = "00000000-0000-4000-8000-000000000003";
  const key = "00000000-0000-4000-8000-000000000004";
  const record = (amount, requestKey = key) => db.query(
    "select public.assistant_record_deposit_once($1, $2, $3) as receipt",
    [job, { amount, deposit_date: "2026-11-20" }, requestKey]
  );

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create type public.staff_role as enum ('assistant', 'owner');
      create function public.has_staff_role(roles public.staff_role[])
      returns boolean language sql stable as $$
        select case auth.uid()
          when '${assistant}'::uuid then 'assistant'::public.staff_role = any(roles)
          when '${owner}'::uuid then 'owner'::public.staff_role = any(roles)
          else false end
      $$;
      create table public.jobs (id uuid primary key);
      insert into public.jobs values ('${job}');
      create table public.deposits (
        id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs,
        amount numeric not null, deposit_date date not null, notes text, created_at timestamptz default now()
      );
      create table public.assistant_write_audit (actor_id uuid, action text, record_id uuid, related_id uuid);
      alter table public.deposits enable row level security;
      grant select, insert, update, delete on public.deposits to authenticated;
      create policy permissive_fixture on public.deposits for all to authenticated using (true) with check (true);
      ${legacy}
      grant execute on function public.assistant_record_deposit(uuid, jsonb) to authenticated;
    `);
    await db.exec(readSql("assistant-deposit-idempotency.sql"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${assistant}';`);
    const first = (await record(100.5)).rows[0].receipt;
    assert.ok(first.data.id);
    assert.equal(first.data.amount, 100.5);
    assert.deepEqual((await record(100.5)).rows[0].receipt, first);
    await assert.rejects(record(200), { code: "PT409" });
    await assert.rejects(db.query("select public.assistant_record_deposit($1, $2)", [job, {}]), { code: "42501" });
    await assert.rejects(db.query("insert into public.deposits(job_id, amount, deposit_date) values ($1, 20, current_date)", [job]), { code: "42501" });
    assert.equal((await db.query("update public.deposits set amount = 1 returning id")).rows.length, 0);
    assert.equal((await db.query("delete from public.deposits returning id")).rows.length, 0);
    assert.equal((await db.query("select count(*)::int as n from public.deposits")).rows[0].n, 1);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as n from public.assistant_write_audit")).rows[0].n, 1);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
    await assert.rejects(record(100.5), { code: "42501" });
    assert.equal((await db.query("update public.deposits set notes = 'owner correction' returning id")).rows.length, 1);
  } finally {
    await db.close();
  }
});
