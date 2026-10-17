import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Isolated headless browser: no existing user browser or Obsidian profile is accessed.
const version=JSON.parse(await readFile('manifest.json','utf8')).version;
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('='))),groups=(args.groups??'8,24,64').split(',').map(Number),output=args.output??`dist/sky-performance-${version}.json`;
const server=createServer(async(req,res)=>{if(req.url?.split('?')[0]!=='/preview'){res.writeHead(404).end();return;}try{res.writeHead(200,{'Content-Type':'text/html'});res.end(await readFile('dev/surface-preview.html'));}catch{res.writeHead(500).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const profile=await mkdtemp(join(tmpdir(),'citizen-sky-headless-'));
const browser=spawn(args.browser??'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1280,900','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let socket;const results=[],errors=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('Headless DevTools endpoint unavailable')),20000);browser.stderr.on('data',data=>{buffer+=data;const match=buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.on('error',reject);});
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(JSON.stringify(message.error))):item.resolve(message.result);}}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text+': '+(message.params.exceptionDetails.exception?.description??''));});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP ${method} timed out`));},90000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}));});
 const evaluate=async(sessionId,expression)=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 for(const count of groups){
  const {targetId}=await send('Target.createTarget',{url:`http://127.0.0.1:${port}/preview`}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});await send('Runtime.enable',{},sessionId);await send('Target.activateTarget',{targetId});await send('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
  let ready=false;for(let attempt=0;attempt<60&&!ready;attempt++){await new Promise(resolve=>setTimeout(resolve,500));ready=await evaluate(sessionId,'Boolean(window.citizenSkyFixture?.ready())');}if(!ready)throw new Error(`Preview did not initialize (${count} planets): ${errors.join('; ')}`);
  if(args.width&&args.height)await send('Emulation.setDeviceMetricsOverride',{width:Number(args.width),height:Number(args.height)+205,deviceScaleFactor:1,mobile:false},sessionId);
  await evaluate(sessionId,`citizenSkyFixture.configure(${count});citizenSkyFixture.motion(${args.motion==='true'});true`);await new Promise(resolve=>setTimeout(resolve,1000));
  await evaluate(sessionId,'citizenSkyFixture.enter();true');await new Promise(resolve=>setTimeout(resolve,1000));if(!await evaluate(sessionId,'citizenSkyFixture.active()'))throw new Error(`Docking fixture rejected (${count} planets)`);
  const cases=args.scenarios?args.scenarios.split(',').map(scenario=>[scenario.startsWith('sky')?'sky':scenario,scenario,args.legacy==='true']):args.views?args.views.split(',').map(view=>[view,view,args.legacy==='true']):args.smoke==='true'?[['sky','sky',args.legacy==='true']]:[['floor','floor',false],['horizon','horizon',false],['sky','sky',false],...count===24?[['sky','sky',true],['sky','sky-bloom',false],['sky','sky-no-bloom',false],['sky','sky-no-labels',false],['sky','sky-no-graph',false],['sky','sky-no-distant-details',false]]:[]];
  // Request a compositor frame before sampling; fresh headless targets can otherwise retain startup throttling.
  await send('Page.captureScreenshot',{format:'png'},sessionId);
  let inputSmoke=null;
  if(args.input==='right-look'){
   await evaluate(sessionId,"citizenSkyFixture.view('sky');true");
   const point=await evaluate(sessionId,"(()=>{const r=document.querySelector('#app canvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
   await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point},sessionId);
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point},sessionId);
   await new Promise(resolve=>setTimeout(resolve,300));
   const locked=await evaluate(sessionId,"document.pointerLockElement===document.querySelector('#app canvas')");
   if(!locked)throw new Error('Right-look smoke requires actual pointer lock');
   const before=await evaluate(sessionId,'citizenSkyFixture.diagnostics()');
   await evaluate(sessionId,"window.inputSmokeEvents=[];for(const type of ['pointerdown','pointerup','pointerleave','pointerlockchange'])document.addEventListener(type,e=>inputSmokeEvents.push({type:e.type,button:e.button,target:e.target.tagName,locked:!!document.pointerLockElement}),true);true");
   await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',buttons:2,clickCount:1,...point},sessionId);
   const pressed=await evaluate(sessionId,'citizenSkyFixture.diagnostics()');
   for(let i=0;i<16;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',buttons:2,x:point.x+i*2,y:point.y-i*2},sessionId);await new Promise(resolve=>setTimeout(resolve,100));}
   const held=await evaluate(sessionId,'citizenSkyFixture.diagnostics()');
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',buttons:0,clickCount:1,x:point.x+30,y:point.y-30},sessionId);
   await new Promise(resolve=>setTimeout(resolve,500));
   const released=await evaluate(sessionId,'citizenSkyFixture.diagnostics()');
   inputSmoke={pointerLocked:locked,before,pressed,held,released,events:await evaluate(sessionId,'inputSmokeEvents')};
   if(held.frameNo<=before.frameNo||released.frameNo<=held.frameNo||released.contextLost)throw new Error('Right-look input stopped rendering: '+JSON.stringify(inputSmoke));
   if(before.orbitEnabled||held.orbitEnabled||released.orbitEnabled||!held.charging||released.charging||released.fireSequence!==before.fireSequence+1)throw new Error('Game input ownership or charged release failed: '+JSON.stringify(inputSmoke));
   console.log('Right-look smoke: '+JSON.stringify(inputSmoke));
  }
  for(const [view,scenario,legacy]of cases){await send('Page.bringToFront',{},sessionId);await evaluate(sessionId,`citizenSkyFixture.lod(false);citizenSkyFixture.legacyOcclusion(${legacy});citizenSkyFixture.view('${view}');true`);await new Promise(resolve=>setTimeout(resolve,300));
   const reportPromise=evaluate(sessionId,`citizenSkyFixture.capture('${scenario}')`);
   let shot=null;if(!legacy&&(scenario===view||scenario==='sky-no-distant-details')){await new Promise(resolve=>setTimeout(resolve,3000));shot=await send('Page.captureScreenshot',{format:'png'},sessionId);}
   const report=await reportPromise;if(report.sampledFrames===0)throw new Error('No visible rendered frames: '+JSON.stringify(await evaluate(sessionId,'citizenSkyFixture.diagnostics()')));results.push({planets:count,view,legacyOcclusion:legacy,...inputSmoke?{inputSmoke}:{},report});await mkdir('dist',{recursive:true});await writeFile(output,JSON.stringify({environment:`Isolated headless Edge WebGL; synthetic data, stationary protected player and graph motion ${args.motion==='true'?'on':'off'}; not native Obsidian acceptance.`,results,errors},null,2)+'\n');
   if(shot)await writeFile(`dist/sky-${count}-${scenario}${args.width?'-'+args.width+'x'+args.height:''}-${version}.png`,Buffer.from(shot.data,'base64'));
   console.log(JSON.stringify({planets:count,view,scenario,legacy,frames:report.sampledFrames,raf:report.frameMs.rafDelta,labels:report.subsystems.labelsMs,render:report.subsystems.renderMs,worldCalls:report.render.worldCalls,visible:report.render.visiblePlanets,gpu:report.render.gpuMs}));
  }
  await send('Target.closeTarget',{targetId});
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(`Wrote ${output}`);await send('Browser.close');
}finally{socket?.close();browser.kill();await new Promise(resolve=>server.close(resolve));}
