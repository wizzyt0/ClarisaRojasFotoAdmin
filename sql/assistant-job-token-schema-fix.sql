-- Patch only the existing assistant job RPC, preserving its owner and grants.
begin;

do $migration$
declare
  target regprocedure := to_regprocedure('public.assistant_create_job(jsonb)');
  definition text;
  old_call constant text := 'encode(gen_random_bytes(32), ''hex'')';
  new_call constant text := 'encode(extensions.gen_random_bytes(32), ''hex'')';
begin
  if target is null or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'Expected assistant job RPC or pgcrypto function is missing.';
  end if;

  definition := pg_get_functiondef(target);
  if strpos(definition, new_call) > 0 and strpos(definition, old_call) = 0 then
    return;
  end if;
  if strpos(definition, new_call) > 0 or
     length(definition) - length(replace(definition, old_call, '')) <> length(old_call) then
    raise exception 'Unexpected assistant job RPC definition; review before applying.';
  end if;

  execute replace(definition, old_call, new_call);
end;
$migration$;

commit;
