const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
async function main() {
 const replies = [], bitmaps = [], reads = [];
 const self = { postMessage: reply => replies.push(reply) };
 let unavailable = false, hold;
 class OffscreenCanvas {
  constructor(width, height) { this.width=width; this.height=height; }
  getContext() {
   if (unavailable) return null;
   return { drawImage() {}, getImageData: () => {
    const pixels = new Uint8ClampedArray(this.width*this.height*4);
    for (let y=2;y<this.height-2;y++) for (let x=0;x<this.width;x++) pixels.fill(255,(y*this.width+x)*4,(y*this.width+x+1)*4);
    return { data:pixels };
   } };
  }
 }
 load('lib/media/preview-crop.worker.ts', {}, {
  self, OffscreenCanvas, AbortController, Uint8ClampedArray,
  fetch: async (source, options) => { reads.push(options); if (hold) await hold; return { ok:true, blob:async()=>({}) }; },
  createImageBitmap: async () => { const image={ width:20,height:20,closed:false,close(){this.closed=true;} };bitmaps.push(image);return image; },
 });
 await self.onmessage({data:{id:1,source:'blob:one'}});
 assert.equal(replies[0].bounds.y,2);assert.equal(replies[0].bounds.height,16);assert.equal(bitmaps[0].closed,true);
 unavailable=true;await self.onmessage({data:{id:2,source:'blob:two'}});assert.equal(replies[1].bounds,null);
 unavailable=false;let release;hold=new Promise(resolve=>{release=resolve;});
 const cancelled=self.onmessage({data:{id:3,source:'blob:three'}});await flush();
 await self.onmessage({data:{id:3,cancel:true}});assert.equal(reads.at(-1).signal.aborted,true);
 release();await cancelled;assert.equal(replies.length,2,'Cancelled analysis must not publish stale crop bounds');assert.equal(bitmaps.at(-1).closed,true);
 console.log('PASS: worker crop bounds, unavailable canvas fallback, cancellation and bitmap release');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
