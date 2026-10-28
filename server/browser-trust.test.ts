import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { request } from "node:http";
import express from "express";
import { browserAccess } from "./browser-access.js";
import { phonePasskeys } from "./phone-passkeys.js";
import type { PhoneCredential } from "../shared/phone-access.js";

const origin = "https://mail.synthetic-tailnet.ts.net:8444";
test("paired browser trust survives idle, restart and route recovery until explicit lock or device removal", async () => {
  let now = 1000;
  const credentials = new Map<string, PhoneCredential>([["paired", {id:"paired",name:"Browser",createdAt:now,origin,publicKey:"synthetic",counter:0,userId:"synthetic"}]]);
  const start = async () => {
    const gate = browserAccess("synthetic-recovery-passphrase", "http://127.0.0.1:3002", () => now);
    gate.setTailnetOrigin(origin, now + 60_000);
    const app = express();
    phonePasskeys({gate,list:()=>[...credentials.values()].map(x=>structuredClone(x)),save:c=>{credentials.set(c.id,c);},remove:id=>{credentials.delete(id);}});
    gate.authRouter.post("/auth/synthetic-verified", (req,res)=>{gate.issueSession(req,res,"paired");res.sendStatus(200);});
    app.use(gate); app.get("/api/synthetic", (_req,res)=>res.json({ok:true}));
    const server = app.listen(0,"127.0.0.1");await once(server,"listening");
    const addr=server.address();assert.ok(addr&&typeof addr!=="string");
    const call=(path:string,method="GET",cookie="",host=new URL(origin).host)=>new Promise<{status:number;cookie?:string;body:string}>((resolve,reject)=>{
      const req=request({hostname:"127.0.0.1",port:addr.port,path,method,headers:{Host:host,Origin:origin,Cookie:cookie}},res=>{let body="";res.on("data",c=>body+=c);res.on("end",()=>resolve({status:res.statusCode!,cookie:res.headers["set-cookie"]?.[0],body}));});req.on("error",reject);req.end();
    });
    return {gate,call,close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
  };
  let host=await start();
  try {
    const admitted=await host.call("/auth/synthetic-verified","POST");
    const cookie=admitted.cookie!.split(";")[0];
    assert.match(admitted.cookie!,/Max-Age=34560000/);
    assert.match(admitted.cookie!,/HttpOnly/);assert.match(admitted.cookie!,/Secure/);
    now+=9*60*60_000;host.gate.setTailnetOrigin(origin,now+60_000);
    assert.equal((await host.call("/api/synthetic","GET",cookie)).status,200);
    await host.close();host=await start();
    assert.equal((await host.call("/api/synthetic","GET",cookie)).status,200,"restart retains browser trust");
    host.gate.setTailnetOrigin(undefined);
    assert.equal((await host.call("/api/synthetic","GET",cookie)).status,403,"route proof still required");
    host.gate.setTailnetOrigin(origin,now+60_000);
    assert.equal((await host.call("/api/synthetic","GET",cookie)).status,200,"route recovery does not force unlock");
    assert.equal((await host.call("/auth/lock","POST",cookie)).status,303);
    assert.equal((await host.call("/api/synthetic","GET",cookie)).status,401,"explicit lock revokes persisted trust");
    const again=await host.call("/auth/synthetic-verified","POST");const next=again.cookie!.split(";")[0];
    credentials.delete("paired");
    assert.equal((await host.call("/api/synthetic","GET",next)).status,401,"removing credential revokes trust");
  } finally {await host.close();}
});
