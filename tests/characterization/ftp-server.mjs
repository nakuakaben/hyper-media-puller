import net from "node:net";
import { once } from "node:events";

// Minimal read-only localhost server. Scenarios are synthetic, not firmware emulation.
export async function ftpServer(t, options = {}) {
  const commands = [], sockets = new Set(), listeners = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    let pending = "", cwd = "/", dataSocket, passive;
    const reply = text => { if (!socket.destroyed) socket.write(`${text}\r\n`); };
    const closePassive = () => {
      dataSocket?.destroy(); dataSocket = undefined;
      if (passive) { passive.close(); listeners.delete(passive); passive = undefined; }
    };
    socket.once("close", closePassive);
    if (!options.silent) reply("220 Synthetic HMP test server");
    socket.on("data", chunk => {
      pending += chunk;
      let index;
      while ((index = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 2);
        commands.push(line);
        const [verb, ...parts] = line.split(" ");
        const argument = parts.join(" ");
        if (verb === "USER") reply("331 Password required");
        else if (verb === "PASS") reply(argument === (options.password ?? "") ? "230 Logged in" : "530 Login refused");
        else if (verb === "FEAT") reply("211-Features\r\n UTF8\r\n211 End");
        else if (["OPTS", "TYPE", "STRU", "MODE"].includes(verb)) reply("200 OK");
        else if (verb === "PWD") reply(`257 "${cwd}"`);
        else if (verb === "CWD") { cwd = argument; reply("250 Directory changed"); }
        else if (verb === "EPSV" && options.pasvOnly) reply("502 EPSV unsupported");
        else if (verb === "EPSV" || verb === "PASV") {
          closePassive();
          passive = net.createServer(data => { dataSocket = data; sockets.add(data); data.on("error", () => {}); data.once("close", () => sockets.delete(data)); });
          listeners.add(passive);
          passive.listen(0, "127.0.0.1", () => {
            const port = passive.address().port;
            reply(verb === "EPSV" ? `229 Entering Extended Passive Mode (|||${port}|)` : `227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`);
          });
        } else if (verb === "LIST") {
          if (options.legacyList && argument) { reply("501 Absolute/options listing refused"); continue; }
          reply("150 Opening data");
          dataSocket.end(options.listing ?? "");
          reply("226 Listing complete");
        } else if (verb === "RETR") {
          reply("150 Opening data");
          if (options.holdTransfer) { dataSocket.write("PA"); continue; }
          dataSocket.end(options.payload ?? "DATA");
          if (options.disconnect) setTimeout(() => socket.destroy(), 50);
          else if (options.interrupt) setTimeout(() => reply("426 Transfer interrupted"), 50);
          else reply("226 Transfer complete");
        } else if (verb === "QUIT") { reply("221 Goodbye"); socket.end(); }
        else reply("502 Unsupported test command");
      }
    });
  });
  server.on("error", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    for (const listener of listeners) listener.close();
    await new Promise(resolve => server.close(resolve));
  });
  return { port: server.address().port, commands };
}
