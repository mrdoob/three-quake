import { type QSocket, WT_QGetMessage } from "./net_webtransport_server.ts";
import { net_message } from "../src/net.js";

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function sequencedPacket(
  sequence: number,
  acknowledged: number,
  payload: Uint8Array,
): Uint8Array {
  const packet = new Uint8Array(9 + payload.length);
  const view = new DataView(packet.buffer);
  packet[0] = 0x71;
  view.setUint32(1, sequence >>> 0, true);
  view.setUint32(5, acknowledged >>> 0, true);
  packet.set(payload, 9);
  return packet;
}

function makeSocket(
  messages: Array<{ reliable: boolean; data: Uint8Array }>,
): QSocket {
  return {
    receiveSequence: -1,
    unreliableReceiveSequence: -1,
    ackSequence: -1,
    lastMessageTime: 0,
    driverdata: {
      connected: true,
      pendingMessages: messages,
    },
  } as QSocket;
}

Deno.test(
  "server WebTransport keeps reliable and datagram receive sequences separate",
  () => {
    const oldData = net_message.data;
    const oldMaxsize = net_message.maxsize;
    const oldCursize = net_message.cursize;
    try {
      net_message.data = new Uint8Array(256);
      net_message.maxsize = 256;
      net_message.cursize = 0;

      const socket = makeSocket([
        {
          reliable: false,
          data: sequencedPacket(1, 4, new Uint8Array([0x22])),
        },
        {
          reliable: true,
          data: sequencedPacket(0, 3, new Uint8Array([0x11])),
        },
      ]);
      assertEqual(WT_QGetMessage(socket), 2, "datagram result");
      assertEqual(net_message.data[0], 0x22, "datagram payload");
      assertEqual(WT_QGetMessage(socket), 1, "reliable result");
      assertEqual(net_message.data[0], 0x11, "reliable payload");
      assertEqual(socket.unreliableReceiveSequence, 1, "datagram sequence");
      assertEqual(socket.receiveSequence, 0, "reliable sequence");
      assertEqual(socket.ackSequence, 4, "shared acknowledgment");

      const firstDatagram = makeSocket([{
        reliable: false,
        data: sequencedPacket(0, 0, new Uint8Array([0x33])),
      }]);
      assertEqual(
        WT_QGetMessage(firstDatagram),
        2,
        "first sequence-zero datagram",
      );
      firstDatagram.driverdata!.pendingMessages.push({
        reliable: false,
        data: sequencedPacket(0, 0, new Uint8Array([0x44])),
      });
      assertEqual(WT_QGetMessage(firstDatagram), 0, "stale same-lane datagram");

      const legacy = makeSocket([{
        reliable: true,
        data: new Uint8Array([0x55]),
      }]);
      assertEqual(WT_QGetMessage(legacy), 1, "legacy reliable result");
      assertEqual(net_message.data[0], 0x55, "legacy payload");
      assertEqual(legacy.receiveSequence, -1, "legacy sequence state");

      const wrapped = makeSocket([{
        reliable: false,
        data: sequencedPacket(0x7fffffff, 0x7fffffff, new Uint8Array([0x66])),
      }]);
      wrapped.unreliableReceiveSequence = 0x7ffffffe;
      wrapped.ackSequence = 0x7ffffffe;
      assertEqual(WT_QGetMessage(wrapped), 2, "pre-wrap datagram");
      wrapped.driverdata!.pendingMessages.push({
        reliable: false,
        data: sequencedPacket(0x80000000, 0x80000000, new Uint8Array([0x77])),
      });
      assertEqual(WT_QGetMessage(wrapped), 2, "wrapped datagram");
      assertEqual(
        wrapped.unreliableReceiveSequence,
        -2147483648,
        "wrapped receive sequence",
      );
      assertEqual(wrapped.ackSequence, -2147483648, "wrapped acknowledgment");
    } finally {
      net_message.data = oldData;
      net_message.maxsize = oldMaxsize;
      net_message.cursize = oldCursize;
    }
  },
);
