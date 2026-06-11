// Static file server + WebSocket signaling relay.
// The server never touches media — it only forwards SDP/ICE messages
// between the two peers in a room.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // "/" → redirect into a fresh room
  if (url.pathname === "/") {
    const room = randomBytes(4).toString("hex");
    res.writeHead(302, { Location: `/room/${room}` });
    res.end();
    return;
  }

  // Any /room/* path serves the app; the client reads the room id from the URL
  const filePath = url.pathname.startsWith("/room/")
    ? join(PUBLIC_DIR, "index.html")
    : join(PUBLIC_DIR, url.pathname);

  // Keep file access inside public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

// --- signaling ---
// rooms: roomId -> Set of sockets (max 2)
const rooms = new Map();

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let room = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join") {
      const peers = rooms.get(msg.room) || new Set();
      if (peers.size >= 2) {
        ws.send(JSON.stringify({ type: "room-full" }));
        return;
      }
      room = msg.room;
      peers.add(ws);
      rooms.set(room, peers);
      // Newcomer initiates the offer iff someone is already waiting
      ws.send(JSON.stringify({ type: "joined", initiator: peers.size === 2 }));
      for (const peer of peers) {
        if (peer !== ws) peer.send(JSON.stringify({ type: "peer-joined" }));
      }
      return;
    }

    // Relay offer/answer/candidate to the other peer in the room
    if (room && rooms.has(room)) {
      for (const peer of rooms.get(room)) {
        if (peer !== ws && peer.readyState === peer.OPEN) {
          peer.send(JSON.stringify(msg));
        }
      }
    }
  });

  ws.on("close", () => {
    if (room && rooms.has(room)) {
      const peers = rooms.get(room);
      peers.delete(ws);
      for (const peer of peers) {
        peer.send(JSON.stringify({ type: "peer-left" }));
      }
      if (peers.size === 0) rooms.delete(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
