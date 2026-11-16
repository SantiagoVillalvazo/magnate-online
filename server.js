// MAGNATE – servidor de salas.
// Sirve el juego (public/index.html) y reenvía mensajes entre el anfitrión y los demás jugadores.
// La partida corre en el navegador del anfitrión; este servidor solo maneja salas y retransmite.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_SEATS = 6;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = path.join(DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { // cualquier ruta desconocida devuelve el juego (para enlaces tipo /?sala=ABCD)
      return fs.readFile(path.join(DIR, 'index.html'), (e2, d2) => { res.writeHead(e2 ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d2 || 'No encontrado'); });
    }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> room

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin letras confusas (I, O, 0, 1)
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join(''); } while (rooms.has(c));
  return c;
}
const clean = (s, n = 14) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n) || 'Jugador';
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function lobbyOf(room) {
  return {
    code: room.code, started: room.started, cfg: room.cfg,
    players: room.members.map((m, seat) => ({ seat, name: m.name, avatar: m.avatar, host: m === room.host, online: m.online })),
  };
}
function broadcastLobby(room) { const l = lobbyOf(room); room.members.forEach((m, i) => send(m.ws, { t: 'lobby', lobby: l, you: i })); }

wss.on('connection', (ws) => {
  let me = null, room = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.t) {
      case 'create': {
        if (room) return;
        const code = newCode();
        me = { ws, name: clean(msg.name), avatar: msg.avatar | 0, online: true };
        room = { code, host: me, members: [me], started: false, cfg: { seats: 4, difficulty: 'medium', speed: 'medium', ...(msg.cfg || {}) } };
        rooms.set(code, room);
        send(ws, { t: 'joined', code, seat: 0, host: true });
        broadcastLobby(room);
        break;
      }
      case 'join': {
        if (room) return;
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) return send(ws, { t: 'error', msg: 'No existe una sala con ese código.' });
        if (r.started) return send(ws, { t: 'error', msg: 'Esa partida ya empezó.' });
        if (r.members.length >= Math.min(MAX_SEATS, r.cfg.seats)) return send(ws, { t: 'error', msg: 'La sala está llena.' });
        room = r; me = { ws, name: clean(msg.name), avatar: msg.avatar | 0, online: true };
        room.members.push(me);
        send(ws, { t: 'joined', code: room.code, seat: room.members.indexOf(me), host: false });
        broadcastLobby(room);
        break;
      }
      case 'me': { // cambiar nombre o avatar en el lobby
        if (!room || room.started) return;
        if (msg.name != null) me.name = clean(msg.name);
        if (msg.avatar != null) me.avatar = msg.avatar | 0;
        broadcastLobby(room);
        break;
      }
      case 'cfg': {
        if (!room || me !== room.host || room.started) return;
        const c = msg.cfg || {};
        room.cfg = {
          seats: Math.max(room.members.length, Math.min(MAX_SEATS, Math.max(2, c.seats | 0 || room.cfg.seats))),
          difficulty: ['easy', 'medium', 'hard'].includes(c.difficulty) ? c.difficulty : room.cfg.difficulty,
          speed: ['slow', 'medium', 'fast'].includes(c.speed) ? c.speed : room.cfg.speed,
        };
        broadcastLobby(room);
        break;
      }
      case 'start': {
        if (!room || me !== room.host || room.started) return;
        room.started = true;
        const l = lobbyOf(room);
        room.members.forEach((m, seat) => send(m.ws, { t: 'start', lobby: l, seat }));
        break;
      }
      case 'game': { // anfitrión -> todos o un asiento
        if (!room || me !== room.host) return;
        if (msg.to === 'all') room.members.forEach((m) => m !== me && send(m.ws, { t: 'game', m: msg.m }));
        else send(room.members[msg.to]?.ws, { t: 'game', m: msg.m });
        break;
      }
      case 'answer': { // jugador -> anfitrión
        if (!room) return;
        send(room.host.ws, { t: 'answer', from: room.members.indexOf(me), m: msg.m });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    const seat = room.members.indexOf(me);
    if (me === room.host) { // si el anfitrión se va, la sala se cierra
      room.members.forEach((m) => m !== me && send(m.ws, { t: 'closed' }));
      rooms.delete(room.code);
      return;
    }
    if (!room.started) { room.members.splice(seat, 1); broadcastLobby(room); return; }
    me.online = false;
    send(room.host.ws, { t: 'left', seat });
    room.members.forEach((m) => m !== me && send(m.ws, { t: 'lobby', lobby: lobbyOf(room) }));
    if (room.members.every((m) => !m.online || m === room.host) && !room.host.online) rooms.delete(room.code);
  });
});

// mantiene vivas las conexiones (algunos servicios cortan conexiones inactivas)
setInterval(() => wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 25000);

server.listen(PORT, () => console.log(`MAGNATE en línea escuchando en el puerto ${PORT}`));
