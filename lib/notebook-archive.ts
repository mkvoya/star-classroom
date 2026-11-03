import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import type { Receipt } from './notebook-store';

const safe = (value: string, length: number) => value.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, length) || '未命名';

/** Snapshot receipts before invoking; newly received submissions belong to the next export. */
export async function notebookArchive(receipts: readonly Receipt[], onProgress: (done: number) => void = () => {}): Promise<Blob> {
  if (!receipts.length) throw new Error('还没有收到作业。');
  if (receipts.length > 65000 || receipts.reduce((sum, r) => sum + r.blob.size, 0) > 2 * 1024 ** 3) {
    throw new Error('作业总量过大，请使用单份下载。');
  }
  const parts: Blob[] = [];
  let failure: Error | null = null;
  let finished = false;
  const zip = new Zip((error, data, final) => {
    if (error) { failure = error; return; }
    parts.push(new Blob([new Uint8Array(data)]));
    finished = final;
  });
  const manifest: { submissionId: string; student: string; originalName: string; receivedAt: string; path: string; bytes: number }[] = [];
  try {
    for (const [index, receipt] of receipts.entries()) {
      const name = safe(receipt.name.replace(/\.ipynb$/i, ''), 40) + '.ipynb';
      // Index guarantees uniqueness even for duplicate student names and resubmissions.
      const path = `${safe(receipt.student, 40)}/${String(index + 1).padStart(4, '0')}_${safe(receipt.id, 40)}_${name}`;
      const entry = new ZipPassThrough(path);
      const date = new Date(receipt.receivedAt);
      if (Number.isFinite(date.getTime()) && date.getFullYear() >= 1980 && date.getFullYear() <= 2099) entry.mtime = date;
      zip.add(entry);
      for (let offset = 0; offset < receipt.blob.size; offset += 1024 * 1024) {
        const end = Math.min(offset + 1024 * 1024, receipt.blob.size);
        entry.push(new Uint8Array(await receipt.blob.slice(offset, end).arrayBuffer()), end === receipt.blob.size);
        if (failure) throw failure;
      }
      if (!receipt.blob.size) entry.push(new Uint8Array(), true);
      manifest.push({ submissionId: receipt.id, student: receipt.student, originalName: receipt.name, receivedAt: receipt.receivedAt, path, bytes: receipt.blob.size });
      onProgress(index + 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const index = new ZipPassThrough('提交清单.json');
    zip.add(index);
    index.push(strToU8(JSON.stringify(manifest, null, 2)), true);
    zip.end();
    if (failure) throw failure;
    if (!finished) throw new Error('打包未完成，请重试。');
    return new Blob(parts, { type: 'application/zip' });
  } catch (error) { zip.terminate(); throw error; }
}
