import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let stopped = false;
function launch() {
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.ts", import.meta.url))], {
    stdio: "inherit", env: { ...process.env, DNA_DEMO_SUPERVISED: "1" },
  });
  child.on("exit", code => {
    if (code === 72 && !stopped) { console.log("Restarting demo worker; persisted runs will recover…"); launch(); }
    else process.exitCode = code ?? 1;
  });
  const stop = () => { stopped = true; child.kill("SIGTERM"); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  child.once("exit", () => { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); });
}
launch();
