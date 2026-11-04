import {useEffect,useRef,useState} from 'react'
import * as THREE from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Real engineering assembly. Presentation changes visibility and lid pose only. */
export function Assembly({phase,active}:{phase:number;active:boolean}) {
  const host=useRef<HTMLDivElement>(null)
  const pose=useRef({phase,active}); pose.current={phase,active}
  const [failed,setFailed]=useState(false)
  useEffect(()=>{
    const el=host.current!; let renderer:THREE.WebGLRenderer
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})}catch{setFailed(true);return}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace
    renderer.setClearColor(0x15191b,0);el.appendChild(renderer.domElement)
    const scene=new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff,0x626972,2.5))
    const key=new THREE.DirectionalLight(0xffffff,3.4);key.position.set(-80,150,110);scene.add(key)
    const rim=new THREE.DirectionalLight(0xc5dbff,1.5);rim.position.set(80,70,-90);scene.add(rim)
    const camera=new THREE.PerspectiveCamera(33,1,1,1000)
    camera.position.set(-148,155,-178);camera.lookAt(0,5,0)
    let object:THREE.Group|undefined;let lid:THREE.Object3D|undefined;let base:THREE.Object3D|undefined
    let raf=0;let lastPose='';let onScreen=true;let observer:ResizeObserver;let disposed=false
    const visibility=new IntersectionObserver(([entry])=>{onScreen=entry.isIntersecting;lastPose=''});visibility.observe(el)
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera)}
    observer=new ResizeObserver(resize);observer.observe(el);resize()
    new GLTFLoader().load(`${import.meta.env.BASE_URL}assets/focus-assembly.glb`,g=>{
      if(disposed)return
      object=g.scene;lid=object.getObjectByName('enclosure-lid');base=object.getObjectByName('enclosure-base')
      // Original artifact uses a transparent inspection lid; present it as opaque CAD here.
      if(lid instanceof THREE.Mesh){const m=lid.material as THREE.MeshStandardMaterial;m.transparent=false;m.opacity=1;m.depthWrite=true;m.color.set('#d7d8d4');m.needsUpdate=true}
      object.traverse(n=>{if(n.name==='BZ1'||n.name==='SW1'||n.name==='U1'||n.name==='U2')n.visible=false})
      scene.add(object);resize()
    },undefined,()=>setFailed(true))
    // CSS drives the exact lid travel, so virtual-clock film and live playback agree.
    const frame=()=>{
      if(object&&pose.current.active&&onScreen&&!document.hidden){
        const progress=Number(getComputedStyle(el).getPropertyValue('--enclosure-progress'))||0
        const close=Number(getComputedStyle(el).getPropertyValue('--lid-progress'))||0
        if(base){base.visible=progress>.001;base.position.y=-48*(1-progress)}
        if(lid){lid.visible=progress>.001;lid.position.y=28*(1-close)}
        const nextPose=`${progress.toFixed(4)}:${close.toFixed(4)}:${pose.current.phase}`
        if(nextPose!==lastPose){renderer.render(scene,camera);lastPose=nextPose}
      }
      raf=requestAnimationFrame(frame)
    };frame()
    return()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();visibility.disconnect();object?.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose())}});renderer.dispose();renderer.domElement.remove()}
  },[])
  return <div ref={host} className="ws-model" data-case={phase>=1||undefined} data-closed={phase>=2||undefined} aria-label="Generated focus timer assembly; CAD preview, not manufactured evidence">
    {failed&&<img className="ws-model-fallback" src={`${import.meta.env.BASE_URL}assets/focus-timer-assembly-${phase>=1?'closed':'populated-board'}.png`} alt="Generated focus timer CAD preview"/>}
  </div>
}
