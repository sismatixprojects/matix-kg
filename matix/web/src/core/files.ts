// File transfer over a dedicated file-transfer session (LoginRequest.file_transfer), as the
// native client does. Protocol: RustDesk libs/base/src/fs.rs + src/server/connection.rs.
import { hbb as M } from "../proto/message.js";
import { Session, type ServerConfig } from "./session";
import { decompress } from "./zstd";

export interface RemoteEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
  hidden: boolean;
}

export interface RemoteDir {
  path: string;
  entries: RemoteEntry[];
}

export interface Progress {
  name: string;
  done: number;
  total: number;
}

const BLOCK = 128 * 1024;
const DIR_TYPES = new Set([M.FileType.Dir, M.FileType.DirLink, M.FileType.DirDrive]);

let nextJob = Math.floor(Math.random() * 100000) + 1;

interface DownloadJob {
  kind: "download";
  name: string;
  size: number;
  chunks: Uint8Array[];
  received: number;
  resolve: (blob: Blob) => void;
  reject: (e: Error) => void;
  progress?: (p: Progress) => void;
}

interface UploadJob {
  kind: "upload";
  files: File[];
  confirm: Map<number, (offset: number | "skip") => void>;
  reject: (e: Error) => void;
}

export class FileSession {
  readonly session: Session;
  private dirWaiters: { resolve: (d: RemoteDir) => void; reject: (e: Error) => void }[] = [];
  private jobs = new Map<number, DownloadJob | UploadJob>();
  /** A listing the peer sent before anyone asked (it lists the start folder after login). */
  private unsolicited: RemoteDir | undefined;
  separator = "/";

  constructor(peerId: string, server: ServerConfig, agentName: string) {
    this.session = new Session(peerId, server, { agentName, fileTransfer: { dir: "" } });
    this.session.on("fileResponse", (r) => void this.onResponse(r));
    this.session.on("fileAction", (a) => this.onAction(a));
  }

  async connect(password?: string) {
    await this.session.connect(password);
    const pi = this.session.peerInfo;
    this.separator = (pi?.platform || "").toLowerCase().startsWith("win") ? "\\" : "/";
  }

  join(dir: string, name: string): string {
    if (!dir) return name;
    return dir.endsWith(this.separator) ? dir + name : dir + this.separator + name;
  }

  parent(dir: string): string {
    const sep = this.separator;
    const trimmed = dir.endsWith(sep) && dir.length > 1 ? dir.slice(0, -1) : dir;
    const i = trimmed.lastIndexOf(sep);
    if (i < 0) return "";
    if (sep === "\\" && i === 2 && trimmed[1] === ":") return trimmed.slice(0, 3); // C:\
    if (i === 0) return sep;
    return trimmed.slice(0, i);
  }

  /** Lists a remote directory ("" means the remote user's home). */
  readDir(path: string, includeHidden = false): Promise<RemoteDir> {
    const early = this.unsolicited;
    if (early && (path === "" || path === early.path)) {
      this.unsolicited = undefined;
      return Promise.resolve(early);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (d: RemoteDir) => {
          clearTimeout(timer);
          resolve(d);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        this.dirWaiters = this.dirWaiters.filter((w) => w !== waiter);
        reject(new Error("The remote side did not list the folder"));
      }, 15000);
      this.dirWaiters.push(waiter);
      this.session.send({ file_action: { read_dir: { path, include_hidden: includeHidden } } });
    });
  }

  /** Downloads one remote file into memory and resolves with a Blob. */
  download(path: string, size: number, progress?: (p: Progress) => void): Promise<Blob> {
    const id = nextJob++;
    const name = path.split(this.separator).pop() || "download";
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { kind: "download", name, size, chunks: [], received: 0, resolve, reject, progress });
      this.session.send({ file_action: { send: { id, path, include_hidden: false, file_num: 0 } } });
    });
  }

  /** Uploads browser files into a remote directory. */
  async upload(dir: string, files: File[], progress?: (p: Progress) => void): Promise<void> {
    const id = nextJob++;
    const job: UploadJob = { kind: "upload", files, confirm: new Map(), reject: () => {} };
    const failed = new Promise<never>((_, reject) => (job.reject = reject));
    failed.catch(() => {});
    this.jobs.set(id, job);
    const total = files.reduce((n, f) => n + f.size, 0);
    this.session.send({
      file_action: {
        receive: {
          id,
          path: dir,
          file_num: 0,
          total_size: total,
          files: files.map((f) => ({ name: f.name, size: f.size, modified_time: Math.floor(f.lastModified / 1000), entry_type: M.FileType.File })),
        },
      },
    });
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const decision = Promise.race([
          new Promise<number | "skip">((resolve) => job.confirm.set(i, resolve)),
          failed,
          timeout(30000, `No answer from the remote side for ${f.name}`),
        ]);
        this.session.send({
          file_response: {
            digest: { id, file_num: i, file_size: f.size, last_modified: Math.floor(f.lastModified / 1000), is_upload: true, is_resume: false },
          },
        });
        const offset = await decision;
        if (offset === "skip") continue;
        let sent = offset * BLOCK;
        while (sent < f.size) {
          const chunk = new Uint8Array(await f.slice(sent, sent + BLOCK).arrayBuffer());
          while (this.session.buffered > 4 * 1024 * 1024) await sleep(20);
          this.session.send({ file_response: { block: { id, file_num: i, data: chunk, compressed: false } } });
          sent += chunk.length;
          progress?.({ name: f.name, done: sent, total: f.size });
        }
        // An empty block marks the end of this file, as the native sender does.
        this.session.send({ file_response: { block: { id, file_num: i, data: new Uint8Array(), compressed: false } } });
      }
      this.session.send({ file_response: { done: { id, file_num: files.length } } });
    } finally {
      this.jobs.delete(id);
    }
  }

  close() {
    this.session.close("File transfer closed");
  }

  private async onResponse(r: M.FileResponse) {
    if (r.dir) {
      const d = r.dir as M.FileDirectory;
      const dir: RemoteDir = {
        path: d.path,
        entries: (d.entries || []).map((e) => ({
          name: e.name || "",
          isDir: DIR_TYPES.has(e.entry_type ?? M.FileType.File),
          size: Number(e.size || 0),
          modified: Number(e.modified_time || 0),
          hidden: !!e.is_hidden,
        })),
      };
      const waiter = this.dirWaiters.shift();
      if (waiter) waiter.resolve(dir);
      else this.unsolicited = dir;
      return;
    }
    if (r.digest) {
      const d = r.digest as M.FileTransferDigest;
      const job = this.jobs.get(d.id);
      if (!job) return;
      if (job.kind === "download") {
        if (d.file_size) job.size = Number(d.file_size);
        this.session.send({ file_action: { send_confirm: { id: d.id, file_num: d.file_num, offset_blk: 0 } } });
      } else {
        // The remote file exists and differs: overwrite it.
        job.confirm.get(d.file_num)?.(0);
      }
      return;
    }
    if (r.block) {
      const b = r.block as M.FileTransferBlock;
      const job = this.jobs.get(b.id);
      if (!job || job.kind !== "download") return;
      if (!b.data?.length) return; // end-of-file marker
      const data = b.compressed ? await decompress(b.data) : b.data;
      if (!data) {
        job.reject(new Error("A file block could not be decompressed"));
        this.jobs.delete(b.id);
        return;
      }
      job.chunks.push(data);
      job.received += data.length;
      job.progress?.({ name: job.name, done: job.received, total: job.size });
      return;
    }
    if (r.done) {
      const done = r.done as M.FileTransferDone;
      const job = this.jobs.get(done.id);
      if (job?.kind === "download") {
        job.resolve(new Blob(job.chunks as BlobPart[]));
        this.jobs.delete(done.id);
      }
      return;
    }
    if (r.error) {
      const fe = r.error as M.FileTransferError;
      const job = this.jobs.get(fe.id);
      const err = new Error(fe.error || "File transfer failed");
      if (job) {
        job.reject(err);
        this.jobs.delete(fe.id);
      } else {
        this.dirWaiters.shift()?.reject(err);
      }
    }
  }

  private onAction(a: M.FileAction) {
    if (!a.send_confirm) return;
    const c = a.send_confirm as M.FileTransferSendConfirmRequest;
    const job = this.jobs.get(c.id);
    if (!job || job.kind !== "upload") return;
    const resolve = job.confirm.get(c.file_num);
    if (!resolve) return;
    job.confirm.delete(c.file_num);
    resolve(c.skip ? "skip" : Number(c.offset_blk || 0));
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function timeout(ms: number, msg: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}
