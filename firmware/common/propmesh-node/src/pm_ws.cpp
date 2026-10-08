#include <Arduino.h>
#include <WiFi.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha1.h>
#include "pm_ws.h"

#define WS_CLIENTS 2
#define WS_MAX_MSG 4096
#define WS_IDLE_MS 90000  // drop a client that sends nothing (not even a pong) this long

static WiFiServer *server;
static void (*handler)(char *, size_t);

struct WsClient {
  WiFiClient sock;
  bool open;          // handshake done
  uint8_t *buf;       // WS_MAX_MSG + 1, heap, while connected
  size_t len;         // bytes of the current frame/HTTP request so far
  uint32_t last_rx_ms;
};
static WsClient clients[WS_CLIENTS];

static void drop(WsClient &c) {
  c.sock.stop();
  free(c.buf);
  c.buf = nullptr;
  c.open = false;
  c.len = 0;
}

// Server -> client frame: FIN + opcode, unmasked, 7/16-bit length.
static void send_frame(WsClient &c, uint8_t opcode, const uint8_t *data, size_t len) {
  uint8_t head[4];
  size_t n = 0;
  head[n++] = 0x80 | opcode;
  if (len < 126) head[n++] = (uint8_t)len;
  else { head[n++] = 126; head[n++] = len >> 8; head[n++] = len & 0xFF; }
  c.sock.write(head, n);
  if (len) c.sock.write(data, len);
}

// HTTP upgrade: find Sec-WebSocket-Key, answer with the accept hash.
static bool handshake(WsClient &c) {
  c.buf[c.len] = 0;
  char *req = (char *)c.buf;
  if (!strstr(req, "\r\n\r\n")) return c.len < WS_MAX_MSG;  // more to come
  char *k = strcasestr(req, "Sec-WebSocket-Key:");
  if (!k) { c.sock.print("HTTP/1.1 400 Bad Request\r\n\r\n"); return false; }
  k += 18;
  while (*k == ' ') k++;
  char *e = strstr(k, "\r\n");
  if (!e) return false;
  char key[64];
  size_t kl = e - k;
  if (kl >= sizeof(key) - 40) return false;
  memcpy(key, k, kl);
  strcpy(key + kl, "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  uint8_t sha[20];
  mbedtls_sha1((const uint8_t *)key, strlen(key), sha);
  unsigned char acc[40];
  size_t al = 0;
  mbedtls_base64_encode(acc, sizeof(acc), &al, sha, 20);
  acc[al] = 0;
  c.sock.print("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ");
  c.sock.print((const char *)acc);
  c.sock.print("\r\n\r\n");
  c.open = true;
  c.len = 0;
  Serial.printf("ws: console connected from %s\n", c.sock.remoteIP().toString().c_str());
  return true;
}

// Parse what's buffered as a client->server frame (masked). Returns bytes
// consumed, 0 if incomplete, -1 to drop the client.
static int frame(WsClient &c) {
  if (c.len < 2) return 0;
  uint8_t *b = c.buf;
  uint8_t opcode = b[0] & 0x0F;
  bool fin = b[0] & 0x80, masked = b[1] & 0x80;
  size_t plen = b[1] & 0x7F, pos = 2;
  if (plen == 126) { if (c.len < 4) return 0; plen = (size_t)b[2] << 8 | b[3]; pos = 4; }
  else if (plen == 127) return -1;  // >64 kB: never ours
  if (!masked || !fin || plen > WS_MAX_MSG) return -1;  // no fragmentation support
  if (c.len < pos + 4 + plen) return 0;
  const uint8_t *mask = b + pos;
  uint8_t *p = b + pos + 4;
  for (size_t i = 0; i < plen; i++) p[i] ^= mask[i & 3];
  switch (opcode) {
    case 0x1:  // text: one JSON request
      p[plen] = 0;
      if (handler && plen) handler((char *)p, plen);
      break;
    case 0x9: send_frame(c, 0xA, p, plen); break;  // ping -> pong
    case 0x8: return -1;                           // close
    default: break;                                // binary, pong: ignore
  }
  return (int)(pos + 4 + plen);
}

void pm_ws_begin(uint16_t port, void (*on_line)(char *, size_t)) {
  if (server) return;
  handler = on_line;
  server = new WiFiServer(port);
  server->begin();
  server->setNoDelay(true);
  Serial.printf("ws: listening on port %u\n", port);
}

void pm_ws_loop() {
  if (!server) return;
  uint32_t now = millis();
  WiFiClient incoming = server->accept();
  if (incoming) {
    int slot = -1;
    for (int i = 0; i < WS_CLIENTS; i++) if (!clients[i].sock) { slot = i; break; }
    if (slot < 0) { incoming.stop(); }
    else {
      WsClient &c = clients[slot];
      c.sock = incoming;
      c.buf = (uint8_t *)malloc(WS_MAX_MSG + 1);
      c.len = 0;
      c.open = false;
      c.last_rx_ms = now;
      if (!c.buf) drop(c);
    }
  }
  for (int i = 0; i < WS_CLIENTS; i++) {
    WsClient &c = clients[i];
    if (!c.sock) { if (c.buf) drop(c); continue; }
    if (!c.sock.connected()) { drop(c); continue; }
    while (c.sock.available() && c.len < WS_MAX_MSG) {
      c.buf[c.len++] = (uint8_t)c.sock.read();
      c.last_rx_ms = now;
      if (!c.open) {
        if (!handshake(c)) { drop(c); break; }
        continue;
      }
      int used = frame(c);
      if (used < 0) { drop(c); break; }
      if (used > 0) {  // a frame may be followed by the start of the next
        memmove(c.buf, c.buf + used, c.len - used);
        c.len -= used;
      }
    }
    if (c.sock && c.len >= WS_MAX_MSG) drop(c);  // garbage, or a message too big
    if (c.sock && (uint32_t)(now - c.last_rx_ms) > WS_IDLE_MS) drop(c);
  }
}

void pm_ws_send(const char *json, size_t len) {
  for (int i = 0; i < WS_CLIENTS; i++)
    if (clients[i].sock && clients[i].open) send_frame(clients[i], 0x1, (const uint8_t *)json, len);
}

uint8_t pm_ws_clients() {
  uint8_t n = 0;
  for (int i = 0; i < WS_CLIENTS; i++) if (clients[i].sock && clients[i].open) n++;
  return n;
}
