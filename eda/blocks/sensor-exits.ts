import type { PlanGraph } from '../../src/blocks/graph.js';
/** Apply the four verified SHT40 footprint exits to the connections owned by
 * this routing phase. Explicit phases can contain any subset of those pins. */
export function relocateSensorConnectionPoints(input:any,graph:PlanGraph) {
 if(!input||!Array.isArray(input.connections)||!Array.isArray(graph.parts))throw Error('Sensor exit planning requires native connections and actual graph');
 const next=structuredClone(input),moves:Array<{ref:string;pad:string;from:{x:number;y:number};to:{x:number;y:number}}>=[];
 for(const p of graph.parts.filter(p=>p.part.lcsc==='C2909890'))for(const pad of ['1','2','3','4']){
  const x=['1','2'].includes(pad)?-.677418:.677418,y=['1','4'].includes(pad)?.40005:-.40005,a=(p.at.rotation??0)*Math.PI/180;
  const world=(x:number,y:number)=>({x:p.at.x+x*Math.cos(a)-y*Math.sin(a),y:p.at.y+x*Math.sin(a)+y*Math.cos(a)});
  const from=world(x,y),to=world(Math.sign(x)*1.2,y);
  for(const connection of next.connections)for(const point of connection.pointsToConnect??[]){
   if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Sensor phase contains an invalid native connection point');
   if(Math.hypot(point.x-from.x,point.y-from.y)<1e-5){point.x=to.x;point.y=to.y;moves.push({ref:p.ref,pad,from,to});}
  }
 }
 return {input:next,moves};
}
