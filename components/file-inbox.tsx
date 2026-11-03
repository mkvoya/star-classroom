'use client';
import { useEffect, useRef, useState } from 'react';
import { notebookArchive } from '@/lib/notebook-archive';
import type { Classroom } from '@/app/classroom';
import type { FileView } from '@/lib/file-signaling';
import { digest, gathered, listReceipts, MAX_FILE, saveReceipt, validateNotebook, type Receipt } from '@/lib/notebook-store';

type Peer = { pc: RTCPeerConnection; close: () => void };
const rtcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const message = (e: unknown) => e instanceof Error ? e.message : '传输失败，请重试。';
export function FileInbox({ room, identity }: { room: Classroom; identity: string }) {
  const teacher=room.role==='teacher';
  const [available,setAvailable]=useState<string|null>(null),[receiving,setReceiving]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [file,setFile]=useState<File|null>(null),[studentId,setStudentId]=useState(''),[receipts,setReceipts]=useState<Receipt[]>([]),[progress,setProgress]=useState<Record<string,string>>({});
  const [packing,setPacking]=useState(false),[exportStatus,setExportStatus]=useState('');
  const exporting=useRef(false);
  const session=useRef<string|null>(null), peers=useRef(new Map<string,Peer>()), handled=useRef(new Set<string>()), alive=useRef(true), lastPoll=useRef(0), members=useRef(room.members);
  members.current=room.members;
  async function api(action?: string, extra: Record<string,unknown> = {}): Promise<FileView> {
    const r=await fetch('/api/classroom'+(action?'':`?code=${room.code}&files=1`),{method:action?'POST':'GET',headers:{'Content-Type':'application/json','x-classroom-key':identity},signal:AbortSignal.timeout(10000),...(action?{body:JSON.stringify({action,code:room.code,...extra})}:{})});
    const data=await r.json() as {error?:string;files:FileView};if(!r.ok)throw new Error(data.error || '连接中断。');return data.files;
  }
  function closePeers(){for(const p of peers.current.values())p.close();peers.current.clear();}
  function stop(){const old=session.current;session.current=null;setReceiving(false);setAvailable(null);closePeers();if(old)void api('files-close',{session:old}).catch(()=>{});}
  function update(id: string,text: string){if(alive.current)setProgress(p=>({...p,[id]:text}));}
  async function start(){setError('');setBusy(true);try{
    if(!globalThis.RTCPeerConnection)throw new Error('当前浏览器不支持文件直传，请使用新版 Chrome、Edge 或 Firefox。');
    await listReceipts(room.code,identity); // Verify local storage before accepting uploads.
    const id=crypto.randomUUID();await api('files-open',{session:id});session.current=id;handled.current.clear();setReceiving(true);setAvailable(id);
  }catch(e){setError(message(e));}finally{setBusy(false);}}

  async function accept(signal: FileView['signals'][number], current: string){
    const student=members.current.find(m=>m.id===signal.memberId);
    if(!student||handled.current.has(signal.id))return;
    if(peers.current.size>=4)return; // Remaining offers wait in the signaling queue.
    handled.current.add(signal.id);
    const pc=new RTCPeerConnection(rtcConfig);let channel: RTCDataChannel|undefined, chunks: ArrayBuffer[]=[], count=0, done=false;
    let meta: {name:string;size:number;hash:string;studentId:string}|undefined;
    const label=student.name;
    const close=()=>{clearTimeout(timer);channel?.close();pc.close();chunks=[];peers.current.delete(signal.id);};
    const fail=(text:string)=>{if(done)return;done=true;update(signal.id,`${label}：${text}`);try{channel?.send(JSON.stringify({type:'error',message:text}));}catch{};close();};
    const timer=setTimeout(()=>fail('连接或传输超时，请让同学重试。'),120000);
    peers.current.set(signal.id,{pc,close});update(signal.id,`${label}：正在连接…`);
    pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed')fail('无法直连，请重试或更换网络。');};
    pc.ondatachannel=event=>{
      if(channel){event.channel.close();return;}channel=event.channel;channel.binaryType='arraybuffer';
      channel.onclose=()=>{if(!done)fail('连接中断，尚未收到完整文件。');};
      channel.onmessage=async event=>{try{
        if(done)return;
        if(session.current!==current)throw new Error('老师已停止接收。');
        if(typeof event.data==='string'){
          if(event.data.length>2048)throw new Error('文件信息过长。');
          const data=JSON.parse(event.data);
          if(data.type==='meta'&&!meta){
            if(typeof data.name!=='string'||data.name.length>200||!data.name.toLowerCase().endsWith('.ipynb')||!Number.isInteger(data.size)||data.size<1||data.size>MAX_FILE||typeof data.hash!=='string'||!/^[0-9a-f]{64}$/.test(data.hash)||typeof data.studentId!=='string'||!/^[-\w]{1,40}$/.test(data.studentId))throw new Error('文件信息无效，单份上限 20 MB。');
            meta=data;channel!.send(JSON.stringify({type:'ready'}));
          }else if(data.type==='end'&&meta){
            if(count!==meta.size)throw new Error('文件不完整，请重试。');
            // Block more messages while validating and saving this completed file.
            done=true;
            const blob=new Blob(chunks,{type:'application/x-ipynb+json'});chunks=[];
            const bytes=await blob.arrayBuffer();if(await digest(bytes)!==meta.hash)throw new Error('文件校验失败，请重试。');validateNotebook(new TextDecoder().decode(bytes));
            const receipt:Receipt={id:signal.id,room:room.code,owner:identity,student:`${meta.studentId} ${label}`,name:meta.name,size:meta.size,receivedAt:new Date().toISOString(),blob};
            await saveReceipt(receipt);
            if(alive.current)setReceipts(p=>[receipt,...p.filter(r=>r.id!==receipt.id)]);
            update(signal.id,`${label}：已保存到本浏览器`);
            channel!.send(JSON.stringify({type:'saved',id:signal.id}));
            clearTimeout(timer);setTimeout(close,1500);
          }else throw new Error('传输顺序错误。');
        }else{
          if(!meta||!(event.data instanceof ArrayBuffer)||event.data.byteLength>65536||count+event.data.byteLength>meta.size)throw new Error('文件大小异常。');
          chunks.push(event.data);count+=event.data.byteLength;update(signal.id,`${label}：接收 ${Math.floor(count/meta.size*100)}%`);
        }
      }catch(e){done=false;fail(message(e));}};
    };
    try{await pc.setRemoteDescription({type:'offer',sdp:signal.offer});await pc.setLocalDescription(await pc.createAnswer());await gathered(pc);if(session.current!==current)throw new Error('接收已关闭。');await api('files-answer',{session:current,id:signal.id,memberId:signal.memberId,sdp:pc.localDescription!.sdp});}
    catch(e){fail(message(e));}
  }

  useEffect(()=>{
    alive.current=true;let inFlight=false,canceled=false;
    if(teacher)void listReceipts(room.code,identity).then(r=>{if(!canceled)setReceipts(r);}).catch(()=>setError('无法读取本地收件记录，请允许浏览器存储。'));
    async function poll(){if(inFlight)return;inFlight=true;try{
      const mine=session.current;
      const state=await api(mine?'files-pulse':undefined,mine?{session:mine}:{});
      if(canceled)return;lastPoll.current=Date.now();setAvailable(state.session);
      if(mine&&state.session===mine){for(const signal of state.signals)void accept(signal,mine);}
      if(!teacher){for(const signal of state.signals){const peer=peers.current.get(signal.id);if(peer&&signal.answer&&!peer.pc.remoteDescription)void peer.pc.setRemoteDescription({type:'answer',sdp:signal.answer}).catch(()=>{peer.close();setBusy(false);setError('连接应答失败，请重试。');});}}
    }catch(e){if(canceled)return;if(session.current||Date.now()-lastPoll.current>10000){setAvailable(null);if(session.current){stop();setError('接收连接已中断，请重新开启接收。');}}}finally{inFlight=false;}}
    void poll();const interval=setInterval(poll,2000);
    const leave=()=>{const old=session.current;session.current=null;closePeers();if(old)void fetch('/api/classroom',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','x-classroom-key':identity},body:JSON.stringify({action:'files-close',code:room.code,session:old})}).catch(()=>{});};
    window.addEventListener('pagehide',leave);
    return()=>{canceled=true;alive.current=false;clearInterval(interval);window.removeEventListener('pagehide',leave);leave();};
    // A room/identity change tears down every connection and the teacher lease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.code,identity,teacher]);

  async function send(){
    if(!file||!available)return;setError('');setBusy(true);setStatus('检查文件…');
    const current=available,id=crypto.randomUUID();let pc:RTCPeerConnection|undefined,timer:ReturnType<typeof setTimeout>|undefined,finished=false;
    const fail=(text:string)=>{if(finished)return;finished=true;if(timer)clearTimeout(timer);pc?.close();peers.current.delete(id);if(alive.current){setBusy(false);setError(text);setStatus('未确认提交成功，请重试。');}};
    try{
      if(!/^[-\w]{1,40}$/.test(studentId.trim()))throw new Error('请填写学号（字母、数字、横线或下划线）。');
      if(!file.name.toLowerCase().endsWith('.ipynb')||file.size<1||file.size>MAX_FILE)throw new Error('请选择不超过 20 MB 的 .ipynb 文件。');
      const bytes=await file.arrayBuffer();validateNotebook(new TextDecoder().decode(bytes));const hash=await digest(bytes);
      pc=new RTCPeerConnection(rtcConfig);const channel=pc.createDataChannel('notebook',{ordered:true});channel.bufferedAmountLowThreshold=65536;
      peers.current.set(id,{pc,close:()=>fail('传输已取消。')});timer=setTimeout(()=>fail('传输超时。可能无法直连，请重试或更换网络。'),120000);
      pc.onconnectionstatechange=()=>{if(pc?.connectionState==='failed')fail('无法直连，请重试或更换网络。');};
      channel.onclose=()=>{if(!finished)fail('连接中断，未收到老师确认。');};
      channel.onopen=()=>{setStatus('已连接，等待老师接收…');channel.send(JSON.stringify({type:'meta',name:file.name,size:file.size,hash,studentId:studentId.trim()}));};
      let sending=false;
      channel.onmessage=async event=>{try{
        const data=JSON.parse(event.data);
        if(data.type==='error'){fail(data.message);return;}
        if(data.type==='saved'){if(!sending)throw new Error('确认顺序错误。');finished=true;clearTimeout(timer);setStatus(`提交成功 · 编号 ${data.id}`);setBusy(false);peers.current.delete(id);channel.close();pc?.close();return;}
        if(data.type!=='ready'||sending)return;sending=true;
        for(let offset=0;offset<bytes.byteLength;offset+=16384){
          while(channel.bufferedAmount>262144){await new Promise(resolve=>setTimeout(resolve,20));if(finished||channel.readyState!=='open')throw new Error('传输中断。');}
          if(finished||channel.readyState!=='open')throw new Error('传输中断。');
          channel.send(bytes.slice(offset,offset+16384));setStatus(`正在发送 ${Math.min(100,Math.round((offset+16384)/bytes.byteLength*100))}%`);
        }
        channel.send(JSON.stringify({type:'end'}));setStatus('已发送，等待老师保存确认…');
      }catch(e){fail(message(e));}};
      await pc.setLocalDescription(await pc.createOffer());await gathered(pc);await api('files-offer',{session:current,id,sdp:pc.localDescription!.sdp});setStatus('正在连接老师，繁忙时请稍候…');
    }catch(e){fail(message(e));}
  }
  function download(r:Receipt){const url=URL.createObjectURL(r.blob);const a=document.createElement('a');a.href=url;a.download=`${r.student}_${r.id.slice(0,8)}_${r.name}`.replace(/[\\/:*?"<>|]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  async function downloadAll(){
    if(exporting.current||!receipts.length)return;
    exporting.current=true;setPacking(true);setError('');
    const snapshot=[...receipts];setExportStatus(`正在打包 0 / ${snapshot.length} 份…`);
    try{
      const blob=await notebookArchive(snapshot,done=>{if(alive.current)setExportStatus(`正在打包 ${done} / ${snapshot.length} 份…`);});
      if(!alive.current)return;
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
      a.download=`课堂${room.code}_作业_${new Date().toISOString().replace(/[:.]/g,'-')}.zip`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      setExportStatus(`已生成 ${snapshot.length} 份作业的 ZIP，请查看浏览器下载。`);
    }catch(e){if(alive.current){setError(`批量下载失败：${message(e)}`);setExportStatus('');}}
    finally{exporting.current=false;if(alive.current)setPacking(false);}
  }
  return <section className="file-inbox" aria-labelledby="file-inbox-title"><div className="section-title"><h2 id="file-inbox-title">课堂收件箱</h2><span className="subtle">Notebook · 单份最大 20 MB</span></div>
    {teacher?<><p>开启后，同学可以把作业直接传到这个浏览器。请保持页面打开。</p><button className={receiving?'secondary':'primary'} disabled={busy} onClick={receiving?stop:start}>{receiving?'停止接收':'开始接收作业'}</button><p className="tiny-note">{receiving?'正在接收。':'当前未开放接收。'}收到的文件会保存在本浏览器，请及时下载备份；清除网站数据会删除本地副本。</p>
      <div role="status" aria-live="polite">{Object.entries(progress).map(([id,text])=><p key={id}>{text}</p>)}</div>
      <h3>本浏览器已收 {receipts.length} 份</h3><button className="secondary" disabled={!receipts.length||packing} onClick={downloadAll}>{packing?'正在打包…':'全部下载（ZIP）'}</button><p className="tiny-note">包含当前课堂本浏览器已收到的全部作业，保留重交版本；打包期间新收到的文件请下次下载。</p><p role="status" aria-live="polite">{exportStatus}</p>{receipts.length>0&&<ul className="receipt-list">{receipts.map(r=><li key={r.id}><div><strong>{r.student}</strong><span>{r.name} · {(r.size/1024).toFixed(1)} KB</span><small>{new Date(r.receivedAt).toLocaleString()} · {r.id.slice(0,8)}</small></div><button className="secondary" onClick={()=>download(r)}>下载</button></li>)}</ul>}</>:
      <form onSubmit={e=>{e.preventDefault();void send();}}><p>{available?'老师正在接收，可以发送作业。':'老师尚未开启接收，或已经离线。'}</p><label htmlFor="homework-student-id">学号</label><input id="homework-student-id" value={studentId} onChange={e=>setStudentId(e.target.value)} maxLength={40} required disabled={busy}/><label htmlFor="homework-file">作业文件</label><input id="homework-file" type="file" accept=".ipynb" disabled={!available||busy} onChange={e=>{setFile(e.target.files?.[0]||null);setStatus('');setError('');}}/><button className="primary" disabled={!available||!file||busy}>{busy?'正在传输…':'发送给老师'}</button>{busy&&<button type="button" className="secondary" onClick={closePeers}>取消传输</button>}<p role="status" aria-live="polite">{status}</p><p className="tiny-note">以“提交成功”为准。传输期间请勿关闭页面；同学之间看不到作业文件。</p></form>}
    {error&&<div className="error" role="alert">{error}</div>}
  </section>;
}
