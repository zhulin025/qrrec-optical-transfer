import QRCode from "qrcode";
import { LTDecoder, LTEncoder } from "../../shared/fountain";
import { packTransferFileV2 } from "../../shared/file-envelope-v2";
import { HEADER_LEN, fnv1a, packFrame, type FrameHeader } from "../../shared/protocol";

const fileInput=document.querySelector<HTMLInputElement>("#file")!, info=document.querySelector<HTMLElement>("#file-info")!, specs=document.querySelector<HTMLElement>("#specs")!;
const fpsEl=document.querySelector<HTMLSelectElement>("#cfg-fps")!, bytesEl=document.querySelector<HTMLSelectElement>("#cfg-bytes")!, codesEl=document.querySelector<HTMLSelectElement>("#cfg-codes")!, overheadEl=document.querySelector<HTMLSelectElement>("#cfg-overhead")!;
const canvases=[document.querySelector<HTMLCanvasElement>("#qr-a")!,document.querySelector<HTMLCanvasElement>("#qr-b")!], stageB=document.querySelector<HTMLElement>("#stage-b")!;
const cycleCard=document.querySelector<HTMLElement>("#cycle-card")!, cycleNumber=document.querySelector<HTMLElement>("#cycle-number")!, cycleClock=document.querySelector<HTMLElement>("#cycle-clock")!, cycleBar=document.querySelector<HTMLElement>("#cycle-bar")!, recordHint=document.querySelector<HTMLElement>("#record-hint")!;
let file:File|null=null, generation=0;
const fmt=(n:number)=>n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;
fileInput.onchange=()=>{file=fileInput.files?.[0]??null;info.textContent=file?`${file.name} · ${fmt(file.size)}`:"尚未选择文件";void start()};
[fpsEl,bytesEl,codesEl,overheadEl].forEach(el=>el.onchange=()=>void start());

async function start(){
  const gen=++generation;if(!file)return;specs.textContent="正在压缩并计算周期…";
  const source=new Uint8Array(await file.arrayBuffer()),packed=packTransferFileV2({name:file.name,type:file.type,bytes:source});if(gen!==generation)return;
  const frameBytes=Number(bytesEl.value),blockLen=frameBytes-HEADER_LEN,fps=Number(fpsEl.value),codes=Number(codesEl.value),sessionId=(Math.random()*65534+1)|0;
  const encoder=new LTEncoder(packed.payload,blockLen,sessionId),probe=new LTDecoder(encoder.k,blockLen,sessionId,packed.payload.length);let essentialFrames=0;
  while(!probe.isComplete&&essentialFrames<encoder.k*3){probe.addFrame(essentialFrames,encoder.encode(essentialFrames));essentialFrames++}
  const repairReserve=Math.max(24,Math.ceil(encoder.k*.15)),cycleFrames=Math.max(Math.ceil(encoder.k*Number(overheadEl.value)),essentialFrames)+repairReserve,ticks=Math.ceil(cycleFrames/codes),cycleSeconds=ticks/fps,suggested=Math.ceil(cycleSeconds+3);
  const header:FrameHeader={sessionId,seq:0,k:encoder.k,blockLen,totalLen:packed.payload.length,payloadFnv:fnv1a(packed.payload)};
  stageB.style.display=codes===2?"block":"none";cycleCard.style.display="block";recordHint.textContent=`接收端请连续录制至少 ${suggested} 秒（完整周期 ${cycleSeconds.toFixed(1)} 秒 + 3 秒边缘余量）`;
  specs.textContent=`${codes} 码 · ${fps} FPS · K=${encoder.k} · 每周期 ${cycleFrames} 帧 · 建议录像 ${suggested} 秒`;
  let modules=0,scale=1,cycle=0,tick=0,nextAt=performance.now(),cycleStarted=nextAt;
  const staging=document.createElement("canvas");
  function render(seq:number,index:number){
    const bytes=packFrame({...header,seq},encoder.encode(seq));const qr=QRCode.create([{data:bytes,mode:"byte"} as never],{errorCorrectionLevel:"L",maskPattern:(seq+cycle)%8});
    if(!modules){modules=qr.modules.size;const total=modules+8,per=(innerWidth-54)/codes,budget=Math.min(per,innerHeight*.68,900),dpr=devicePixelRatio||1;scale=Math.max(1,Math.floor(budget*dpr/total));staging.width=total;staging.height=total;canvases.forEach(c=>{c.width=total*scale;c.height=total*scale;c.style.width=`${total*scale/dpr}px`;c.style.height=`${total*scale/dpr}px`})}
    const total=modules+8,image=new ImageData(total,total),pixels=new Uint32Array(image.data.buffer);pixels.fill(0xffffffff);for(let y=0;y<modules;y++)for(let x=0;x<modules;x++)if(qr.modules.data[y*modules+x])pixels[(y+4)*total+x+4]=0xff000000;
    staging.getContext("2d")!.putImageData(image,0,0);const ctx=canvases[index]!.getContext("2d")!;ctx.imageSmoothingEnabled=false;ctx.drawImage(staging,0,0,canvases[index]!.width,canvases[index]!.height);
  }
  function loop(now:number){if(gen!==generation)return;requestAnimationFrame(loop);if(now<nextAt)return;for(let lane=0;lane<codes;lane++){const position=tick*codes+lane;if(position<cycleFrames){const offset=(cycle*7919)%cycleFrames;render((position+offset)%cycleFrames,lane)}}tick++;if(tick>=ticks){tick=0;cycle++;cycleStarted=now;cycleNumber.textContent=String(cycle+1)}const elapsed=(now-cycleStarted)/1000;cycleClock.textContent=`${Math.min(cycleSeconds,elapsed).toFixed(1)} / ${cycleSeconds.toFixed(1)} 秒`;cycleBar.style.width=`${Math.min(100,elapsed/cycleSeconds*100)}%`;nextAt+=1000/fps;if(now-nextAt>300)nextAt=now+1000/fps}
  requestAnimationFrame(loop);
}
