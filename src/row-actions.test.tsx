import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MailList } from './mail/MailList';
import type { Mail } from '../shared/types';
const mail: Mail = { id:'a:1',accountId:'a',remoteId:'1',sender:'Team',address:'sender@example.com',to:'reader@example.com',subject:'Work',preview:'',body:'',date:1,unread:true,category:'important',relevance:2,reason:'',archived:false,snoozedUntil:null };
test('hover exposes row actions and removes the overlapping timestamp', () => {
 const css = readFileSync(new URL('./styles/mail-list.css', import.meta.url), 'utf8');
 assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
 assert.match(css, /\.mail-row:hover \.row-actions\s*\{\s*visibility: visible;/);
 assert.match(css, /\.mail-row:hover \.row time\s*\{\s*opacity: 0;/);
 assert.doesNotMatch(css, /\.mail-row(?::focus-within|:has\(\.row\.selected\)) \.row-actions/);
});
test('each row offers one More actions button that opens the message menu', () => {
 const html=renderToStaticMarkup(<MailList messages={[mail]} selectedId={undefined} density="comfortable" narrow={false} sort="newest" opening="double" accounts={[]} listRef={{current:null}} focusSelection={false} onOpen={()=>{}} onSelect={()=>{}} onMenu={()=>{}} onMenuKey={()=>{}} />);
 assert.ok(html.includes('class="row-more"'),'rows carry the overflow button');
 assert.ok(html.includes('aria-label="More actions"'));
 assert.ok(html.includes('aria-haspopup="menu"'));
 assert.ok(html.includes('row-actions'),'actions sit outside the message button');
});

import { act, createRef } from 'react';
import { JSDOM } from 'jsdom';

async function mountRows(messages: Mail[] = [mail, {...mail, id:'b:1', relevance:3 as const}, {...mail, id:'c:1', relevance:1 as const}],
  options: {density?: 'comfortable'|'compact'; narrow?: boolean; sizeByImportance?: boolean; selected?: string; touch?: boolean} = {}) {
 const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
 if (options.touch) Object.defineProperty(dom.window, 'matchMedia', {value: (query: string) => ({matches: query === '(hover: none)', addEventListener() {}, removeEventListener() {}})});
 const { HTMLElement } = dom.window;
 const previous = new Map<string, PropertyDescriptor | undefined>();
 for (const [key, value] of Object.entries({ window:dom.window, document:dom.window.document, HTMLElement, IS_REACT_ACT_ENVIRONMENT:true })) {
   previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
 }
 Object.defineProperties(HTMLElement.prototype,{clientHeight:{get(){return this.classList.contains('list')?400:0;}},clientWidth:{get(){return this.classList.contains('list')?220:0;}}});
 HTMLElement.prototype.scrollTo=function(options?:ScrollToOptions|number){if(typeof options==='object')this.scrollTop=options.top||0;};
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);const ref=createRef<HTMLDivElement>();
 const events:{kind:string;id:string}[]=[];
 const render=async(props:Partial<Parameters<typeof MailList>[0]>={})=>act(async()=>root.render(<div className={`list ${options.density||'comfortable'}`} ref={ref}>
   <MailList messages={messages} selectedId={options.selected} density={options.density||'comfortable'} narrow={!!options.narrow}
     sizeByImportance={options.sizeByImportance??true} sort="relevance" opening="double" accounts={[]} listRef={ref} focusSelection={false}
     onOpen={()=>events.push({kind:'open',id:''})} onSelect={(id)=>events.push({kind:'select',id})}
     onMenu={(_event,target)=>events.push({kind:'menu',id:target.id})} onMenuKey={(_event,target)=>events.push({kind:'menukey',id:target.id})}
     {...props}/></div>));
 await render();
 const rows=()=>[...document.querySelectorAll<HTMLElement>('.mail-window-row')].sort((a,b)=>parseFloat(a.style.top)-parseFloat(b.style.top));
 return {dom,ref,events,rows,render,async close(){await act(async()=>root.unmount());dom.window.close();for(const[key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}};
}

test('the More actions button opens the menu for its own mail without selecting or opening it',async()=>{
 const ui=await mountRows();try{
  const row=ui.rows()[1];
  const more=row.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;assert.ok(more);
  await act(async()=>more.click());
  assert.deepEqual(ui.events,[{kind:'menu',id:'b:1'}]);
  const key=await act(async()=>{const event=new ui.dom.window.KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true,cancelable:true});more.dispatchEvent(event);return event;});
  assert.deepEqual(ui.events,[{kind:'menu',id:'b:1'},{kind:'menukey',id:'b:1'}]);
  assert.equal(key.defaultPrevented,false,'the row keyboard path decides prevention');
 }finally{await ui.close();}
});

test('direct row actions retain target identity, disabled guards and native button activation', async () => {
 const ui = await mountRows();
 try {
  const calls: string[] = [];
  await ui.render({opening: 'single', actions: (target) => [
   {id: 'read', label: 'Mark as read', run: () => calls.push(`read:${target.id}`)},
   {id: 'reply', label: 'Reply', run: () => calls.push(`reply:${target.id}`)},
   {id: 'archive', label: 'Archive', disabled: true, run: () => calls.push('unexpected archive')},
   {id: 'trash', label: 'Move to Trash', disabled: true, description: 'Provider does not support safe Trash', run: () => calls.push('unexpected trash')},
  ]});
  const row = ui.rows()[1];
  const read = row.querySelector<HTMLButtonElement>('[aria-label="Mark as read"]')!;
  assert.equal(read.closest('.row'), null, 'direct controls are siblings of the message button');
  await act(async () => {
   read.click();
   row.querySelector<HTMLButtonElement>('[aria-label="Reply"]')!.click();
   row.querySelector<HTMLButtonElement>('[aria-label="Archive"]')!.click();
   row.querySelector<HTMLButtonElement>('[aria-label="Move to Trash"]')!.click();
  });
  assert.deepEqual(calls, ['read:b:1', 'reply:b:1']);
  assert.deepEqual(ui.events, [], 'actions do not select or open mail');
  assert.equal(row.querySelector('[aria-label="Move to Trash"]')!.getAttribute('aria-description'), 'Provider does not support safe Trash');
 } finally { await ui.close(); }
});

test('snoozed rows replace Snooze with Return to inbox and expose local pin state', async () => {
 const ui = await mountRows([{...mail, snoozedUntil: Date.now() + 60_000, pinned: true}]);
 try {
  const calls: string[] = [];
  await ui.render({actions: (target) => [
   {id: 'snooze', label: 'Snooze', run: () => calls.push('snooze')},
   {id: 'unsnooze', label: 'Return to inbox', run: () => calls.push(`unsnooze:${target.id}`)},
   {id: 'pin', label: 'Unpin email', run: () => calls.push(`pin:${target.id}`)},
  ]});
  const row = ui.rows()[0];
  assert.equal(row.querySelector('[aria-label="Snooze"]'), null);
  assert.equal(row.querySelector('[aria-label="Unpin email"]')!.getAttribute('aria-pressed'), 'true');
  await act(async () => row.querySelector<HTMLButtonElement>('[aria-label="Return to inbox"]')!.click());
  assert.deepEqual(calls, ['unsnooze:a:1']);
 } finally { await ui.close(); }
});

const layouts=(mode:{density?:'comfortable'|'compact';narrow?:boolean;sizeByImportance?:boolean})=>({...mode});
test('touch and narrow lists do not reserve a persistent action strip', async () => {
 for (const narrow of [false, true]) for (const density of ['comfortable', 'compact'] as const) {
  const ui = await mountRows([mail, {...mail, id: 'b:1'}], {touch: true, narrow, density});
  try {
   const height = density === 'compact' ? narrow ? 52 : 24 : narrow ? 100 : 34;
   assert.equal(document.querySelectorAll('.with-action-strip').length, 0);
   assert.equal(parseFloat(ui.rows()[1].style.top), height);
   assert.equal(parseFloat(document.querySelector<HTMLElement>('.mail-window')!.style.height), height * 2);
  } finally { await ui.close(); }
 }
});
test('the rendered row layout and the windowing height agree for every sizing combination',async()=>{
 for(const narrow of [false,true])for(const density of ['comfortable','compact']as const)for(const sizeByImportance of [true,false]){
  const ui=await mountRows(undefined,layouts({narrow,density,sizeByImportance}));try{
   const rows=ui.rows();
   const heights=rows.map((row,index)=>index+1<rows.length?parseFloat(ui.rows()[index+1].style.top)-parseFloat(row.style.top):0);
   const expectedClass=(relevance:number)=>density==='compact'?(narrow?'card':'inline')
     :!sizeByImportance?(narrow?'card':'inline')
     :narrow?'card':relevance===3?'stacked':relevance===2?'inline':'brief';
   const expectedHeight=(relevance:number)=>(density==='compact'?(narrow?52:24)
     :!sizeByImportance?(narrow?100:34)
     :narrow?(relevance===1?80:100):relevance===3?48:relevance===2?34:28);
   for(const[index,row]of rows.entries()){
    const button=row.querySelector<HTMLElement>('.row')!;
    const relevance=index===0?2:index===1?3:1;
    assert.ok(button.classList.contains(expectedClass(relevance)),`${JSON.stringify({narrow,density,sizeByImportance})} r${relevance} -> ${expectedClass(relevance)}`);
    assert.ok(button.classList.contains(`r${sizeByImportance?relevance:2}`),`r${relevance} keeps medium styling when uniform`);
    if(index+1<rows.length)assert.equal(heights[index],expectedHeight(relevance),`${JSON.stringify({narrow,density,sizeByImportance})} r${relevance} height`);
   }
   assert.equal(parseFloat(document.querySelector<HTMLElement>('.mail-window')!.style.height),rows.reduce((height,row,index)=>height+expectedHeight(index===0?2:index===1?3:1),0));
  }finally{await ui.close();}
 }
});
