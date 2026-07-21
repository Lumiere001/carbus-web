import { createClient } from "/Users/east_star/Projects/carbus-web/node_modules/.pnpm/@supabase+supabase-js@2.106.0/node_modules/@supabase/supabase-js/dist/index.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync("/Users/east_star/Projects/carbus-web/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
// ⚠️ 새 Phase 에서 테이블을 만들면 **여기에 반드시 추가**할 것.
//    이 목록은 Phase 1 때 쓰인 뒤 갱신되지 않아 events·org_units·payment_ledger 가
//    2026-07-21 까지 백업에서 통째로 빠져 있었다. 장부 1,081건이 백업에 없다는 뜻이고,
//    그 백업으로는 복구도 로컬 재현도 되지 않는다(registrations.event_id 가 붕 뜬다).
//    load-backup.py 가 적재 시 DB 테이블 목록과 대조해 누락을 잡아준다.
// 순서: 참조되는 쪽 먼저 (events → registrations → payment_ledger)
const TABLES=["events","campuses","org_units","departure_slots","buses","registrations","profiles","role_labels","system_config","batch_runs","registration_audit","campus_remittances","campus_payment_settlements","payment_ledger"];
const manifest={created_at:new Date().toISOString(),purpose:process.argv[3]??"운영 스냅샷",tables:{}};
let failed=0;
for(const t of TABLES){
  const rows=[];let from=0;
  for(;;){const{data,error}=await db.from(t).select("*").range(from,from+999);
    if(error){console.log(`  ✗ ${t}: ${error.message}`);manifest.tables[t]={error:error.message};failed++;break;}
    rows.push(...(data??[]));if(!data||data.length<1000)break;from+=1000;}
  if(manifest.tables[t]?.error)continue;
  writeFileSync(`${OUT}/${t}.json`,JSON.stringify(rows,null,1));
  manifest.tables[t]={rows:rows.length};
  console.log(`  ✓ ${t.padEnd(28)} ${String(rows.length).padStart(6)} 행`);
}
writeFileSync(`${OUT}/_manifest.json`,JSON.stringify(manifest,null,2));
console.log(`\n실패: ${failed}`);
