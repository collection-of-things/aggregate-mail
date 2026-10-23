import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StorageMaintenance, storageNeedsVacuum, maintenanceProbeInterval } from "./storage-maintenance.js";

// Fresh processes prove reopen behavior without opening a saved profile.
function run(directory: string, source: string) {
  const env = { ...process.env, MAIL_DATA_DIR: directory, MAIL_DATA_KEY: "", MAIL_DESKTOP_TOKEN: "synthetic-maintenance",
    MAIL_CONFIG_PATH: path.join(directory, "absent.env") };
  delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    env, encoding: "utf8", timeout: 30000,
  });
  assert.equal(child.status, 0, child.stdout + child.stderr);
}

test("compaction preserves ciphertext, unknown records, drafts and key bytes across reopen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-storage-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      import { readFileSync, writeFileSync } from 'node:fs';
      import { DatabaseSync } from 'node:sqlite';
      const s = await import('./server/store.ts');
      const raw = new DatabaseSync(process.env.MAIL_DATA_DIR + '/mail.sqlite');
      for (let i=0; i<32; i++) s.put('mail', 'large-'+i, { id:'large-'+i, accountId:'a', body:'x'.repeat(32768), attachments:[] });
      for (let i=0; i<32; i++) s.remove('mail', 'large-'+i);
      s.put('draft','d',{id:'d',accountId:'a',revision:3,sendUnknown:true,attachments:[{filename:'inline',contentType:'text/plain',content:'c3ludGhldGlj'}]});
      s.put('attachment','orphan',{accountId:'a',content:'c3ludGhldGlj'});
      raw.prepare('INSERT INTO records VALUES (?,?,?)').run('future-kind','future',s.encrypt({attachment:'orphan'}));
      const before = raw.prepare('SELECT * FROM records ORDER BY kind,id').all();
      const key = readFileSync(process.env.MAIL_DATA_DIR + '/key');
      const size = Number(raw.prepare('PRAGMA page_count').get().page_count);
      const result = s.compactStore({ cleanupOrphans:true, isDrained:()=>true });
      assert.equal(result.removedAttachments,0);
      assert.equal(result.cleanupSkipped,'unknown-record-kind');
      assert.deepEqual(raw.prepare('SELECT * FROM records ORDER BY kind,id').all(),before);
      assert.ok(Number(raw.prepare('PRAGMA page_count').get().page_count) < size);
      assert.deepEqual(readFileSync(process.env.MAIL_DATA_DIR + '/key'),key);
      writeFileSync(process.env.MAIL_DATA_DIR + '/expected.json',JSON.stringify(before));
      raw.close(); s.closeStore();
    `);
    run(directory, `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { DatabaseSync } from 'node:sqlite';
      const s = await import('./server/store.ts');
      const raw = new DatabaseSync(process.env.MAIL_DATA_DIR + '/mail.sqlite');
      assert.deepEqual(JSON.parse(JSON.stringify(raw.prepare('SELECT * FROM records ORDER BY kind,id').all())),JSON.parse(readFileSync(process.env.MAIL_DATA_DIR+'/expected.json','utf8')));
      assert.equal(s.get('draft','d').attachments[0].content,'c3ludGhldGlj');
      raw.close(); s.closeStore();
    `);
  } finally { rmSync(directory, { recursive:true, force:true }); }
});

test("orphan cleanup uses exact references in every view and refuses unsafe or busy work", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-orphans-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      import { DatabaseSync } from 'node:sqlite';
      const s = await import('./server/store.ts');
      const raw = new DatabaseSync(process.env.MAIL_DATA_DIR+'/mail.sqlite');
      for (const [id,extra] of [['a:archive',{archived:true}],['a:sent',{direction:'sent'}]]) {
        s.put('mail',id,{id,accountId:'a',attachments:[{id:'keep'}],...extra});
        s.put('attachment',id+':keep',{accountId:'a',content:'YQ=='});
        s.put('attachment',id+':stale',{accountId:'a',content:'Yg=='});
      }
      s.put('draft','d',{id:'d',accountId:'a',attachments:[{filename:'inline',contentType:'text/plain',content:'Yw=='}]});
      s.put('attachment','a:gone:orphan',{accountId:'a',content:'ZA=='});
      assert.throws(()=>s.compactStore({cleanupOrphans:true,isDrained:()=>false}),/drain/i);
      assert.equal(s.count('attachment'),5);
      raw.exec('BEGIN IMMEDIATE');
      assert.throws(()=>s.compactStore({cleanupOrphans:true,isDrained:()=>true}),/busy|locked/i);
      raw.exec('ROLLBACK');
      raw.exec('BEGIN'); raw.prepare('SELECT * FROM records').all();
      s.put('meta','sync',{lastSync:1});
      assert.throws(()=>s.compactStore({cleanupOrphans:true,isDrained:()=>true}),/busy|reader/i);
      raw.exec('ROLLBACK');
      assert.equal(s.count('attachment'),5);
      const loading = s.readMail();
      assert.throws(()=>s.compactStore({cleanupOrphans:true,isDrained:()=>true}),/reader|loading/i);
      await loading;
      const result = s.compactStore({cleanupOrphans:true,isDrained:()=>true});
      assert.equal(result.removedAttachments,3);
      assert.equal(s.count('attachment'),2);
      assert.equal(s.get('draft','d').attachments[0].content,'Yw==');
      for (const id of ['a:archive:keep','a:sent:keep']) assert.ok(s.get('attachment',id));
      s.put('mail','legacy',{id:'legacy',accountId:'a'});
      s.put('attachment','legacy:uncertain',{accountId:'a',content:'YQ=='});
      assert.equal(s.compactStore({cleanupOrphans:true,isDrained:()=>true}).cleanupSkipped,'incomplete-mail-metadata');
      assert.ok(s.get('attachment','legacy:uncertain'));
      s.remove('mail','legacy');
      raw.exec("CREATE TRIGGER deny_cleanup BEFORE DELETE ON records WHEN OLD.kind='attachment' BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure'); END");
      assert.throws(()=>s.compactStore({cleanupOrphans:true,isDrained:()=>true}),/synthetic cleanup failure/);
      assert.ok(s.get('attachment','legacy:uncertain'));
      raw.close(); s.closeStore();
    `);
    run(directory, `
      import assert from 'node:assert/strict';
      const s = await import('./server/store.ts');
      assert.ok(s.get('attachment','legacy:uncertain'));
      assert.equal(s.get('draft','d').attachments[0].content,'Yw==');
      assert.equal(s.count('mail'),2); s.closeStore();
    `);
  } finally { rmSync(directory, { recursive:true, force:true }); }
});

test("the authenticated maintenance endpoint drains admitted parsing and blocks new work", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-maintenance-api-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      const s = await import('./server/store.ts');
      const backend = await import('./server/index.ts');
      const actions = await import('./server/mail-actions.ts');
      const {quietImapWatch,quietGmailRevision} = await import('./server/imap-watch-fixture.ts');
      const server = await backend.startServer(0,undefined,undefined,undefined,quietImapWatch,quietGmailRevision);
      const base = 'http://127.0.0.1:'+server.address().port;
      const headers = {'X-Desktop-Token':'synthetic-maintenance','Content-Type':'application/json'};
      const csrf = (await (await fetch(base+'/api/state',{headers})).json()).csrf;
      const compact = (extra={},body={confirm:true})=>fetch(base+'/api/storage/compact',{method:'POST',headers:{...headers,'X-CSRF-Token':csrf,...extra},body:JSON.stringify(body)});
      let release;
      const gate = new Promise(resolve=>{release=resolve});
      try {
        assert.equal((await compact({'X-CSRF-Token':'wrong'})).status,403);
        assert.equal((await compact({},{})).status,400);
        const parsing = actions.trackMailWork(async()=>{
          s.put('attachment','a:message:file',{accountId:'a',content:'YQ=='});
          await gate;
          s.put('mail','a:message',{id:'a:message',accountId:'a',attachments:[{id:'file'}],archived:true,direction:'sent'});
        });
        let responded=false;
        const pending=compact().then(response=>{responded=true;return response});
        const deadline=Date.now()+3000;
        while(!actions.mailIsQuiesced()) {assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,5));}
        assert.equal(responded,false);
        assert.ok(s.get('attachment','a:message:file'));
        await assert.rejects(backend.quiesceMail(5),/maintenance/);
        backend.resumeMail(); assert.equal(actions.mailIsQuiesced(),true);
        assert.equal((await compact()).status,503);
        await assert.rejects(actions.trackMailWork(async()=>{}),/paused/);
        release(); await parsing;
        const response=await pending; assert.equal(response.status,200);
        assert.equal((await response.json()).removedAttachments,0);
        assert.ok(s.get('attachment','a:message:file'));
        assert.equal(actions.mailIsQuiesced(),false);
        await actions.trackMailWork(async()=>{});
      } finally {
        release(); backend.resumeMail();
        await new Promise(resolve=>server.close(resolve)); s.closeStore();
      }
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test("automatic maintenance is installed at server startup without an HTTP trigger", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-auto-start-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      const intervals=[];
      let now=Date.now(); Date.now=()=>now;
      const original=globalThis.setInterval;
      globalThis.setInterval=(callback,delay,...args)=>{
        const timer=original(callback,delay,...args); intervals.push({callback,delay,timer}); return timer;
      };
      const backend=await import('./server/index.ts');
      const s=await import('./server/store.ts');
      const {quietImapWatch,quietGmailRevision}=await import('./server/imap-watch-fixture.ts');
      const server=await backend.startServer(0,undefined,undefined,undefined,quietImapWatch,quietGmailRevision);
      try {
        assert.equal(intervals.filter(x=>x.delay===300000).length,1,'startup must install one five-minute maintenance probe');
        const timer=intervals.find(x=>x.delay===300000);
        assert.equal(timer.timer.hasRef(),false);
        s.put('attachment','orphan',{accountId:'a',content:'YQ=='});
        s.compactStore({isDrained:()=>true});
        assert.equal(s.storageStats().freePages,0);
        now+=300000; await timer.callback();
        assert.equal(s.count('attachment'),0,'startup timer cleans orphans without any HTTP request');
        assert.equal(s.get('maintenance','storage').lastInventoryAt,now);
        const actions=await import('./server/mail-actions.ts');
        assert.equal(actions.mailIsQuiesced(),false);
        for(let i=0;i<40;i++) s.put('attachment','large-'+i,{accountId:'a',content:'x'.repeat(512*1024)});
        for(let i=0;i<40;i++) s.remove('attachment','large-'+i);
        const before=s.storageStats(); assert.ok(before.freePages*before.pageSize>=16*1024*1024);
        now+=6*60*60*1000; await timer.callback();
        assert.equal(s.storageStats().freePages,0,'eligible timer performs threshold-gated vacuum');
        assert.ok(s.storageStats().pageCount<before.pageCount);
        await actions.trackMailWork(async()=>{});
      }
      finally { await new Promise(resolve=>server.close(resolve)); for(const x of intervals) clearInterval(x.timer); s.closeStore(); }
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test("mail activity exposes queued and active work and records completion", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-auto-idle-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      const a=await import('./server/mail-actions.ts');
      const s=await import('./server/store.ts');
      try {
        assert.equal(typeof a.mailWorkActivity,'function','automatic maintenance needs a read-only activity seam');
        assert.deepEqual(Object.keys(a.mailWorkActivity()).sort(),['active','lastCompletedAt','queued']);
      } finally { s.closeStore(); }
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

const minute = 60_000;
const hour = 60 * minute;
function maintenanceFixture() {
  let now = 100 * hour;
  let unavailable = false;
  let activity = { queued: 0, active: 0, lastCompletedAt: now - minute };
  let stats = { pageSize: 4096, pageCount: 20480, freePages: 4096 };
  let lastInventoryAt: number | undefined = now;
  let attempts = 0, probes = 0, fail = false, defer = false;
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  const options: { cleanupOrphans: boolean; vacuum: "if-needed"; inventoryAt: number }[] = [];
  const service = new StorageMaintenance({
    activity: () => activity,
    unavailable: () => unavailable,
    stats: () => { probes++; return stats; },
    lastInventoryAt: () => lastInventoryAt,
    maintain: async (input) => {
      attempts++; options.push(input);
      if (hold) await hold;
      if (fail) throw new Error("synthetic maintenance failure");
      return !defer;
    },
  }, () => now);
  return {
    service, options,
    get attempts() { return attempts; }, get probes() { return probes; },
    advance: (delta: number) => { now += delta; },
    unavailable: (value: boolean) => { unavailable = value; },
    activity: (value: Partial<typeof activity>) => { activity = { ...activity, ...value }; },
    stats: (value: Partial<typeof stats>) => { stats = { ...stats, ...value }; },
    inventory: (value: number | undefined) => { lastInventoryAt = value; },
    fail: (value: boolean) => { fail = value; }, defer: (value: boolean) => { defer = value; },
    hold: () => { hold = new Promise<void>(resolve => { release = resolve; }); },
    release: () => release?.(),
  };
}

test("automatic vacuum requires both exact free-byte and free-page thresholds", () => {
  assert.equal(maintenanceProbeInterval, 5 * minute);
  const boundary = { pageSize: 4096, pageCount: 20480, freePages: 4096 };
  assert.equal(storageNeedsVacuum(boundary), true);
  assert.equal(storageNeedsVacuum({ ...boundary, freePages: 4095 }), false);
  assert.equal(storageNeedsVacuum({ ...boundary, pageCount: 20481 }), false);
  assert.equal(storageNeedsVacuum({ ...boundary, pageCount: 40960, freePages: 8192 }), true);
  assert.equal(storageNeedsVacuum({ pageSize: 4096, pageCount: 0, freePages: 0 }), false);
});

test("automatic probes require genuine idle, skip unavailable work and close without overlap", async () => {
  const f = maintenanceFixture();
  try {
    f.activity({ active: 1 }); await f.service.probe();
    f.activity({ active: 0, queued: 1 }); await f.service.probe();
    f.activity({ queued: 0, lastCompletedAt: 100 * hour - minute + 1 }); await f.service.probe();
    assert.equal(f.probes, 0);
    f.advance(1); f.unavailable(true); await f.service.probe(); assert.equal(f.probes, 0);
    f.unavailable(false); f.hold(); const pending = f.service.probe();
    await f.service.probe(); assert.equal(f.attempts, 1);
    f.service.close(); f.release(); await pending;
    f.advance(24 * hour); await f.service.probe(); assert.equal(f.attempts, 1);
  } finally { f.release(); f.service.close(); }
});

test("automatic inventory is independently daily at zero freelist and success waits six hours", async () => {
  const f = maintenanceFixture();
  try {
    f.stats({ freePages: 0 });
    f.inventory(76 * hour + 1); await f.service.probe(); assert.equal(f.attempts, 0);
    f.advance(1); await f.service.probe(); assert.equal(f.attempts, 1);
    assert.equal(f.options[0].cleanupOrphans, true);
    f.advance(6 * hour - 1); await f.service.probe(); assert.equal(f.attempts, 1);
    f.inventory(100 * hour); f.stats({ freePages: 4096 });
    f.advance(1); await f.service.probe(); assert.equal(f.attempts, 2);
    assert.equal(f.options[1].cleanupOrphans, false);
  } finally { f.service.close(); }
});

test("automatic failures back off once from thirty minutes to six hours, then success resets", async () => {
  const f = maintenanceFixture();
  try {
    f.fail(true);
    for (const delay of [30 * minute, hour, 2 * hour, 4 * hour, 6 * hour, 6 * hour]) {
      const before = f.attempts;
      await f.service.probe(); assert.equal(f.attempts, before + 1);
      f.advance(delay - 1); await f.service.probe(); assert.equal(f.attempts, before + 1);
      f.advance(1);
    }
    f.fail(false); await f.service.probe(); const successful = f.attempts;
    f.advance(6 * hour - 1); await f.service.probe(); assert.equal(f.attempts, successful);
    f.advance(1); f.fail(true); await f.service.probe();
    f.advance(30 * minute); await f.service.probe(); assert.equal(f.attempts, successful + 2);
  } finally { f.service.close(); }
});

test("automatic deferral applies no success cooldown and cheap probes do no inventory", async () => {
  const f = maintenanceFixture();
  try {
    f.stats({ freePages: 0 }); await f.service.probe(); await f.service.probe();
    assert.equal(f.probes, 2); assert.equal(f.attempts, 0);
    f.inventory(undefined); f.defer(true); await f.service.probe();
    f.defer(false); await f.service.probe(); assert.equal(f.attempts, 2);
  } finally { f.service.close(); }
});

test("automatic cleanup can remove zero-freelist orphans without vacuum and persists encrypted timing", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-auto-cleanup-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      import {readFileSync,writeFileSync} from 'node:fs';
      import {DatabaseSync} from 'node:sqlite';
      const s=await import('./server/store.ts');
      const raw=new DatabaseSync(process.env.MAIL_DATA_DIR+'/mail.sqlite');
      s.put('mail','a:sent',{id:'a:sent',accountId:'a',archived:true,direction:'sent',attachments:[{id:'keep'}]});
      s.put('attachment','a:sent:keep',{accountId:'a',content:'YQ=='});
      s.put('draft','d',{id:'d',accountId:'a',revision:7,sendUnknown:true,attachments:[]});
      s.put('calendarEvent','e',{id:'e',revision:2}); s.put('project','p',{id:'p'});
      s.put('config','connection',{GOOGLE_CLIENT_ID:'synthetic'});
      s.put('attachment','orphan',{accountId:'a',content:'Yg=='});
      s.compactStore({isDrained:()=>true});
      assert.equal(s.storageStats().freePages,0);
      const before=raw.prepare("SELECT * FROM records WHERE id!='orphan' ORDER BY kind,id").all();
      const key=readFileSync(process.env.MAIL_DATA_DIR+'/key');
      const result=s.compactStore({cleanupOrphans:true,vacuum:'if-needed',inventoryAt:123456,isDrained:()=>true});
      assert.equal(result.vacuumed,false); assert.equal(result.removedAttachments,1);
      assert.deepEqual(raw.prepare("SELECT * FROM records WHERE kind!='maintenance' ORDER BY kind,id").all(),before);
      assert.deepEqual(readFileSync(process.env.MAIL_DATA_DIR+'/key'),key);
      assert.equal(s.get('draft','d').revision,7); assert.equal(s.get('draft','d').sendUnknown,true);
      const timing=raw.prepare("SELECT value FROM records WHERE kind='maintenance'").get().value;
      assert.ok(!timing.includes('lastInventoryAt')); assert.ok(!timing.includes('123456'));
      assert.equal(s.get('maintenance','storage').lastInventoryAt,123456);
      s.put('attachment','orphan2',{accountId:'a',content:'Yg=='});
      assert.equal(s.compactStore({cleanupOrphans:true,vacuum:false,isDrained:()=>true}).removedAttachments,1,'maintenance kind is recognized');
      s.put('mail','legacy',{id:'legacy',accountId:'a'});
      s.put('attachment','uncertain',{accountId:'a',content:'Yg=='});
      assert.equal(s.compactStore({cleanupOrphans:true,vacuum:false,isDrained:()=>true}).cleanupSkipped,'incomplete-mail-metadata');
      s.remove('mail','legacy');
      s.put('attachment','bad',{});
      assert.equal(s.compactStore({cleanupOrphans:true,vacuum:false,isDrained:()=>true}).cleanupSkipped,'incomplete-attachment-metadata');
      assert.ok(s.get('attachment','uncertain')); s.remove('attachment','bad');
      raw.prepare('INSERT INTO records VALUES (?,?,?)').run('mail','corrupt','invalid-ciphertext');
      assert.doesNotThrow(()=>s.storageStats(),'cheap stats never decrypt the mailbox');
      assert.throws(()=>s.compactStore({cleanupOrphans:true,vacuum:false,isDrained:()=>true}));
      assert.ok(s.get('attachment','uncertain'));
      raw.prepare("DELETE FROM records WHERE id='corrupt'").run();
      writeFileSync(process.env.MAIL_DATA_DIR+'/expected.json',JSON.stringify(before));
      raw.close();s.closeStore();
    `);
    run(directory, `
      import assert from 'node:assert/strict';
      const s=await import('./server/store.ts');
      assert.equal(s.get('maintenance','storage').lastInventoryAt,123456);
      assert.equal(s.get('draft','d').revision,7); assert.equal(s.get('draft','d').sendUnknown,true);
      assert.ok(s.get('attachment','a:sent:keep')); assert.ok(s.get('calendarEvent','e')); assert.ok(s.get('project','p'));
      s.closeStore();
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test("automatic busy-reader failure resumes work and backs off; UI reads do not reset genuine idle", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-auto-busy-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      import {DatabaseSync} from 'node:sqlite';
      let tick;
      const original=setInterval; let now=Date.now(); Date.now=()=>now;
      globalThis.setInterval=(callback,delay,...args)=>{if(delay===300000)tick=callback; return original(callback,delay,...args)};
      const s=await import('./server/store.ts'); const a=await import('./server/mail-actions.ts');
      const backend=await import('./server/index.ts');
      const {quietImapWatch,quietGmailRevision}=await import('./server/imap-watch-fixture.ts');
      const server=await backend.startServer(0,undefined,undefined,undefined,quietImapWatch,quietGmailRevision);
      const raw=new DatabaseSync(process.env.MAIL_DATA_DIR+'/mail.sqlite');
      const base='http://127.0.0.1:'+server.address().port;
      try {
        const stamp=a.mailWorkActivity().lastCompletedAt;
        for(let i=0;i<3;i++) {
          const response=await fetch(base+'/api/state',{headers:{'X-Desktop-Token':'synthetic-maintenance'}});
          assert.equal(response.status,200); await response.json();
        }
        assert.equal(a.mailWorkActivity().lastCompletedAt,stamp);
        s.put('attachment','parsing:file',{accountId:'a',content:'YQ=='});
        let release;
        const parsing=a.trackMailWork(async()=>{
          await new Promise(resolve=>{release=resolve});
          s.put('mail','parsing',{id:'parsing',accountId:'a',attachments:[{id:'file'}]});
        });
        const queued=a.runMailWork(async()=>{});
        now+=300000;await tick();
        assert.equal(a.mailIsQuiesced(),false);assert.equal(s.get('maintenance','storage'),undefined);
        release();await parsing;await queued;
        now+=59999;await tick();assert.equal(s.get('maintenance','storage'),undefined);
        now++;
        raw.exec('BEGIN');raw.prepare('SELECT * FROM records').all();
        s.put('attachment','orphan',{accountId:'a',content:'YQ=='});
        await tick();
        assert.ok(s.get('attachment','orphan')); assert.equal(s.get('maintenance','storage'),undefined);
        assert.equal(a.mailIsQuiesced(),false); await a.trackMailWork(async()=>{});
        raw.exec('ROLLBACK');
        now+=30*60*1000-1; await tick(); assert.ok(s.get('attachment','orphan'));
        raw.exec("CREATE TRIGGER deny_auto_cleanup BEFORE DELETE ON records WHEN OLD.kind='attachment' BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure'); END");
        now++;await tick();assert.ok(s.get('attachment','orphan'));
        assert.equal(a.mailIsQuiesced(),false);await a.trackMailWork(async()=>{});
        raw.exec('DROP TRIGGER deny_auto_cleanup');
        now+=60*60*1000;await tick();assert.equal(s.get('attachment','orphan'),undefined);
        assert.ok(s.get('attachment','parsing:file'),'in-flight parsing retains its exact attachment');
        assert.equal(a.mailIsQuiesced(),false);
        await backend.quiesceMail(1000);
        now+=24*60*60*1000; await tick(); assert.equal(a.mailIsQuiesced(),true,'update admission remains paused');
        backend.resumeMail(); await a.trackMailWork(async()=>{});
      } finally {raw.close(); backend.resumeMail(); await new Promise(resolve=>server.close(resolve));s.closeStore();}
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test("automatic maintenance defers updates and aborts a pending drain on server shutdown", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-auto-close-"));
  try {
    run(directory, `
      import assert from 'node:assert/strict';
      let tick;const original=setInterval;let now=Date.now();Date.now=()=>now;
      globalThis.setInterval=(callback,delay,...args)=>{if(delay===300000)tick=callback;return original(callback,delay,...args)};
      const s=await import('./server/store.ts');const a=await import('./server/mail-actions.ts');
      const backend=await import('./server/index.ts');
      const {quietImapWatch,quietGmailRevision}=await import('./server/imap-watch-fixture.ts');
      const server=await backend.startServer(0,undefined,undefined,undefined,quietImapWatch,quietGmailRevision);
      s.put('attachment','orphan',{accountId:'a',content:'YQ=='});
      const settled=Promise.allSettled;let release;
      Promise.allSettled=()=>Promise.reject(new Error('synthetic drain failure'));
      now+=300000;await tick();
      assert.equal(a.mailIsQuiesced(),false);await a.trackMailWork(async()=>{});
      assert.ok(s.get('attachment','orphan'));
      Promise.allSettled=()=>new Promise(resolve=>{release=()=>resolve([])});
      const deadlines=[];const originalTimeout=setTimeout;
      globalThis.setTimeout=(callback,delay,...args)=>{deadlines.push(delay);return originalTimeout(callback,delay,...args)};
      try {
        now+=30*60*1000;const pending=tick();
        assert.ok(deadlines.includes(30000),'automatic drain has a thirty-second deadline');
        assert.equal(a.mailIsQuiesced(),true);
        await assert.rejects(backend.quiesceMail(1000),/maintenance/);
        backend.resumeMail(); assert.equal(a.mailIsQuiesced(),true);
        await new Promise(resolve=>server.close(resolve));
        release();await pending;
        assert.ok(s.get('attachment','orphan'));assert.equal(s.get('maintenance','storage'),undefined);
        assert.equal(a.mailIsQuiesced(),true,'shutdown does not restart mail admission');
        now+=24*60*60*1000;await tick();assert.ok(s.get('attachment','orphan'));
      } finally {Promise.allSettled=settled;globalThis.setTimeout=originalTimeout;release?.();s.closeStore();}
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
