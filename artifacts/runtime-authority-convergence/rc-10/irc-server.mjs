// Minimal local IRC server for the RC-10 agent-driven channel acceptance.
//
// Owner policy (AGENTS.md §Human-in-the-loop policy): there is no human operator.
// This process IS the channel peer/origin. It speaks real IRC over TCP and is
// driven by the RC-10 driver, so every artifact it produces is `driven_by: agent`.
//
// It is deliberately dependency-free and records every PRIVMSG it relays into a
// JSONL log, which is how the driver observes "delivery returns to the origin".
import net from "node:net";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMainEntrypoint } from "../../../scripts/lib/entrypoint.mjs";

export async function startIrcServer({ port = 0, host = "127.0.0.1", logPath = null, onEvent = () => {} } = {}) {
const events = [];
if (logPath) mkdirSync(dirname(logPath), { recursive: true });

const serverName = "rc10.local";
const clients = new Set();
const channels = new Map();

function record(row) {
  const event = { t: new Date().toISOString(), driven_by: "agent", actor: "rc10-irc-peer", ...row };
  events.push(event);
  onEvent(event);
  const line = JSON.stringify(event);
  if (logPath) appendFileSync(logPath, `${line}\n`);
  if (process.env.IRC_SERVER_VERBOSE === "1") console.log(line);
}

function send(client, line) {
  if (client.socket.destroyed) return;
  client.socket.write(`${line}\r\n`);
}

function numeric(client, code, trailing, params = []) {
  send(client, `:${serverName} ${code} ${client.nick} ${params.join(" ")}${params.length ? " " : ""}:${trailing}`);
}

function channelMembers(name) {
  const key = name.toLowerCase();
  const set = channels.get(key) ?? new Set();
  channels.set(key, set);
  return set;
}

function broadcast(name, line, except) {
  for (const member of channelMembers(name)) {
    if (member !== except) send(member, line);
  }
}

function prefix(client) {
  return `${client.nick}!${client.user ?? "u"}@${client.host ?? "127.0.0.1"}`;
}

function namesFor(name) {
  const members = [...channelMembers(name)].filter((c) => c.registered && c.nick);
  return members.map((c) => c.nick).join(" ");
}

function registerIfReady(client) {
  if (client.registered || !client.nick || !client.user) return;
  client.registered = true;
  numeric(client, "001", `Welcome to the RC-10 local IRC server ${client.nick}`);
  numeric(client, "002", `Your host is ${serverName}, running version rc10`);
  numeric(client, "003", "This server was created for the RC-10 channel acceptance");
  numeric(client, "004", `${serverName} rc10 o o`);
  numeric(client, "375", `- ${serverName} Message of the Day -`);
  numeric(client, "372", "- RC-10 agent-driven acceptance channel (self-hosted, no third-party credential)");
  numeric(client, "376", "End of /MOTD command.");
  record({ event: "registered", nick: client.nick, user: client.user, host: client.host });
}

function handleJoin(client, rawTargets) {
  for (const raw of rawTargets.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    channelMembers(name).add(client);
    client.channels.add(name.toLowerCase());
    broadcast(name, `:${prefix(client)} JOIN :${name}`, client);
    send(client, `:${prefix(client)} JOIN :${name}`);
    numeric(client, "353", namesFor(name), ["=", name]);
    numeric(client, "366", "End of /NAMES list.", [name]);
    record({ event: "join", nick: client.nick, channel: name });
  }
}

function handlePart(client, rawTargets, reason) {
  for (const raw of rawTargets.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    channelMembers(name).delete(client);
    client.channels.delete(name.toLowerCase());
    broadcast(name, `:${prefix(client)} PART ${name}${reason ? ` :${reason}` : ""}`, client);
    send(client, `:${prefix(client)} PART ${name}${reason ? ` :${reason}` : ""}`);
    record({ event: "part", nick: client.nick, channel: name, reason: reason ?? null });
  }
}

function handlePrivmsg(client, target, text) {
  record({ event: "privmsg", from: client.nick, user: client.user, host: client.host, target, text });
  if (target.startsWith("#") || target.startsWith("&")) {
    broadcast(target, `:${prefix(client)} PRIVMSG ${target} :${text}`, client);
    return;
  }
  const targetClient = [...clients].find((c) => c.nick?.toLowerCase() === target.toLowerCase());
  if (targetClient) send(targetClient, `:${prefix(client)} PRIVMSG ${targetClient.nick} :${text}`);
}

function handleLine(client, rawLine) {
  const line = rawLine.replace(/\r$/, "");
  if (!line.trim()) return;
  const prefixMatch = /^:(\S+) /.exec(line);
  const body = prefixMatch ? line.slice(prefixMatch[0].length) : line;
  const trailingAt = body.indexOf(" :");
  const trailing = trailingAt >= 0 ? body.slice(trailingAt + 2) : null;
  const head = trailingAt >= 0 ? body.slice(0, trailingAt) : body;
  const parts = head.split(/\s+/).filter(Boolean);
  const command = (parts.shift() ?? "").toUpperCase();
  const params = parts;
  if (command === "PING") {
    send(client, `:${serverName} PONG ${serverName} :${trailing ?? params[0] ?? ""}`);
    return;
  }
  if (command === "CAP") {
    send(client, `:${serverName} CAP ${client.nick || "*"} LS :`);
    return;
  }
  if (command === "PASS") return;
  if (command === "NICK") {
    const next = (trailing ?? params[0] ?? "").trim();
    if (!next) return;
    const old = client.nick;
    client.nick = next;
    if (old && client.registered) {
      for (const name of client.channels) broadcast(name, `:${old}!${client.user}@${client.host} NICK :${next}`, client);
    }
    registerIfReady(client);
    return;
  }
  if (command === "USER") {
    client.user = params[0] ?? "u";
    client.realname = trailing ?? params.slice(3).join(" ") ?? "";
    registerIfReady(client);
    return;
  }
  if (!client.registered) return;
  if (command === "JOIN") return handleJoin(client, trailing ?? params[0] ?? "");
  if (command === "PART") return handlePart(client, params[0] ?? "", trailing ?? undefined);
  if (command === "PRIVMSG" || command === "NOTICE") {
    const target = params[0] ?? "";
    const text = trailing ?? params.slice(1).join(" ") ?? "";
    if (command === "PRIVMSG") handlePrivmsg(client, target, text);
    return;
  }
  if (command === "QUIT") {
    for (const name of [...client.channels]) broadcast(name, `:${prefix(client)} QUIT :${trailing ?? "bye"}`, client);
    record({ event: "quit", nick: client.nick, reason: trailing ?? null });
    client.socket.end();
    return;
  }
  if (command === "WHO" || command === "WHOIS") {
    const name = params[0] ?? client.nick;
    numeric(client, command === "WHO" ? "352" : "311", command === "WHO" ? `${client.user ?? "u"} ${client.host ?? "127.0.0.1"} ${serverName} ${name} H :0 ` : name, params.length ? [name] : []);
    numeric(client, command === "WHO" ? "315" : "318", "End of list.", params.length ? [name] : []);
    return;
  }
  if (command === "MODE" || command === "ISON" || command === "TOPIC") {
    if (command === "MODE") send(client, `:${serverName} 221 ${client.nick} +`);
    if (command === "TOPIC") numeric(client, "331", "No topic is set.", [params[0] ?? ""]);
    if (command === "ISON") numeric(client, "303", ":", []);
    return;
  }
}

const server = net.createServer((socket) => {
  const client = {
    socket,
    nick: null,
    user: null,
    realname: null,
    host: socket.remoteAddress?.replace(/^::ffff:/, "") ?? "127.0.0.1",
    registered: false,
    channels: new Set(),
    buffer: "",
  };
  clients.add(client);
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    client.buffer += chunk;
    let idx = client.buffer.indexOf("\n");
    while (idx !== -1) {
      const rawLine = client.buffer.slice(0, idx);
      client.buffer = client.buffer.slice(idx + 1);
      idx = client.buffer.indexOf("\n");
      try {
        handleLine(client, rawLine);
      } catch (err) {
        record({ event: "error", error: String(err?.message ?? err), rawLine });
      }
    }
  });
  const cleanup = () => {
    clients.delete(client);
    for (const name of [...client.channels]) {
      channelMembers(name).delete(client);
      broadcast(name, `:${prefix(client)} QUIT :connection closed`, client);
    }
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});
const actualPort = server.address().port;
record({ event: "listening", host, port: actualPort });
return {
  port: actualPort, events,
  close: () => new Promise((resolve, reject) => {
    for (const client of clients) client.socket.destroy();
    server.close(error => error ? reject(error) : resolve());
  }),
};
}

if (isMainEntrypoint(import.meta.url)) {
  const peer = await startIrcServer({
    port: Number(process.env.IRC_SERVER_PORT ?? 0),
    host: process.env.IRC_SERVER_HOST ?? "127.0.0.1",
    logPath: process.env.IRC_SERVER_LOG ? resolve(process.env.IRC_SERVER_LOG) : null,
  });
  console.log(JSON.stringify({ ready: true, port: peer.port }));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { void peer.close().then(() => process.exit(0)); });
  }
}
