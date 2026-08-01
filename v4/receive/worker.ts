import wasmUrl from "../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm?url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
const ready=Promise.resolve(prepareZXingModule({overrides:{locateFile:(path:string,prefix:string)=>path.endsWith(".wasm")?wasmUrl:prefix+path},fireImmediately:true}));
self.onmessage=async(event:MessageEvent)=>{const{id,buf,w,h}=event.data;try{await ready;const image=new ImageData(new Uint8ClampedArray(buf),w,h);const results=await readBarcodes(image,{formats:["QRCode"],maxNumberOfSymbols:2,tryDenoise:true,tryDownscale:false});const decoded=results.filter(r=>r.isValid&&r.bytes.length).map(r=>r.bytes);self.postMessage({id,decoded})}catch(error){self.postMessage({id,decoded:[],error:String(error)})}};
void ready.then(()=>self.postMessage({id:-1,ready:true})).catch(error=>self.postMessage({id:-1,ready:false,error:String(error)}));
