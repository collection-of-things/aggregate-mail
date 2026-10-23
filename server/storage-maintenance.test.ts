import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
