import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { packageMatchesSchool } from "../js/package-levels.js";
import { activityChanges } from "../js/job-activity.js";

const require = createRequire(process.env.CLARISA_TEST_DEPENDENCIES || import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
const root = resolve(import.meta.dirname, "..");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), editor = id(2), job = id(3), client = id(4);
const primary = id(5), kinder = id(6), christmas = id(7), unclassified = id(8);
const groupA = id(9), groupB = id(10), pieceA = id(11);
const imageA = id(12), imageB = id(13), deposit = id(14);
const alternative = id(15), alternativeImage = id(16);
const query = (sql, args = []) => db.query(sql, args);
const rows = async (sql, args) => (await query(sql, args)).rows;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.user_id', true), '')::uuid $$;
    create type public.staff_role as enum ('owner','editor');
    create table staff_roles(user_id uuid primary key, role staff_role, display_name text);
    create function has_staff_role(staff_role[]) returns boolean language sql security definer as
      $$ select exists(select 1 from staff_roles where user_id=auth.uid() and role=any($1)) $$;
    create function set_updated_at() returns trigger language plpgsql as $$ begin return new; end $$;
    create table packages(id uuid primary key, name text, price numeric, package_type text, is_active boolean default true, description text);
    create table clients(id uuid primary key);
    create table jobs(id uuid primary key, client_id uuid, event_type text, package_id uuid, status text, price numeric default 0, package_quantity integer default 0);
    create table school_profiles(id uuid primary key default gen_random_uuid(), client_id uuid, school_level text);
    create table school_groups(id uuid primary key, job_id uuid, group_name text, selected_package_id uuid, package_quantity integer default 0, price numeric default 0, notes text);
    create table package_images(id uuid primary key, package_id uuid, file_name text, created_at timestamptz default now());
    create table diploma_templates(id uuid, name text, file_name text, school_level text, is_active boolean, created_at timestamptz);
    create table folder_templates(like diploma_templates);
    create table print_items(id uuid primary key, job_id uuid, group_id uuid, item_type text, title text,
      status text, selected_file_id uuid, selected_package_id uuid, approval_token text, approval_revoked_at timestamptz,
      approval_token_expires_at timestamptz, client_notes text, changes_requested_at timestamptz, notes text);
    create table deposits(id uuid primary key, job_id uuid, group_id uuid, amount numeric, deposit_date date, notes text);
    create view job_financial_summary as select id, price from jobs;
    insert into auth.users values ('${owner}', 'owner@example.test'), ('${editor}', 'editor@example.test');
    insert into staff_roles values ('${owner}', 'owner', 'Owner'), ('${editor}', 'editor', 'Editor');
    select set_config('request.user_id', '${owner}', false);
    insert into clients values ('${client}');
    insert into jobs(id,client_id,event_type) values ('${job}','${client}','GRADUATION');
    insert into school_profiles(client_id,school_level) values ('${client}','PRIMARY');
  `);
  const migration = readFileSync(resolve(root, "sql/package-levels-activity.sql"), "utf8");
  await db.exec(migration);
  await db.exec(migration); // Re-running must preserve records and policies.
  await db.exec(`
    insert into packages(id,name,price,package_type,school_level) values
      ('${primary}','Primaria',100,'SCHOOL_GRADUATION','PRIMARY'),
      ('${kinder}','Preescolar',80,'SCHOOL_GRADUATION','KINDER'),
      ('${christmas}','Navidad',50,'SCHOOL_CHRISTMAS',null),
      ('${unclassified}','Antiguo',90,'SCHOOL_GRADUATION',null);
    insert into package_images(id,package_id,file_name) values
      ('${imageA}','${primary}','primary.jpg'), ('${imageB}','${kinder}','kinder.jpg');
    insert into school_groups(id,job_id,group_name) values ('${groupA}','${job}','6A'), ('${groupB}','${job}','6B');
    insert into print_items(id,job_id,group_id,item_type,approval_token)
      values ('${pieceA}','${job}','${groupA}','PHOTO_PACKAGE','test-token');
  `);
  assert.deepEqual((await rows("select get_public_catalog_by_print_item_token('test-token') as catalog"))[0].catalog.map(x=>x.package_id), [primary]);
  await assert.rejects(() => query("select select_catalog_option_by_token('test-token','package_images',$1,null,20)",[imageB]), /nivel escolar/);
  await query("select select_catalog_option_by_token('test-token','package_images',$1,null,20)",[imageA]);
  assert.equal(Number((await rows("select price from jobs where id=$1",[job]))[0].price), 2000);
  await query("update school_groups set selected_package_id=$1,package_quantity=10 where id=$2",[primary,groupB]);
  assert.equal(Number((await rows("select price from jobs where id=$1",[job]))[0].price), 3000);
  await query("update school_groups set package_quantity=15 where id=$1",[groupA]);
  let totals = (await rows("select price,package_quantity from jobs where id=$1",[job]))[0];
  assert.equal(Number(totals.price),2500);
  assert.equal(totals.package_quantity,25);
  assert.equal((await rows("select selected_file_id from print_items where id=$1",[pieceA]))[0].selected_file_id,imageA);
  await query("insert into packages(id,name,price,package_type,school_level) values ($1,'Primaria Plus',150,'SCHOOL_GRADUATION','PRIMARY')",[alternative]);
  await query("insert into package_images(id,package_id,file_name) values ($1,$2,'plus.jpg')",[alternativeImage,alternative]);
  await query("update school_groups set selected_package_id=$1 where id=$2",[alternative,groupA]);
  assert.equal(Number((await rows("select price from jobs where id=$1",[job]))[0].price),3250);
  const changedPiece = (await rows("select * from print_items where id=$1",[pieceA]))[0];
  assert.equal(changedPiece.selected_file_id,alternativeImage);
  assert.equal(changedPiece.approval_token,'test-token');
  const packageLog = (await rows("select * from job_activity where entity_id=$1 and entity_type='school_groups' order by id desc limit 1",[groupA]))[0];
  assert.equal(packageLog.before_data.package_name,'Primaria');
  assert.equal(packageLog.after_data.package_name,'Primaria Plus');
  await query("update school_groups set selected_package_id=$1 where id=$2",[primary,groupA]);
  await assert.rejects(()=>query("update school_groups set selected_package_id=$1 where id=$2",[kinder,groupA]),/nivel escolar/);
  await assert.rejects(()=>query("update school_groups set selected_package_id=$1 where id=$2",[christmas,groupA]),/tipo de trabajo/);
  await assert.rejects(()=>query("update school_groups set selected_package_id=$1 where id=$2",[unclassified,groupA]),/nivel escolar/);
  await query("insert into deposits values ($1,$2,$3,500,current_date,'Efectivo')",[deposit,job,groupA]);
  await query("update deposits set amount=600 where id=$1",[deposit]);
  await query("delete from deposits where id=$1",[deposit]);
  const audit = await rows("select * from job_activity where entity_type='deposits' order by id");
  assert.deepEqual(audit.map(x=>x.operation),["INSERT","UPDATE","DELETE"]);
  assert.equal(audit[1].before_data.amount,500);
  assert.equal(audit[1].after_data.amount,600);
  assert.equal(audit[1].actor_id,owner);
  assert(activityChanges(audit[1]).some(x=>x.includes("500") && x.includes("600")));
  await db.exec('set role authenticated');
  assert((await rows('select * from job_activity')).length > 0);
  await assert.rejects(()=>query("update job_activity set actor_label='Modified'"), /permission denied/);
  await db.exec('reset role');
  await db.exec(`set role authenticated; select set_config('request.user_id','${editor}',false);`);
  assert.equal((await rows("select * from job_activity")).length,0);
  await assert.rejects(()=>query("delete from job_activity"), /permission denied/);
  await db.exec(`reset role; select set_config('request.user_id','${owner}',false);`);
  await query("update packages set price=0 where id=$1",[primary]);
  await query("update school_groups set package_quantity=16 where id=$1",[groupA]);
  assert.equal(Number((await rows("select price from school_groups where id=$1",[groupA]))[0].price),0);
  await query("delete from school_groups where id=$1",[groupB]);
  assert.equal(Number((await rows("select price from jobs where id=$1",[job]))[0].price),0);
  assert(packageMatchesSchool({package_type:"SCHOOL_GRADUATION",school_level:"PRIMARY"},"SCHOOL_GRADUATION","PRIMARY"));
  assert(!packageMatchesSchool({package_type:"SCHOOL_GRADUATION",school_level:"KINDER"},"SCHOOL_GRADUATION","PRIMARY"));
  assert(!packageMatchesSchool({package_type:"SCHOOL_GRADUATION"},"SCHOOL_GRADUATION",null));
  assert(packageMatchesSchool({package_type:"SCHOOL_CHRISTMAS"},"SCHOOL_CHRISTMAS",null));
  await query("update school_profiles set school_level='KINDER' where client_id=$1",[client]);
  assert.deepEqual((await rows("select get_public_catalog_by_print_item_token('test-token') as catalog"))[0].catalog.map(x=>x.package_id), [kinder]);
  await query("update school_profiles set school_level=null where client_id=$1",[client]);
  assert.deepEqual((await rows("select get_public_catalog_by_print_item_token('test-token') as catalog"))[0].catalog, []);
  await query("update jobs set event_type='CHRISTMAS' where id=$1",[job]);
  await query("update school_groups set selected_package_id=$1,package_quantity=20 where id=$2",[christmas,groupA]);
  assert.equal(Number((await rows('select price from jobs where id=$1',[job]))[0].price),1000);
  const historyCount = (await rows('select count(*)::int as n from job_activity'))[0].n;
  await db.exec(migration);
  assert.equal((await rows('select count(*)::int as n from job_activity'))[0].n,historyCount);
  console.log("OK: catalogues, public selection, admin changes, group totals, audit trail and editor restrictions.");
} catch (error) {
  console.error(error.message, error.detail || "", error.where || "");
  process.exitCode = 1;
} finally {
  await db.close();
}
