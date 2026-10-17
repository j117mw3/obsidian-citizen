import type { GraphData } from "../src/types";
/** One genuine selected main node per synthetic group; no vault adapter is involved. */
export function makeSkyFixture(requestedNodes=850,requestedGroups=24,requestedDegree=128):{data:GraphData;ids:string[];hubs:string[]} {
  const count=Math.max(7,Math.min(20000,Math.trunc(requestedNodes)||850)),groupCount=Math.max(1,Math.min(count-1,Math.trunc(requestedGroups)||24));
  const degree=Math.max(2,Math.min(count-groupCount,Math.trunc(requestedDegree)||128));
  const ids=Array.from({length:count},(_,i)=>`Synthetic/${i<groupCount?"Hub":"Node"}-${String(i).padStart(5,"0")}`),hubs=ids.slice(0,groupCount),links:GraphData["links"]=[],seen=new Set<string>(),counts=new Uint32Array(count);
  const connect=(a:number,b:number)=>{if(a===b)return;const key=`${Math.min(a,b)}/${Math.max(a,b)}`;if(seen.has(key))return;seen.add(key);links.push({source:ids[a],target:ids[b]});counts[a]++;counts[b]++;};
  for(let hub=0;hub<groupCount;hub++)for(let j=0;j<degree;j++)connect(hub,groupCount+(hub*37+j)%(count-groupCount));
  for(let i=groupCount;i<count;i++)connect(i,i+1<count?i+1:groupCount);
  const groupFor=(i:number)=>i<groupCount?i:(i-groupCount)%groupCount;
  const groups=Array.from({length:groupCount},(_,i)=>({key:`Group-${i}`,label:`Group ${i}`,color:["#8CECFF","#FFBD5C","#B8A2FF","#70F0A5"][i%4],count:ids.filter((_,j)=>groupFor(j)===i).length}));
  const data:GraphData={groups,nodes:ids.map((id,i)=>({id,name:i<groupCount?`Main ${i}`:`Node ${i}`,group:groups[groupFor(i)].key,deg:counts[i]})),links};
  return{data,ids,hubs};
}
