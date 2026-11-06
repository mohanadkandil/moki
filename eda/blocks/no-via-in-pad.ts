/** Conservative native routing columns for SMT lands. Wires may still reach
 * each land on its own layer. Other routing layers are reserved so every
 * through-via transition encounters a foreign obstacle even on the same net.
 * These are planning constraints, not added PCB copper or relaxed DRC. */
export function withSmtViaExclusionColumns(input:any) {
  if(!input||![2,4].includes(input.layerCount)||!Array.isArray(input.obstacles))throw Error('SMT via exclusion requires actual native two/four-layer input');
  const physical=input.layerCount===4?['top','inner1','inner2','bottom']:['top','bottom'];
  const additions:any[]=[],audit:any[]=[];
  for(const [index,o]of input.obstacles.entries()){
    const pad=o?.circuitJsonMetadata?.pcb_smtpad_id;
    if(typeof pad!=='string'||!pad)continue;
    if(!Array.isArray(o.layers)||o.layers.length!==1||!physical.includes(o.layers[0])||![o.center?.x,o.center?.y,o.width,o.height].every(Number.isFinite)||o.width<=0||o.height<=0)throw Error('Unsupported native SMT obstacle for via exclusion: '+pad);
    const layers=physical.filter(l=>!o.layers.includes(l)),obstacleId=`moki_smt_via_column_${pad}_${index}`;
    const projection={type:o.type,obstacleId,center:{...o.center},width:o.width,height:o.height,layers,connectedTo:[],...(o.shape?{shape:o.shape}:{}),...(o.ccwRotationDegrees!==undefined?{ccwRotationDegrees:o.ccwRotationDegrees}:{})};
    additions.push(projection);audit.push({padId:pad,obstacleId,sourceLayer:o.layers[0],reservedLayers:layers});
  }
  return{input:{...input,obstacles:[...input.obstacles,...additions]},audit};
}
