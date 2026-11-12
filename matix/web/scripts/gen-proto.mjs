// Generates static protobuf modules from the RustDesk .proto files (no protoc needed).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repo = resolve(root, "..", "..");
const out = resolve(root, "src", "proto");
mkdirSync(out, { recursive: true });

const sources = {
  message: resolve(repo, "libs/base/protos/message.proto"),
  rendezvous: resolve(repo, "libs/hbb_common/protos/rendezvous.proto"),
};
const bin = (name) => resolve(root, "node_modules", ".bin", name);

for (const [name, file] of Object.entries(sources)) {
  const js = resolve(out, `${name}.js`);
  const dts = resolve(out, `${name}.d.ts`);
  execFileSync(bin("pbjs"), [
    "-t", "static-module", "-w", "es6", "--keep-case", "--force-number",
    "--no-verify", "--no-delimited", "--no-convert", "--no-service",
    "-r", name, "-o", js, file,
  ], { stdio: "inherit" });
  // protobufjs/minimal is CommonJS; make the import work under Vite and Node ESM.
  let code = readFileSync(js, "utf8").replace(
    /import \* as \$protobuf from "protobufjs\/minimal";/,
    'import $protobuf from "protobufjs/minimal.js";'
  );
  writeFileSync(js, code);
  execFileSync(bin("pbts"), ["-o", dts, js], { stdio: "inherit" });
  // We generate with --force-number, so int64 fields are plain numbers.
  writeFileSync(dts, readFileSync(dts, "utf8").replace('import Long = require("long");', "type Long = number;"));
}
console.log("proto: generated", Object.keys(sources).join(", "));
