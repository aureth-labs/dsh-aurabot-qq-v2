import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSongClip, selectedWindow, SongClipError, clipCacheParts, clipFade } from '../../packages/modules/song/audio/segment.ts'
import { parseSingRequest } from '../../packages/modules/song/audio/command.ts'
let module, normalize, root
before(async () => {
  process.env.AURABOT_DATA_DIR = mkdtempSync(join(tmpdir(), 'song-segment-'))
  root = mkdtempSync(join(tmpdir(), 'song-root-'))
  module = await import('../../packages/modules/song/index.ts')
  ;({ normalize } = await import('../../src/core/config/index.ts'))
})
test('片段不改旧默认；时长单独填写从头，开始单独填写用上限', () => {
  assert.deepEqual(validateSongClip({}, 120), { ok: true, clip: null })
  assert.deepEqual(validateSongClip({durationSec:30},120).clip,{startSec:0,durationSec:30})
  assert.deepEqual(validateSongClip({startSec:60},120).clip,{startSec:60,durationSec:120})
  for(const o of [{startSec:-1},{startSec:86401},{startSec:1.5},{startSec:null},{startSec:'60'}, {durationSec:0},{durationSec:121},{durationSec:NaN},{durationSec:Infinity},{durationSec:'30'}]) assert.equal(validateSongClip(o,120).ok,false,JSON.stringify(o))
})
test('歌尾截短；越界或读不到时长不能退回整首', () => {
  assert.deepEqual(selectedWindow(74,{startSec:60,durationSec:30}),{start:60,length:14})
  for(const dur of [0,NaN,Infinity,60])assert.throws(()=>selectedWindow(dur,{startSec:60,durationSec:30}),SongClipError)
})
test('不同片段缓存分开；旧缓存不变；短片段淡入淡出不覆盖全段',()=>{
  const c={maxVoiceSec:120,clipStart:'auto'}
  assert.deepEqual(clipCacheParts(null,c),[120,'auto'])
  assert.notDeepEqual(clipCacheParts({startSec:0,durationSec:30},c),clipCacheParts({startSec:60,durationSec:30},c))
  assert.notDeepEqual(clipCacheParts({startSec:0,durationSec:30},c),clipCacheParts({startSec:0,durationSec:60},c))
  assert.equal(clipFade(1),'afade=t=in:d=0.25,afade=t=out:st=0.75:d=0.25')
  assert.equal(clipFade(120),'afade=t=in:d=1.5,afade=t=out:st=117:d=3')
})
test('/sing 兼容旧语法，支持参数顺序，拒绝重复或误放而不制作',async()=>{
  assert.deepEqual(parseSingRequest('红日 李克勤 +12'),{song:'红日 李克勤',pitch:12})
  for(const s of ['红日 李克勤 +12 开始=60 时长=30','红日 李克勤 时长=30 开始=60 +12'])assert.deepEqual(parseSingRequest(s),{song:'红日 李克勤',pitch:12,startSec:60,durationSec:30})
  for(const arg of ['红日 开始=1 开始=2','红日 时长=abc','红日 开始=-1','开始=60 红日','红日 +12 +3 时长=30']) assert.ok(parseSingRequest(arg).error)
})
test('制作队列固定账号和权限；面板、指令与工具共用片段参数',async()=>{
  const cfg = normalize({enabled:true,owners:[{platform:'sandbox',userId:'owner'}],song:{enabled:true,ownerOnly:true,root}})
  const target = {platform:'sandbox',botId:'sandbox',type:'private',id:'owner'}
  const bot = {id:'sandbox',platform:'sandbox',status:'online',selfId:'A',supports:()=>true}
  const routes = new Map(), requests = [], sent = [], disposal = []
  const file = join(root,'fixture.mp3')
  writeFileSync(file, Buffer.from([0xff,0xfb,0x90,0x64]))
  let tool, command, advance, owner = true
  const renderer = { async render(input) { requests.push(input); await new Promise(r => { advance = r }); return {file} } }
  const ctx = {
    root:{config:cfg}, dataDir:()=>root, logger:{info(){},warn(){}}, effect:f=>disposal.push(f),
    get:id=>id==='song-renderer'?renderer:null, provide(){},emit(){},http:{body:async b=>b},
    tool:f=>{tool=f},defineTool:x=>x, command:()=>({alias:()=>({action:f=>{command=f}})}),
    isOwner:id=>owner && (id==='owner'||id?.userId==='owner'),bots:{get:()=>bot,list:()=>[bot]},
    server:{get(){},post:(p,f)=>routes.set(p,f)}, h:{voice:url=>({type:'voice',url})},
    text:{sent:v=>v===true},sendTo:async(t,m)=>{sent.push([t,m]);return true}
  }
  const studio=module.apply(ctx)
  async function finish(){ advance(); for(let i=0;i<100 && studio.status().current;i++) await new Promise(r=>setTimeout(r,5)); assert.equal(studio.status().current,null) }
  const spec=tool({target,chat:{userId:'owner'}})
  assert.equal(spec.properties.start_sec.type,'integer')
  assert((await spec.execute({song:'红日',start_sec:60,duration_sec:30})).ok)
  assert.deepEqual(requests[0].clip,{startSec:60,durationSec:30})
  bot.selfId='B'; await finish(); assert.equal(sent.length,0)
  assert((await routes.get('/song/request')({song:'红日',startSec:12,durationSec:7})).ok)
  assert.deepEqual(requests[1].clip,{startSec:12,durationSec:7}); await finish(); assert.deepEqual(sent[0][0],target)
  await command({session:{target,userId:'owner',send(){}},args:'晴天 +2 开始=1 时长=4'})
  assert.equal(requests[2].pitch,2); owner=false; await finish(); assert.equal(sent.length,1)
  assert.equal((await spec.execute({song:'红日'})).ok,false)
  assert.equal((await routes.get('/song/request')({song:'测试',target:{...target,id:'other'}})).ok,false)
  for(const off of disposal)off()
})
test('错误参数在探测和排队前拒绝',async()=>{
  const {createSongStudio}=await import('../../packages/modules/song/studio/index.ts')
  const s=createSongStudio({getConfig:()=>normalize({song:{enabled:true,root}}),log:{warn(){},info(){}}})
  assert.match(s.request({song:'红日',durationSec:121}).message,/最多唱/)
  assert.equal(s.status().current,null);assert.deepEqual(s.status().queue,[])
})
test('失败口语不得带 Windows / WSL 路径或堆栈',()=>{
  for(const line of ['文件 C:\\Users\\Admin\\voice.pth 不存在','读不到 /home/user/voice.pth','读不到/home/user/voice.pth','读不到 \\\\host\\share\\voice.pth','Error: bad','Traceback (most recent call last)'])assert.equal(module.cleanFailLine(line),'',line)
  assert.equal(module.cleanFailLine('这次没唱成，稍后再试吧。'),'这次没唱成，稍后再试吧。')
})
