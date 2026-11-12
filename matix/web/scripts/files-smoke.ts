// File-transfer smoke test: list home, upload a file, list again, download it back, compare.
import { FileSession } from "../src/core/files";

const e = process.env;
const fs = new FileSession(e.ID!, { idServer: e.ID_SERVER!, relayServer: e.RELAY_SERVER!, key: e.KEY! }, "Matix KG file smoke");
try {
  await fs.connect(e.PASSWORD);
  const home = await fs.readDir("");
  console.log(`home: ${home.path} (${home.entries.length} entries)`);
  const dir = e.REMOTE_DIR || home.path;
  const payload = new Uint8Array(400 * 1024 + 123).map((_, i) => (i * 31) & 0xff);
  const name = `matix-kg-smoke-${Date.now()}.bin`;
  await fs.upload(dir, [new File([payload], name, { lastModified: Date.now() })], (p) => p.done === p.total && console.log(`uploaded ${p.done} bytes`));
  await new Promise((r) => setTimeout(r, 800));
  const after = await fs.readDir(dir);
  const entry = after.entries.find((x) => x.name === name);
  console.log("remote entry:", entry);
  if (!entry) throw new Error("uploaded file not listed");
  const blob = await fs.download(fs.join(dir, name), entry.size);
  const back = new Uint8Array(await blob.arrayBuffer());
  const same = back.length === payload.length && back.every((b, i) => b === payload[i]);
  console.log(`downloaded ${back.length} bytes, identical: ${same}`);
  fs.session.send({ file_action: { remove_file: { id: 1, path: fs.join(dir, name), file_num: 0 } } });
  await new Promise((r) => setTimeout(r, 500));
  fs.close();
  process.exit(same ? 0 : 5);
} catch (err) {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
}
