// WebTransport server driver for Deno
// Handles incoming client connections via WebTransport/HTTP3

import { Sys_Printf } from "./sys_server.ts";
import { net_message } from "../src/net.js";

// Server configuration
let serverPort = 4433;
let certFile = "cert.pem";
let keyFile = "key.pem";

// DEPRECATED: These functions are no longer used with multi-process architecture
// Kept for backwards compatibility with game_server.js but they do nothing
export function WT_SetDirectMode(_enabled: boolean): void {}
export function WT_SetMapCallbacks(
  _changeMap: (mapName: string) => Promise<void>,
  _getCurrentMap: () => string,
): void {}
export function WT_SetMaxClientsCallback(
  _setMaxClients: (maxClients: number) => void,
): void {}

// Connection tracking
// Transport protocol:
// - Reliable bidirectional stream for signon data, stringcmds, name/frag changes
// - Unreliable WebTransport datagrams for entity updates, clientdata, clc_move
// - Game payloads may be prefixed with transport sequencing header:
//   [magic:1][sequence:4][ack:4][quake_payload...]
interface ClientConnection {
  id: number;
  webTransport: WebTransport;
  reliableStream: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  } | null;
  reliableWriter: WritableStreamDefaultWriter<Uint8Array> | null;
  reliableReader: ReadableStreamDefaultReader<Uint8Array> | null;
  datagramWritable: WritableStream<Uint8Array> | null;
  datagramReader: ReadableStreamDefaultReader<Uint8Array> | null;
  maxDatagramSize: number;
  pendingMessages: Array<{ reliable: boolean; data: Uint8Array }>;
  connected: boolean;
  address: string;
  lastMessageTime: number;
  reliableWriteQueue: Uint8Array[];
  reliableWriteInFlight: boolean;
  unreliableQueuedPacket: Uint8Array | null;
  unreliableWriteInFlight: boolean;
  outboundDatagramsEnabled: boolean;
  pendingReliableWrites: number;
  pendingUnreliableWrites: number;
}

// Socket structure compatible with Quake's qsocket_t
export interface QSocket {
  next: QSocket | null;
  connecttime: number;
  lastMessageTime: number;
  lastSendTime: number;
  disconnected: boolean;
  canSend: boolean;
  sendNext: boolean;
  driver: number;
  landriver: number;
  socket: number;
  driverdata: ClientConnection | null;
  ackSequence: number;
  sendSequence: number;
  unreliableSendSequence: number;
  sendMessageLength: number;
  sendMessage: Uint8Array;
  receiveSequence: number;
  unreliableReceiveSequence: number;
  receiveMessageLength: number;
  receiveMessage: Uint8Array;
  addr: unknown;
  address: string;
}

// Active sockets
let activeSockets: QSocket | null = null;
let freeSockets: QSocket | null = null;
let numSockets = 0;

// Pending new connections
const pendingConnections: QSocket[] = [];

// QUIC endpoint and listener
let quicEndpoint: Deno.QuicEndpoint | null = null;

// Connection ID counter
let nextConnectionId = 1;

// Driver level (set by net_main)
let net_driverlevel = 0;

const NET_MAXMESSAGE = 8192;

// Maximum pending messages per connection before we consider it dead/flooding.
// The game loop consumes messages at 20Hz — if hundreds pile up, something is wrong.
const MAX_PENDING_MESSAGES = 100;

// Write backpressure limits.
// Deno's WebTransport datagram writer appears unstable with concurrent writes on
// the same writer. We enforce strict single-flight writes:
// - Reliable: queued and written in order, one in-flight write at a time.
// - Unreliable: globally serialized per room process (across all clients) with
//   one queued "latest" datagram per connection.
const MAX_PENDING_WRITES_UNRELIABLE = 2;
const MAX_PENDING_WRITES_RELIABLE = 64;
const WT_PACKET_MAGIC = 0x71;
const WT_PACKET_HEADER_BYTES = 9; // [magic:u8][sequence:u32][acknowledged:u32]

const USE_OUTBOUND_DATAGRAMS: boolean = true;

// Deno's datagram writer can deadlock/time out when writes overlap across
// multiple client datagram writers in the same process. Serialize all outbound
// datagram writes globally per room process.
const _unreliableReadyQueue: ClientConnection[] = [];
const _unreliableReadySet = new Set<number>();
let _unreliableGlobalWriteInFlight = false;

// Yield to the macrotask queue so setInterval (game loop) can run.
// reader.read() resolves via microtasks which can cascade without yielding.
// setTimeout(resolve, 0) ensures the game loop's setInterval gets a chance to fire.
function _yieldAfterRead(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function _isTimeoutLikeError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return msg.includes("timed out") || msg.includes("timeout");
}

function _isNewerSequence(sequence: number, current: number): boolean {
  return (((sequence - current) | 0) > 0);
}

function _buildSequencedPacket(
  sock: QSocket,
  data: Uint8Array,
  dataLength: number,
  forceHeader = false,
): Uint8Array {
  if (!forceHeader && (sock.receiveSequence | 0) < 0) {
    const legacyPacket = new Uint8Array(dataLength);
    legacyPacket.set(data.subarray(0, dataLength), 0);
    return legacyPacket;
  }

  const packet = new Uint8Array(WT_PACKET_HEADER_BYTES + dataLength);
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

  const sequence = sock.sendSequence | 0;
  const acknowledged = sock.receiveSequence | 0;

  packet[0] = WT_PACKET_MAGIC;
  view.setUint32(1, sequence >>> 0, true);
  view.setUint32(5, acknowledged >>> 0, true);
  packet.set(data.subarray(0, dataLength), WT_PACKET_HEADER_BYTES);

  sock.sendSequence = (sequence + 1) | 0;

  return packet;
}

function _parseSequencedPacket(
  sock: QSocket,
  packet: Uint8Array,
  reliable: boolean,
): Uint8Array | null {
  if (packet.length < WT_PACKET_HEADER_BYTES || packet[0] !== WT_PACKET_MAGIC) {
    return packet;
  }

  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const sequence = view.getUint32(1, true) | 0;
  const acknowledged = view.getUint32(5, true) | 0;

  if (_isNewerSequence(acknowledged, sock.ackSequence | 0)) {
    sock.ackSequence = acknowledged;
  }

  const receiveKey = reliable === true
    ? "receiveSequence"
    : "unreliableReceiveSequence";
  if (_isNewerSequence(sequence, sock[receiveKey] | 0) === false) {
    return null;
  }

  sock[receiveKey] = sequence;
  return packet.subarray(WT_PACKET_HEADER_BYTES);
}

function _disableOutboundDatagrams(
  conn: ClientConnection,
  reason: string,
): void {
  if (conn.outboundDatagramsEnabled === false) {
    return;
  }

  conn.outboundDatagramsEnabled = false;
  conn.unreliableQueuedPacket = null;
  conn.unreliableWriteInFlight = false;
  conn.datagramWritable = null;
  _unreliableReadySet.delete(conn.id);

  _updatePendingWriteCounts(conn);
  Sys_Printf(
    "WT_SendUnreliableMessage: disabling outbound datagrams for %s (%s)\n",
    conn.address,
    reason,
  );
}

// Callback for socket allocation (injected from game_server.js)
// This allows using the shared socket pool from net_main.js
let _NET_NewQSocket: (() => QSocket | null) | null = null;
let _NET_FreeQSocket: ((sock: QSocket) => void) | null = null;

/**
 * Set the socket allocator callback
 */
export function WT_SetSocketAllocator(allocator: () => QSocket | null): void {
  _NET_NewQSocket = allocator;
}

/**
 * Set the socket freer callback
 */
export function WT_SetSocketFreer(freer: (sock: QSocket) => void): void {
  _NET_FreeQSocket = freer;
}

/**
 * Initialize the WebTransport server driver
 */
export function WT_Init(): number {
  Sys_Printf("WebTransport server driver initialized\n");
  return 0;
}

/**
 * Shutdown the WebTransport server driver
 */
export function WT_Shutdown(): void {
  Sys_Printf("WebTransport server driver shutting down\n");

  _unreliableReadyQueue.length = 0;
  _unreliableReadySet.clear();
  _unreliableGlobalWriteInFlight = false;

  if (quicEndpoint) {
    quicEndpoint.close();
    quicEndpoint = null;
  }

  // Close all connections
  let sock = activeSockets;
  while (sock) {
    if (sock.driverdata) {
      try {
        sock.driverdata.webTransport.close();
      } catch {
        // Ignore errors during shutdown
      }
    }
    sock = sock.next;
  }
}

// Store cert/key for listen()
let serverCert = "";
let serverKey = "";

/**
 * Start or stop listening for connections
 */
export async function WT_Listen(state: boolean): Promise<void> {
  if (state) {
    if (quicEndpoint) return; // Already listening

    try {
      // Read TLS certificate and key
      serverCert = await Deno.readTextFile(certFile);
      serverKey = await Deno.readTextFile(keyFile);

      // Create QUIC endpoint
      quicEndpoint = new Deno.QuicEndpoint({
        hostname: "0.0.0.0",
        port: serverPort,
      });

      Sys_Printf("WebTransport server listening on port " + serverPort + "\n");

      // Start accepting connections in background
      _acceptConnections();
    } catch (error) {
      Sys_Printf(
        "Failed to start WebTransport listener: " +
          (error as Error).message +
          "\n",
      );
    }
  } else {
    if (quicEndpoint) {
      quicEndpoint.close();
      quicEndpoint = null;
      Sys_Printf("WebTransport server stopped listening\n");
    }
  }
}

/**
 * Background task to accept incoming connections
 */
async function _acceptConnections(): Promise<void> {
  if (!quicEndpoint) return;

  try {
    // Get listener from endpoint with TLS options
    const listener = quicEndpoint.listen({
      cert: serverCert,
      key: serverKey,
      alpnProtocols: ["h3"], // HTTP/3 for WebTransport
    });

    // Accept connections using listener.accept() which returns QuicConn directly
    while (quicEndpoint) {
      try {
        // Use listener.accept() to get QuicConn directly
        const conn = await listener.accept();

        const remoteAddr = conn.remoteAddr;
        const address = remoteAddr.hostname + ":" + remoteAddr.port;
        Sys_Printf("Connection from " + address + "\n");

        // Handle in background
        (async () => {
          try {
            // Upgrade to WebTransport
            // @ts-ignore - unstable API
            const wt: WebTransport = await Deno.upgradeWebTransport(conn);
            await _handleWebTransportSession(wt, address);
          } catch (error) {
            Sys_Printf("Connection error: " + (error as Error).message + "\n");
            try {
              conn.close();
            } catch { /* ignore */ }
          }
        })();
      } catch (error) {
        if (quicEndpoint) {
          Sys_Printf("Accept error: " + (error as Error).message + "\n");
          // Delay before retrying to prevent 100% CPU spin if accept() fails repeatedly
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  } catch (error) {
    if (quicEndpoint) {
      Sys_Printf(
        "Listener error: " + (error as Error).message + "\n",
      );
    }
  }
}

/**
 * Handle an already-upgraded WebTransport session
 */
async function _handleWebTransportSession(
  wt: WebTransport,
  address: string,
): Promise<void> {
  try {
    await wt.ready;

    // Register wt.closed handler early — before stream acceptance.
    // If stream acceptance times out or fails, wt.closed can reject without
    // a catch handler, causing unhandled rejection crashes in logs.
    // We store the sock/conn references later once they exist.
    let earlyDeath = false;
    let deferredSock: QSocket | null = null;
    let deferredConn: ClientConnection | null = null;
    wt.closed.then(() => {
      if (deferredSock !== null && deferredConn !== null) {
        _handleConnectionDeath(deferredSock, deferredConn);
      } else {
        earlyDeath = true;
      }
    }).catch(() => {
      if (deferredSock !== null && deferredConn !== null) {
        _handleConnectionDeath(deferredSock, deferredConn);
      } else {
        earlyDeath = true;
      }
    });

    const clientConn: ClientConnection = {
      id: nextConnectionId++,
      webTransport: wt,
      reliableStream: null,
      reliableWriter: null,
      reliableReader: null,
      datagramWritable: null,
      datagramReader: null,
      maxDatagramSize: 0,
      pendingMessages: [],
      connected: true,
      address: address,
      lastMessageTime: Date.now(),
      reliableWriteQueue: [],
      reliableWriteInFlight: false,
      unreliableQueuedPacket: null,
      unreliableWriteInFlight: false,
      outboundDatagramsEnabled: true,
      pendingReliableWrites: 0,
      pendingUnreliableWrites: 0,
    };

    // Accept the first bidirectional stream (reliable channel)
    const streamReader = wt.incomingBidirectionalStreams.getReader();
    const { value: stream, done } = await streamReader.read();

    if (done || !stream) {
      streamReader.releaseLock();
      wt.close();
      return;
    }
    clientConn.reliableStream = stream;
    clientConn.reliableWriter = stream.writable.getWriter();
    clientConn.reliableReader = stream.readable.getReader();

    streamReader.releaseLock();

    // Unreliable channel via WebTransport datagrams
    const datagrams = wt.datagrams;
    if (!datagrams) {
      Sys_Printf("Client %s has no datagram support, closing\n", address);
      wt.close();
      return;
    }
    clientConn.datagramWritable = datagrams.writable;
    clientConn.datagramReader = datagrams.readable.getReader();
    const maxDatagramSize = datagrams.maxDatagramSize;
    if (typeof maxDatagramSize === "number") {
      clientConn.maxDatagramSize = maxDatagramSize;
    }

    // Create a socket for this game connection
    // Note: With multi-process architecture, lobby protocol is handled by lobby_server.js
    // Game servers (this code) always run in direct mode
    const sock = _newQSocket();
    if (!sock) {
      Sys_Printf("No free sockets for %s\n", address);
      wt.close();
      return;
    }

    sock.address = clientConn.address;
    sock.driverdata = clientConn;
    sock.connecttime = performance.now() / 1000;
    sock.lastMessageTime = performance.now() / 1000;
    sock.sendSequence = 0;
    sock.receiveSequence = -1;
    sock.unreliableReceiveSequence = -1;
    sock.ackSequence = -1;

    pendingConnections.push(sock);

    // Wire up deferred wt.closed handler (registered early, before stream acceptance)
    deferredSock = sock;
    deferredConn = clientConn;

    // If the transport died during stream acceptance, handle it now
    if (earlyDeath) {
      _handleConnectionDeath(sock, clientConn);
      return;
    }

    _startBackgroundReaders(sock, clientConn);
  } catch (error) {
    Sys_Printf("Session error for %s: %s\n", address, (error as Error).message);
    try {
      wt.close();
    } catch { /* ignore */ }
  }
}

/**
 * Start background readers for reliable stream + unreliable datagrams.
 */
function _startBackgroundReaders(
  sock: QSocket,
  conn: ClientConnection,
): void {
  // Read reliable messages from the first bidirectional stream
  (async () => {
    try {
      while (conn.connected && conn.reliableReader) {
        const data = await _readFramedMessage(conn.reliableReader);
        if (data === null) break;

        conn.pendingMessages.push({ reliable: true, data });
        conn.lastMessageTime = Date.now();

        // If messages are piling up, the game loop isn't consuming them
        if (conn.pendingMessages.length > MAX_PENDING_MESSAGES) {
          Sys_Printf(
            "Reliable reader: %d pending messages for %s, disconnecting\n",
            conn.pendingMessages.length,
            conn.address,
          );
          conn.connected = false;
          break;
        }

        // Yield to macrotask queue after reading so the game loop can run
        await _yieldAfterRead();
      }
    } catch (error) {
      if (conn.connected) {
        Sys_Printf(
          "Reliable reader error for %s: %s\n",
          conn.address,
          String(error),
        );
        conn.connected = false;
      }
    }
    // Release the reader lock when done
    try {
      conn.reliableReader?.releaseLock();
    } catch { /* ignore */ }
  })();

  // Read unreliable messages from datagrams
  (async () => {
    try {
      while (conn.connected && conn.datagramReader) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await conn.datagramReader.read();
        } catch (error) {
          if (_isTimeoutLikeError(error)) {
            // WebTransport datagram reads can timeout when no moves arrive yet.
            // Keep the connection alive and continue polling.
            await _yieldAfterRead();
            continue;
          }
          throw error;
        }

        const { value, done } = result;
        if (done) break;
        if (value === undefined || value.length === 0) {
          // Some runtimes can surface empty datagrams repeatedly.
          // Yield here to avoid microtask spin that starves timers.
          await _yieldAfterRead();
          continue;
        }

        conn.pendingMessages.push({
          reliable: false,
          data: new Uint8Array(value),
        });
        conn.lastMessageTime = Date.now();

        // If messages are piling up, the game loop isn't consuming them
        if (conn.pendingMessages.length > MAX_PENDING_MESSAGES) {
          Sys_Printf(
            "Unreliable reader: %d pending messages for %s, disconnecting\n",
            conn.pendingMessages.length,
            conn.address,
          );
          conn.connected = false;
          break;
        }

        // Yield to macrotask queue after reading so the game loop can run
        await _yieldAfterRead();
      }
    } catch (error) {
      if (conn.connected) {
        Sys_Printf(
          "Datagram reader error for %s: %s\n",
          conn.address,
          String(error),
        );
        conn.connected = false;
      }
    }
    // Release the reader lock when done
    try {
      conn.datagramReader?.releaseLock();
    } catch { /* ignore */ }
  })();
}

/**
 * Read a framed message from the stream
 * Frame format: [length:2][data:N]
 * Returns: Uint8Array or null on error/EOF
 */
const _emptyMessage = new Uint8Array(0);
async function _readFramedMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array | null> {
  // Read header (2 bytes)
  const header = await _readExact(reader, 2);
  if (header === null) {
    return null;
  }

  const length = header[0] | (header[1] << 8);

  if (length === 0) {
    return _emptyMessage;
  }

  // Read message data
  return await _readExact(reader, length);
}

// Buffer for leftover bytes from previous reads (per-reader tracking)
const _readerBuffers = new WeakMap<
  ReadableStreamDefaultReader<Uint8Array>,
  { data: Uint8Array | null; offset: number }
>();

function _getReaderBuffer(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): { data: Uint8Array | null; offset: number } {
  let buf = _readerBuffers.get(reader);
  if (!buf) {
    buf = { data: null, offset: 0 };
    _readerBuffers.set(reader, buf);
  }
  return buf;
}

/**
 * Read exactly n bytes from a reader, with buffering for leftover bytes.
 * Always copies data into a new Uint8Array to avoid holding references to
 * QUIC stream internal buffers (which can cause buffer starvation and
 * event loop freezes in Deno's QUIC stack).
 */
async function _readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
): Promise<Uint8Array | null> {
  const buf = _getReaderBuffer(reader);
  const output = new Uint8Array(n);
  let offset = 0;

  // Drain leftover bytes from previous read
  if (buf.data !== null) {
    const available = buf.data.length - buf.offset;
    const bytesToCopy = Math.min(available, n);
    output.set(buf.data.subarray(buf.offset, buf.offset + bytesToCopy), 0);
    offset = bytesToCopy;
    buf.offset += bytesToCopy;

    if (buf.offset >= buf.data.length) {
      buf.data = null;
      buf.offset = 0;
    }
  }

  // Read from stream until we have n bytes
  while (offset < n) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (error) {
      if (_isTimeoutLikeError(error)) {
        await _yieldAfterRead();
        continue;
      }
      throw error;
    }

    const { value, done } = readResult;
    if (done) return null;
    if (value === undefined || value.length === 0) return null;

    const bytesToCopy = Math.min(value.length, n - offset);
    output.set(value.subarray(0, bytesToCopy), offset);
    offset += bytesToCopy;

    // Save leftover bytes for next call
    if (bytesToCopy < value.length) {
      buf.data = value;
      buf.offset = bytesToCopy;
    }
  }

  return output;
}

/**
 * Create a new socket
 * Uses the injected allocator from net_main.js if available (preferred)
 * Otherwise falls back to internal allocation
 */
function _newQSocket(): QSocket | null {
  // If we have an external allocator (from net_main.js), use it
  if (_NET_NewQSocket !== null) {
    const sock = _NET_NewQSocket();
    if (sock !== null) {
      sock.driver = net_driverlevel;
    }
    return sock;
  }

  // Fallback to internal allocation (for standalone testing)
  if (!freeSockets) {
    // Allocate more sockets if needed
    if (numSockets >= 32) return null; // Max sockets

    const sock: QSocket = {
      next: null,
      connecttime: 0,
      lastMessageTime: 0,
      lastSendTime: 0,
      disconnected: false,
      canSend: true,
      sendNext: false,
      driver: net_driverlevel,
      landriver: 0,
      socket: 0,
      driverdata: null,
      ackSequence: 0,
      sendSequence: 0,
      unreliableSendSequence: 0,
      sendMessageLength: 0,
      sendMessage: new Uint8Array(NET_MAXMESSAGE),
      receiveSequence: 0,
      unreliableReceiveSequence: 0,
      receiveMessageLength: 0,
      receiveMessage: new Uint8Array(NET_MAXMESSAGE),
      addr: null,
      address: "",
    };

    numSockets++;
    return sock;
  }

  const sock = freeSockets;
  freeSockets = sock.next;

  // Reset socket state
  sock.next = activeSockets;
  activeSockets = sock;
  sock.disconnected = false;
  sock.canSend = true;
  sock.driverdata = null;

  return sock;
}

/**
 * Handle connection death (WebTransport closed or errored)
 *
 * Per original Quake design (net_main.c):
 * - sock.disconnected is ONLY set by NET_FreeQSocket (after freeing)
 * - We should NOT set it here for sockets assigned to clients
 * - Just set conn.connected = false, which makes WT_QGetMessage return -1
 * - This triggers SV_DropClient -> NET_Close -> WT_Close + NET_FreeQSocket
 *
 * Exception: sockets still in pendingConnections were never assigned to a client,
 * so we must clean them up directly (including setting disconnected and freeing).
 */
function _handleConnectionDeath(sock: QSocket, conn: ClientConnection): void {
  conn.connected = false;
  conn.reliableWriteQueue.length = 0;
  conn.unreliableQueuedPacket = null;
  conn.reliableWriteInFlight = false;
  conn.unreliableWriteInFlight = false;
  conn.outboundDatagramsEnabled = false;
  conn.datagramWritable = null;
  conn.pendingReliableWrites = 0;
  conn.pendingUnreliableWrites = 0;
  _unreliableReadySet.delete(conn.id);

  // Cancel readers to unblock any stuck reader.read() calls in _readExact.
  // Without this, reader loops can spin indefinitely after the transport closes.
  try {
    if (conn.reliableReader) {
      conn.reliableReader.cancel().catch(() => {});
    }
    if (conn.datagramReader) {
      conn.datagramReader.cancel().catch(() => {});
    }
  } catch { /* ignore */ }

  // Check if socket is still in pending queue (never assigned to a client)
  const pendingIdx = pendingConnections.indexOf(sock);
  if (pendingIdx !== -1) {
    // Socket never made it to a client slot - clean up directly
    pendingConnections.splice(pendingIdx, 1);
    sock.disconnected = true; // Only set for pending sockets

    // Free the socket back to the pool (only for pending sockets)
    if (_NET_FreeQSocket !== null) {
      _NET_FreeQSocket(sock);
    }
  }
  // For sockets already assigned to clients:
  // - DON'T set sock.disconnected = true (would skip NET_Close cleanup)
  // - conn.connected = false makes WT_QGetMessage return -1
  // - This triggers SV_DropClient -> NET_Close -> WT_Close + NET_FreeQSocket
}

/**
 * Free a socket
 */
export function WT_FreeQSocket(sock: QSocket): void {
  // Remove from active list
  if (sock === activeSockets) {
    activeSockets = sock.next;
  } else {
    let s = activeSockets;
    while (s) {
      if (s.next === sock) {
        s.next = sock.next;
        break;
      }
      s = s.next;
    }
  }

  // Add to free list
  sock.next = freeSockets;
  freeSockets = sock;
  sock.disconnected = true;
}

/**
 * Search for hosts (server doesn't search)
 */
export function WT_SearchForHosts(_xmit: boolean): void {
  // Server doesn't search for other servers
}

/**
 * Connect (server doesn't connect out)
 */
export function WT_Connect(_host: string): null {
  // Server doesn't connect to other servers
  return null;
}

/**
 * Check for new incoming connections
 */
export function WT_CheckNewConnections(): QSocket | null {
  // Filter out any disconnected sockets first
  while (pendingConnections.length > 0) {
    const sock = pendingConnections[0];
    if (sock.disconnected) {
      // Socket died before we could process it, remove and continue
      pendingConnections.shift();
      Sys_Printf("Skipped disconnected socket in pending queue\n");
      continue;
    }
    return pendingConnections.shift()!;
  }
  return null;
}

/**
 * Get a message from a socket
 */
export function WT_QGetMessage(sock: QSocket): number {
  const conn = sock.driverdata;
  if (conn === null) return -1;

  if (!conn.connected && conn.pendingMessages.length === 0) {
    return -1;
  }

  while (conn.pendingMessages.length > 0) {
    // Get next message
    let msg = conn.pendingMessages.shift()!;

    // For unreliable messages, skip to the most recent one.
    // In original Quake, unreliable messages are overwritten by newer ones.
    // The WebTransport datagram reader queues all datagrams, so if the client
    // sends faster than the server reads, stale messages pile up.
    // Discard stale unreliable messages but preserve any reliable messages.
    if (!msg.reliable) {
      while (conn.pendingMessages.length > 0) {
        const next = conn.pendingMessages[0];
        if (next.reliable) break; // Stop at next reliable message
        conn.pendingMessages.shift();
        msg = next; // Use newer unreliable message
      }
    }

    const payload = _parseSequencedPacket(sock, msg.data, msg.reliable);
    if (payload === null) {
      continue;
    }

    // Copy to net_message
    net_message.cursize = 0;
    for (let i = 0; i < payload.length && i < net_message.maxsize; i++) {
      net_message.data[i] = payload[i];
      net_message.cursize++;
    }

    sock.lastMessageTime = performance.now() / 1000;

    return msg.reliable ? 1 : 2;
  }

  if (conn.connected) {
    return 0;
  }

  return -1;
}

function _updatePendingWriteCounts(conn: ClientConnection): void {
  conn.pendingReliableWrites = conn.reliableWriteQueue.length +
    (conn.reliableWriteInFlight ? 1 : 0);

  if (conn.outboundDatagramsEnabled === false || conn.datagramWritable === null) {
    conn.pendingUnreliableWrites = 0;
    return;
  }

  conn.pendingUnreliableWrites =
    (conn.unreliableWriteInFlight ? 1 : 0) +
    (conn.unreliableQueuedPacket !== null ? 1 : 0);
}

function _pumpReliableWrites(conn: ClientConnection): void {
  if (
    !conn.connected || conn.reliableWriter === null ||
    conn.reliableWriteInFlight
  ) {
    return;
  }

  conn.reliableWriteInFlight = true;
  _updatePendingWriteCounts(conn);

  (async () => {
    while (conn.connected && conn.reliableWriter !== null) {
      const frame = conn.reliableWriteQueue.shift();
      if (frame === undefined) {
        break;
      }

      _updatePendingWriteCounts(conn);

      try {
        await conn.reliableWriter.write(frame);
      } catch (err) {
        Sys_Printf(
          "WT_QSendMessage: write FAILED: %s\n",
          (err as Error).message,
        );
        conn.connected = false;
        break;
      }
    }

    conn.reliableWriteInFlight = false;
    _updatePendingWriteCounts(conn);

    // Covers a race where data was queued between shift() and inFlight=false.
    if (
      conn.connected && conn.reliableWriter !== null &&
      conn.reliableWriteQueue.length > 0
    ) {
      _pumpReliableWrites(conn);
    }
  })();
}

function _enqueueUnreliableConn(conn: ClientConnection): void {
  if (
    !conn.connected || conn.outboundDatagramsEnabled === false ||
    conn.datagramWritable === null ||
    conn.unreliableQueuedPacket === null
  ) {
    return;
  }

  if (_unreliableReadySet.has(conn.id)) {
    return;
  }

  _unreliableReadySet.add(conn.id);
  _unreliableReadyQueue.push(conn);
}

function _dequeueUnreliableConn(): ClientConnection | null {
  while (_unreliableReadyQueue.length > 0) {
    const conn = _unreliableReadyQueue.shift()!;
    _unreliableReadySet.delete(conn.id);

    if (
      !conn.connected || conn.outboundDatagramsEnabled === false ||
      conn.datagramWritable === null ||
      conn.unreliableQueuedPacket === null
    ) {
      continue;
    }

    return conn;
  }

  return null;
}

function _pumpUnreliableWrites(): void {
  if (_unreliableGlobalWriteInFlight) {
    return;
  }

  _unreliableGlobalWriteInFlight = true;

  (async () => {
    while (true) {
      const conn = _dequeueUnreliableConn();
      if (conn === null) {
        break;
      }

      const packet = conn.unreliableQueuedPacket;
      if (packet === null) {
        continue;
      }

      conn.unreliableQueuedPacket = null;
      conn.unreliableWriteInFlight = true;
      _updatePendingWriteCounts(conn);

      let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
      try {
        if (conn.datagramWritable === null) {
          _disableOutboundDatagrams(conn, "datagram channel unavailable");
        } else {
          writer = conn.datagramWritable.getWriter();
          await writer.write(packet);
        }
      } catch (error) {
        // Unreliable channel write timeouts are observed in Deno under load.
        // Downgrade this connection to reliable-only instead of hard drop.
        if (_isTimeoutLikeError(error)) {
          _disableOutboundDatagrams(conn, "timeout");
        } else {
          _disableOutboundDatagrams(conn, String(error));
        }
      } finally {
        if (writer !== null) {
          try {
            writer.releaseLock();
          } catch {
            // ignore
          }
        }
      }

      conn.unreliableWriteInFlight = false;
      _updatePendingWriteCounts(conn);

      if (
        conn.connected &&
        conn.outboundDatagramsEnabled &&
        conn.datagramWritable !== null &&
        conn.unreliableQueuedPacket !== null
      ) {
        _enqueueUnreliableConn(conn);
      }
    }

    _unreliableGlobalWriteInFlight = false;

    // Covers a race where packets were queued after the dequeue loop drained.
    if (_unreliableReadyQueue.length > 0) {
      _pumpUnreliableWrites();
    }
  })();
}

/**
 * Send a reliable message.
 */
export function WT_QSendMessage(
  sock: QSocket,
  data: { data: Uint8Array; cursize: number },
): number {
  const conn = sock.driverdata;
  if (!conn || !conn.connected || !conn.reliableWriter) {
    return -1;
  }

  // Backpressure: if too many reliable writes are queued, connection is dead/zombie.
  const pendingReliable = conn.reliableWriteQueue.length +
    (conn.reliableWriteInFlight ? 1 : 0);
  if (pendingReliable >= MAX_PENDING_WRITES_RELIABLE) {
    Sys_Printf(
      "WT_QSendMessage: %d reliable pending writes for %s, disconnecting\n",
      pendingReliable,
      conn.address,
    );
    conn.connected = false;
    return -1;
  }

  const packet = _buildSequencedPacket(sock, data.data, data.cursize);

  // Frame the message: [length:2][data:N]
  const frame = new Uint8Array(2 + packet.length);
  frame[0] = packet.length & 0xff;
  frame[1] = (packet.length >> 8) & 0xff;
  frame.set(packet, 2);

  conn.reliableWriteQueue.push(frame);
  _updatePendingWriteCounts(conn);
  _pumpReliableWrites(conn);

  return 1;
}

/**
 * Send an unreliable message over WebTransport datagrams.
 */
export function WT_SendUnreliableMessage(
  sock: QSocket,
  data: { data: Uint8Array; cursize: number },
): number {
  const conn = sock.driverdata;
  if (!conn || !conn.connected) return -1;

  if (
    USE_OUTBOUND_DATAGRAMS === false ||
    conn.outboundDatagramsEnabled === false ||
    conn.datagramWritable === null
  ) {
    return WT_QSendMessage(sock, data);
  }

  const packet = _buildSequencedPacket(sock, data.data, data.cursize);

  if (conn.maxDatagramSize > 0 && packet.length > conn.maxDatagramSize) {
    return 1;
  }

  // Only keep the latest unreliable packet while one write is in flight.
  conn.unreliableQueuedPacket = packet;
  _updatePendingWriteCounts(conn);
  _enqueueUnreliableConn(conn);
  _pumpUnreliableWrites();

  return 1;
}

/**
 * Check if we can send a reliable message
 */
export function WT_CanSendMessage(sock: QSocket): boolean {
  const conn = sock.driverdata;
  return conn !== null &&
    conn.connected &&
    conn.reliableWriter !== null &&
    conn.pendingReliableWrites < MAX_PENDING_WRITES_RELIABLE;
}

/**
 * Check if we can send an unreliable message
 */
export function WT_CanSendUnreliableMessage(sock: QSocket): boolean {
  const conn = sock.driverdata;
  if (conn === null || conn.connected === false) {
    return false;
  }

  if (
    USE_OUTBOUND_DATAGRAMS === false ||
    conn.outboundDatagramsEnabled === false ||
    conn.datagramWritable === null
  ) {
    return WT_CanSendMessage(sock);
  }

  return conn !== null &&
    conn.datagramWritable !== null &&
    !(conn.unreliableWriteInFlight && conn.unreliableQueuedPacket !== null) &&
    conn.pendingUnreliableWrites < MAX_PENDING_WRITES_UNRELIABLE;
}

/**
 * Close a connection
 */
export function WT_Close(sock: QSocket): void {
  const conn = sock.driverdata;
  if (!conn) return;

  conn.connected = false;
  conn.reliableWriteQueue.length = 0;
  conn.unreliableQueuedPacket = null;
  conn.reliableWriteInFlight = false;
  conn.unreliableWriteInFlight = false;
  conn.outboundDatagramsEnabled = false;
  conn.pendingReliableWrites = 0;
  conn.pendingUnreliableWrites = 0;
  _unreliableReadySet.delete(conn.id);

  try {
    // Cancel readers first — unblocks any stuck reader.read() in _readExact
    if (conn.reliableReader) {
      conn.reliableReader.cancel().catch(() => {});
      conn.reliableReader = null;
    }
    if (conn.datagramReader) {
      conn.datagramReader.cancel().catch(() => {});
      conn.datagramReader = null;
    }

    // Close writers
    if (conn.reliableWriter) {
      conn.reliableWriter.close().catch(() => {});
      conn.reliableWriter = null;
    }
    conn.datagramWritable = null;
    conn.webTransport.close();
  } catch {
    // Ignore errors during close
  }

  Sys_Printf("Connection closed: " + conn.address + "\n");
  sock.driverdata = null;
}

/**
 * Configure the server
 */
export function WT_SetConfig(config: {
  port?: number;
  certFile?: string;
  keyFile?: string;
}): void {
  if (config.port) serverPort = config.port;
  if (config.certFile) certFile = config.certFile;
  if (config.keyFile) keyFile = config.keyFile;
}

/**
 * Set driver level (called by net_main)
 */
export function WT_SetDriverLevel(level: number): void {
  net_driverlevel = level;
}

/**
 * Get the maximum pendingWrites count across all active connections.
 * Used for heartbeat diagnostics to detect write backpressure building up.
 */
export function WT_GetMaxPendingWrites(): number {
  let max = 0;
  let sock = activeSockets;
  while (sock) {
    const conn = sock.driverdata;
    if (conn !== null) {
      const pendingTotal = conn.pendingReliableWrites +
        conn.pendingUnreliableWrites;
      if (pendingTotal > max) {
        max = pendingTotal;
      }
    }
    sock = sock.next;
  }
  // Also check pending connections
  for (let i = 0; i < pendingConnections.length; i++) {
    const conn = pendingConnections[i].driverdata;
    if (conn !== null) {
      const pendingTotal = conn.pendingReliableWrites +
        conn.pendingUnreliableWrites;
      if (pendingTotal > max) {
        max = pendingTotal;
      }
    }
  }
  return max;
}

/**
 * Export socket type for external use
 */
export type { QSocket as qsocket_t };
