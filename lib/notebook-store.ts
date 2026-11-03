export type Receipt = { id: string; room: string; owner: string; student: string; name: string; size: number; receivedAt: string; blob: Blob };
function open(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open('tongxue-notebooks-v1',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function saveReceipt(receipt: Receipt) {
  const db=await open();
  try { await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(receipt);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('本地保存失败'));}); }
  finally { db.close(); }
}
export async function listReceipts(room: string, owner: string): Promise<Receipt[]> {
  const db=await open();
  try { return await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').getAll();r.onsuccess=()=>resolve((r.result as Receipt[]).filter(x=>x.room===room&&x.owner===owner).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)));r.onerror=()=>reject(r.error);}); }
  finally { db.close(); }
}
export const MAX_FILE = 20 * 1024 * 1024;
export function validateNotebook(text: string) {
  let value;
  try { value=JSON.parse(text); } catch { throw new Error('文件内容不是有效的 Notebook JSON，请重新从 Kaggle 导出。'); }
  if (!value || value.nbformat !== 4 || !Array.isArray(value.cells)) throw new Error('请选择有效的 Notebook（nbformat 4）。');
}
export async function digest(data: ArrayBuffer) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');}
export async function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState==='complete') return;
  await new Promise<void>((resolve,reject)=>{
    const finish=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',finish);resolve();}};
    const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',finish);if(pc.localDescription?.sdp?.includes('a=candidate:'))resolve();else reject(new Error('建立连接超时，请重试。'));},12000);
    pc.addEventListener('icegatheringstatechange',finish);finish();
  });
}
