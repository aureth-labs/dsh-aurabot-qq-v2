import { test, beforeEach, afterEach } from 'node:test'
import { cleanupDir } from '../helpers/cleanup.js'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as u from '../../src/core/llm/usage/usage.ts'
let dir
const now = Date.now()
const sample = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 800, cacheWriteTokens: 100 }
const report = () => u.usageReport({ range: 'all', now: now + 10000 })
beforeEach(() => { dir=mkdtempSync(join(tmpdir(),'aurabot-usage-')); process.env.AURABOT_DATA_DIR=dir; u.initUsage() })
afterEach(() => { u.closeUsage(); delete process.env.AURABOT_DATA_DIR; cleanupDir(dir) })
test('四类 Token 不重叠相加；命中率按输入总量加权，不平均每轮百分比', () => {
 u.recordUsage({chat:'group:1', usage:sample,at:now})
 u.recordUsage({chat:'group:1',usage:{inputTokens:1000,outputTokens:20},at:now})
 const r=report().current
 assert.equal(r.totalTokens,2030);assert.equal(r.cacheHitRate,0.4);assert.equal(r.cacheWriteTokens,100)
 assert.equal(r.byChat[0].totalTokens,2030);assert(!Object.hasOwn(r,'cost'))
})
test('纯缓存用量不丢失；错误数值不会污染统计', () => {
 u.recordUsage({usage:{cacheReadTokens:80},at:now})
 u.recordUsage({usage:{cacheWriteTokens:20},at:now})
 u.recordUsage({usage:{inputTokens:-1,outputTokens:Infinity},at:now})
 assert.equal(report().current.totalTokens,100);assert.equal(report().current.runs,2)
 assert.equal(report().current.cacheHitRate,0.8)
})
test('全部对话展示，不再截断前12；后台未归属量不丢失', () => {
 for(let i=0;i<25;i++)u.recordUsage({chat:'group:'+i,usage:sample,at:now})
 u.recordUsage({module:'记忆',usage:sample,at:now})
 const r=report().current;assert.equal(r.byChat.length,25)
 assert.equal(r.byChat.reduce((n,x)=>n+x.totalTokens,0)+r.background.totalTokens,r.totalTokens)
})
test('settlement替换、重试累计、失败流用量、压缩和重复事件；重启后仍去重', () => {
 const e=(seq,type,data)=>u.recordSessionUsage('s','group:1',{seq,type,time:now+seq,data})
 e(0,'model/selection',{model:'m',provider:'p'})
 e(1,'assistant/attempt',{turn:1,step:0,stream:{chunks:[{type:'usage',usage:{inputTokens:3}},{type:'usage',usage:sample}]}})
 e(2,'assistant/message',{turn:1,step:0,usage:{inputTokens:20}})
 assert.equal(report().current.totalTokens,20);assert.equal(report().current.runs,1)
 e(3,'llm/retry-started',{turn:1,step:0})
 e(4,'assistant/message',{turn:1,step:0,usage:sample})
 e(5,'compaction/summary',{usage:{inputTokens:30},model:'c',provider:'p'})
 e(5,'compaction/summary',{usage:{inputTokens:30}})
 assert.equal(report().current.totalTokens,1060);assert.equal(report().current.runs,3)
 u.closeUsage();u.initUsage()
 e(4,'assistant/message',{turn:1,step:0,usage:sample})
 assert.equal(report().current.totalTokens,1060)
 e(6,'assistant/message',{turn:1,step:0,usage:{inputTokens:40}})
 assert.equal(report().current.totalTokens,90)
 assert.ok(report().current.byModel.some(x=>x.key==='p / m'))
})
test('旧累计数据保留总量和调用数，不把平均数当总量', () => {
 u.closeUsage()
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now)
 writeFileSync(join(dir,'usage.json'),JSON.stringify({days:{[day]:{聊天:{in:1000,out:200,hit:800,calls:10}}}}))
 u.initUsage();const r=report().current
 assert.equal(r.runs,10);assert.equal(r.totalTokens,2000);assert(!Object.hasOwn(r,'cost'))
})
test('北京时间跨天范围与90天保留；空结果不冒充零费用', () => {
 const start=Date.parse(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now)+'T00:00:00+08:00')
 u.recordUsage({usage:sample,at:start-1});u.recordUsage({usage:sample,at:start})
 u.recordUsage({usage:sample,at:now-91*86400000})
 const r=report();assert.equal(r.ranges.today.runs,1);assert.equal(r.ranges.yesterday.runs,1);assert.equal(r.ranges.all.runs,2)
 assert.equal(u.usageReport({range:'invalid'}).range,'7')
 const day = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now)
 assert.equal(u.usageReport({range:'custom',from:day,to:day}).current.runs,1)
 assert.throws(()=>u.usageReport({range:'custom',from:day,to:'2026-02-30'}),RangeError)
})

test('同一次调用的最终零值可以更正先前的正值', () => {
 const event=(seq,usage)=>({seq,time:now,type:'assistant/message',data:{turn:1,step:0,usage}})
 u.recordSessionUsage('s','private:1',event(1,sample))
 u.recordSessionUsage('s','private:1',event(2,{inputTokens:0,outputTokens:0}))
 assert.equal(report().current.totalTokens,0)
 assert.equal(report().current.runs,1)
 assert.equal(report().current.cacheHitRate,null)
})

test('记忆明细是合计的子集，不从旧的后台记录猜任务名', () => {
 u.recordUsage({module:'其他后台任务',usage:{inputTokens:100}})
 u.recordUsage({module:'记忆',usage:{inputTokens:30}})
 u.recordRetrievalUsage('生成记忆向量','embed',{prompt_tokens:20,total_tokens:20})
 for(const receipt of [null,{}, {prompt_tokens:-2}, {total_tokens:'20'}]) u.recordRetrievalUsage('生成记忆向量','embed',receipt)
 u.closeUsage(); u.initUsage(); const r=report().current
 assert.deepEqual(r.byMemoryTask.map(x=>[x.key,x.totalTokens]),[['未细分',30],['生成记忆向量',20]])
 assert.equal(r.totalTokens,150); assert.equal(r.runs,3)
})
