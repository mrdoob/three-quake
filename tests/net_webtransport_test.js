// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const clientTransport = await import( '../src/net_webtransport.js' );
const { qsocket_t, net_message } = await import( '../src/net.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function sequencedPacket( sequence, acknowledged, payload ) {

	const packet = new Uint8Array( 9 + payload.length );
	const view = new DataView( packet.buffer );
	packet[ 0 ] = 0x71;
	view.setUint32( 1, sequence >>> 0, true );
	view.setUint32( 5, acknowledged >>> 0, true );
	packet.set( payload, 9 );
	return packet;

}

function makeSocket( messages ) {

	const socket = new qsocket_t();
	socket.receiveSequence = - 1;
	socket.unreliableReceiveSequence = - 1;
	socket.ackSequence = - 1;
	socket.driverdata = {
		connected: true,
		pendingMessages: messages
	};
	return socket;

}

function exerciseReceiveLanes( getMessage, label ) {

	const socket = makeSocket( [
		{ reliable: false, data: sequencedPacket( 1, 4, new Uint8Array( [ 0x22 ] ) ) },
		{ reliable: true, data: sequencedPacket( 0, 3, new Uint8Array( [ 0x11 ] ) ) }
	] );

	assertEqual( getMessage( socket ), 2, `${label} datagram result` );
	assertEqual( net_message.cursize, 1, `${label} datagram size` );
	assertEqual( net_message.data[ 0 ], 0x22, `${label} datagram payload` );
	assertEqual( getMessage( socket ), 1, `${label} reliable result` );
	assertEqual( net_message.cursize, 1, `${label} reliable size` );
	assertEqual( net_message.data[ 0 ], 0x11, `${label} reliable payload` );
	assertEqual( socket.unreliableReceiveSequence, 1,
		`${label} datagram receive sequence` );
	assertEqual( socket.receiveSequence, 0, `${label} reliable receive sequence` );
	assertEqual( socket.ackSequence, 4, `${label} shared acknowledgment` );

	const firstDatagram = makeSocket( [
		{ reliable: false, data: sequencedPacket( 0, 0, new Uint8Array( [ 0x33 ] ) ) }
	] );
	assertEqual( getMessage( firstDatagram ), 2, `${label} first sequence-zero datagram` );
	assertEqual( firstDatagram.unreliableReceiveSequence, 0,
		`${label} first datagram sequence` );

	firstDatagram.driverdata.pendingMessages.push(
		{ reliable: false, data: sequencedPacket( 0, 0, new Uint8Array( [ 0x44 ] ) ) }
	);
	assertEqual( getMessage( firstDatagram ), 0, `${label} stale same-lane datagram` );

	const legacy = makeSocket( [
		{ reliable: true, data: new Uint8Array( [ 0x55 ] ) }
	] );
	assertEqual( getMessage( legacy ), 1, `${label} legacy reliable result` );
	assertEqual( net_message.data[ 0 ], 0x55, `${label} legacy payload` );
	assertEqual( legacy.receiveSequence, - 1, `${label} legacy sequence state` );

	const wrapped = makeSocket( [
		{ reliable: false, data: sequencedPacket( 0x7fffffff, 0x7fffffff,
			new Uint8Array( [ 0x66 ] ) ) }
	] );
	wrapped.unreliableReceiveSequence = 0x7ffffffe;
	wrapped.ackSequence = 0x7ffffffe;
	assertEqual( getMessage( wrapped ), 2, `${label} pre-wrap datagram` );
	wrapped.driverdata.pendingMessages.push( {
		reliable: false,
		data: sequencedPacket( 0x80000000, 0x80000000, new Uint8Array( [ 0x77 ] ) )
	} );
	assertEqual( getMessage( wrapped ), 2, `${label} wrapped datagram` );
	assertEqual( wrapped.unreliableReceiveSequence, - 2147483648,
		`${label} wrapped receive sequence` );
	assertEqual( wrapped.ackSequence, - 2147483648,
		`${label} wrapped acknowledgment` );

}

Deno.test( 'client WebTransport keeps reliable and datagram receive sequences separate', () => {

	const oldData = net_message.data;
	const oldMaxsize = net_message.maxsize;
	const oldCursize = net_message.cursize;
	try {

		net_message.data = new Uint8Array( 256 );
		net_message.maxsize = 256;
		net_message.cursize = 0;
		exerciseReceiveLanes( clientTransport.WT_QGetMessage, 'client' );

	} finally {

		net_message.data = oldData;
		net_message.maxsize = oldMaxsize;
		net_message.cursize = oldCursize;

	}

} );
