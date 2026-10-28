import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('busy attachment admission fails before submission and releases scheduled holds', async () => {
  const dir=mkdtempSync(path.join(tmpdir(), 'emc2-attachment-admission-'));
  process.env.MAIL_DATA_DIR=dir;
  process.env.MAIL_CONFIG_PATH=dir+'/absent.env';
  process.env.MAIL_DATA_KEY=Buffer.alloc(32,67).toString('base64');
  const load = (name: string) => import('./' + name + '.js');
  const store=await load('store');
  const {storeAttachmentBytes,attachmentWork}=await load('attachment-bytes');
  const {createDraft}=await load('drafts');
  const {Outbox}=await load('outbox');
  const {google}=await load('google-api');
  let providerCalls=0;
  const original=google.auth.OAuth2.prototype.request;
  google.auth.OAuth2.prototype.request=async()=>{providerCalls++;throw Error('Provider operation forbidden');};
  let release!: () => void;
  try {
   store.put('account','synthetic',{id:'synthetic',provider:'gmail',email:'sender@example.test',credentials:{}});
   const file=await storeAttachmentBytes('synthetic','synthetic.txt','text/plain',(async function*(){yield Buffer.from('synthetic');})(),new AbortController().signal);
   const content={to:['recipient@example.test'],subject:'Synthetic',body:'Synthetic',attachments:[file]};
   const draft=createDraft('synthetic',content);
   const box=new Outbox();
   const entry=box.enqueue({sourceDraftId:draft.id,sourceRevision:draft.revision,payload:{accountId:'synthetic',...content},scheduleAt:Date.now()+60000});
   const busy=attachmentWork(()=>new Promise<void>(resolve=>{release=resolve;}));
   try {await box.submit(entry.id);} finally {release();await busy;}
   const observed={state:store.get('outbox',entry.id).state,providerCalls,holds:store.all('attachmentHold').length};
   assert.equal(observed.providerCalls,0);
   assert.equal(observed.state,'failed');
   assert.equal(observed.holds,0);
   box.discard(entry.id,true);
   store.cleanupUploads(Date.now()+7200000);
   assert.equal(store.get('upload',file.id),undefined,'discarded failed entry releases unused bytes');
  } finally {
   google.auth.OAuth2.prototype.request=original;
   store.closeStore();rmSync(dir,{recursive:true,force:true});
  }

});
