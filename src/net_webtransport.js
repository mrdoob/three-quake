// WebTransport network driver for multiplayer support
// New module for browser-based WebTransport client connections

import { Con_Printf, Con_DPrintf, SZ_Clear, SZ_Write } from './common.js';
import { NET_NewQSocket, NET_FreeQSocket } from './net_main.js';
import {
	NET_MAXMESSAGE,
	net_message,
	net_driverlevel,
	hostCacheCount, set_hostCacheCount,
	hostcache
} from './net.js';
import { M_ConnectionError, M_Menu_Main_f } from './menu.js';
import { set_key_dest, key_menu } from './keys.js';

// WebTransport connection state
let wt_initialized = false;

// Timeout for lobby room join operations (in milliseconds)
// This should be long enough for slow connections but short enough to not hang indefinitely
const ROOM_JOIN_TIMEOUT_MS = 10000; // 10 seconds
const LOBBY_IO_TIMEOUT_MS = 10000; // 10 seconds

// Deno's WebTransport datagram receive path can wedge room processes when many
// rooms/clients send clc_move over datagrams concurrently. Keep client->server
// traffic on the reliable stream for stability, while still receiving server
// datagrams for entity updates.
const USE_CLIENT_OUTBOUND_DATAGRAMS = false;
const WT_PACKET_MAGIC = 0x71;
const WT_PACKET_HEADER_BYTES = 9; // [magic:u8][sequence:u32][acknowledged:u32]

// Active connections
const wt_connections = new Map(); // qsocket_t -> WebTransportConnection

// Pending incoming connections (for server mode - not used in browser client)
const wt_pendingConnections = [];

// Connection data structure
class WebTransportConnection {

	constructor( transport ) {

		this.transport = transport;

		// Transport protocol:
		// - Reliable bidirectional stream: signon messages, stringcmds
		// - Unreliable datagrams: entity updates, movement
		this.reliableStream = null;
		this.reliableWriter = null;
		this.reliableReader = null;
		this.datagramWriter = null;
		this.datagramReader = null;
		this.maxDatagramSize = 0;

		this.pendingMessages = []; // { reliable: boolean, data: Uint8Array }
		this.connected = false;
		this.error = null;

	}

}

function _isNewerSequence( sequence, current ) {

	return ( ( sequence - current ) | 0 ) > 0;

}

function _WT_BuildSequencedPacket( sock, data, dataLength, forceHeader = false ) {

	if ( forceHeader !== true && ( sock.receiveSequence | 0 ) < 0 ) {

		const legacyPacket = new Uint8Array( dataLength );
		legacyPacket.set( data.subarray( 0, dataLength ), 0 );
		return legacyPacket;

	}

	const packet = new Uint8Array( WT_PACKET_HEADER_BYTES + dataLength );
	const view = new DataView( packet.buffer, packet.byteOffset, packet.byteLength );

	const sequence = sock.sendSequence | 0;
	const acknowledged = sock.receiveSequence | 0;

	packet[ 0 ] = WT_PACKET_MAGIC;
	view.setUint32( 1, sequence >>> 0, true );
	view.setUint32( 5, acknowledged >>> 0, true );
	packet.set( data.subarray( 0, dataLength ), WT_PACKET_HEADER_BYTES );

	sock.sendSequence = ( sequence + 1 ) | 0;

	return packet;

}

function _WT_ParseSequencedPacket( sock, packet, reliable ) {

	if ( packet.length < WT_PACKET_HEADER_BYTES || packet[ 0 ] !== WT_PACKET_MAGIC )
		return packet;

	const view = new DataView( packet.buffer, packet.byteOffset, packet.byteLength );
	const sequence = view.getUint32( 1, true ) | 0;
	const acknowledged = view.getUint32( 5, true ) | 0;

	if ( _isNewerSequence( acknowledged, sock.ackSequence | 0 ) )
		sock.ackSequence = acknowledged;

	const receiveKey = reliable === true ? 'receiveSequence' : 'unreliableReceiveSequence';
	if ( _isNewerSequence( sequence, sock[ receiveKey ] | 0 ) === false )
		return null;

	sock[ receiveKey ] = sequence;
	return packet.subarray( WT_PACKET_HEADER_BYTES );

}

/*
=============
WT_Init

Initialize the WebTransport driver
=============
*/
export function WT_Init() {

	// Check if WebTransport is available in this browser
	if ( typeof WebTransport === 'undefined' ) {

		Con_Printf( 'WebTransport not available in this browser\n' );
		return - 1;

	}

	wt_initialized = true;
	Con_Printf( 'WebTransport driver initialized\n' );

	// Send clean disconnect when page unloads (browser only)
	if ( typeof window !== 'undefined' ) {

		window.addEventListener( 'pagehide', _onPageHide );
		window.addEventListener( 'beforeunload', _onPageHide );

	}

	return 0;

}

/**
 * Handle page unload - send clean disconnect to server
 */
function _onPageHide() {

	for ( const [ sock, conn ] of wt_connections ) {

		try {

			// Send clc_disconnect message before closing
			if ( conn.reliableWriter != null ) {

				const msg = new Uint8Array( 4 );
				msg[ 0 ] = 1; // frame type: game message
				msg[ 1 ] = 1; // length low byte
				msg[ 2 ] = 0; // length high byte
				msg[ 3 ] = 2; // clc_disconnect
				conn.reliableWriter.write( msg );

			}

			// Close the transport (sends QUIC CONNECTION_CLOSE)
			conn.transport.close();

		} catch ( e ) {

			// Ignore errors during shutdown

		}

	}

	wt_connections.clear();

}

/*
=============
WT_Shutdown

Shutdown the WebTransport driver
=============
*/
export function WT_Shutdown() {

	// Close all active connections
	for ( const [ sock, conn ] of wt_connections ) {

		try {

			conn.transport.close();

		} catch ( e ) {

			// Ignore errors during shutdown

		}

	}

	wt_connections.clear();
	wt_initialized = false;

}

/*
=============
WT_Listen

Enable/disable listening for new connections
Browser clients don't listen, only servers do
=============
*/
export function WT_Listen( state ) {

	// Browser clients don't listen for connections
	// This is a no-op on the client side

}

/*
=============
WT_SearchForHosts

Search for available servers
=============
*/
export function WT_SearchForHosts( xmit ) {

	// WebTransport doesn't have broadcast discovery
	// Use WT_QueryRooms instead for server list

}

// Lobby message types (must match server)
const LOBBY_LIST = 0x01;
const LOBBY_JOIN = 0x02;
const LOBBY_CREATE = 0x03;
const LOBBY_ROOMS = 0x81;
const LOBBY_ERROR = 0x82;

/*
=============
WT_QueryRooms

Query available rooms from a WebTransport server
Returns a Promise that resolves to an array of room objects
=============
*/
export async function WT_QueryRooms( serverUrl ) {

	if ( ! wt_initialized ) {

		throw new Error( 'WebTransport not initialized' );

	}

	// Parse the server URL
	let url = serverUrl;

	if ( ! url.includes( '://' ) ) {

		url = 'https://' + url;

	} else if ( url.startsWith( 'wt://' ) ) {

		url = 'https://' + url.substring( 5 );

	} else if ( url.startsWith( 'wts://' ) ) {

		url = 'https://' + url.substring( 6 );

	}

	Con_DPrintf( 'Querying rooms from ' + url + '\n' );

	let transport = null;

	try {

		// Create the WebTransport connection
		transport = new WebTransport( url );
		await transport.ready;

		// Create bidirectional stream
		const stream = await transport.createBidirectionalStream();
		const writer = stream.writable.getWriter();
		const reader = stream.readable.getReader();

		// Send LOBBY_LIST request: [type:1][length:2][data:0]
		const request = new Uint8Array( 3 );
		request[ 0 ] = LOBBY_LIST;
		request[ 1 ] = 0; // length low byte
		request[ 2 ] = 0; // length high byte
		await writer.write( request );

		// Read response header
		const headerResult = await _readExactWithTimeout(
			reader,
			3,
			LOBBY_IO_TIMEOUT_MS,
			'Room list request timed out'
		);
		if ( headerResult === null ) {

			throw new Error( 'Connection closed' );

		}

		const msgType = headerResult[ 0 ];
		const msgLen = headerResult[ 1 ] | ( headerResult[ 2 ] << 8 );

		if ( msgType === LOBBY_ERROR ) {

			const errorMsg = await _readLobbyErrorMessage( reader, msgLen, 'Room list error payload timed out' );
			throw new Error( errorMsg );

		}

		if ( msgType !== LOBBY_ROOMS ) {

			throw new Error( 'Unexpected response type: ' + msgType );

		}

		// Read room data
		let rooms = [];
		if ( msgLen > 0 ) {

			const data = await _readExactWithTimeout(
				reader,
				msgLen,
				LOBBY_IO_TIMEOUT_MS,
				'Room list response timed out'
			);
			if ( data === null ) {

				throw new Error( 'Connection closed' );

			}

			try {

				const json = new TextDecoder().decode( data );
				const parsedRooms = JSON.parse( json );
				if ( Array.isArray( parsedRooms ) === false ) {

					throw new Error( 'Invalid room list response' );

				}
				rooms = parsedRooms;

			} catch ( e ) {

				const parseError = e instanceof Error ? e.message : String( e );
				throw new Error( 'Failed to parse room list: ' + parseError );

			}

		}

		// Clean up
		writer.close().catch( () => {} );
		transport.close();

		Con_DPrintf( 'Got ' + rooms.length + ' rooms\n' );
		return rooms;

	} catch ( e ) {

		Con_Printf( 'WT_QueryRooms error: ' + e.message + '\n' );
		if ( transport ) {

			try { transport.close(); } catch ( e2 ) { /* ignore */ }

		}

		throw e;

	}

}

/*
=============
WT_CreateRoom

Create a new room on the WebTransport server
Returns a Promise that resolves to the room object with ID
=============
*/
export async function WT_CreateRoom( serverUrl, config ) {

	if ( ! wt_initialized ) {

		throw new Error( 'WebTransport not initialized' );

	}

	// Parse the server URL
	let url = serverUrl;

	if ( ! url.includes( '://' ) ) {

		url = 'https://' + url;

	} else if ( url.startsWith( 'wt://' ) ) {

		url = 'https://' + url.substring( 5 );

	} else if ( url.startsWith( 'wts://' ) ) {

		url = 'https://' + url.substring( 6 );

	}

	Con_DPrintf( 'Creating room on ' + url + '\n' );

	let transport = null;

	try {

		// Create the WebTransport connection
		transport = new WebTransport( url );
		await transport.ready;

		// Create bidirectional stream
		const stream = await transport.createBidirectionalStream();
		const writer = stream.writable.getWriter();
		const reader = stream.readable.getReader();

		// Send LOBBY_CREATE request: [type:1][length:2][json config]
		const configJson = JSON.stringify( config );
		const configData = new TextEncoder().encode( configJson );
		const request = new Uint8Array( 3 + configData.length );
		request[ 0 ] = LOBBY_CREATE;
		request[ 1 ] = configData.length & 0xff;
		request[ 2 ] = ( configData.length >> 8 ) & 0xff;
		request.set( configData, 3 );
		await writer.write( request );

		// Read response header
		const headerResult = await _readExactWithTimeout(
			reader,
			3,
			LOBBY_IO_TIMEOUT_MS,
			'Room creation timed out'
		);
		if ( headerResult === null ) {

			throw new Error( 'Connection closed' );

		}

		const msgType = headerResult[ 0 ];
		const msgLen = headerResult[ 1 ] | ( headerResult[ 2 ] << 8 );

		if ( msgType === LOBBY_ERROR ) {

			const errorMsg = await _readLobbyErrorMessage( reader, msgLen, 'Room create error payload timed out' );
			throw new Error( errorMsg );

		}

		// Expect LOBBY_ROOMS response with the created room
		if ( msgType !== LOBBY_ROOMS ) {

			throw new Error( 'Unexpected response type: ' + msgType );

		}

		// Read room data
		let room = null;
		if ( msgLen <= 0 ) {

			throw new Error( 'Server returned empty room response' );

		}

		const data = await _readExactWithTimeout(
			reader,
			msgLen,
			LOBBY_IO_TIMEOUT_MS,
			'Room create response timed out'
		);
		if ( data === null ) {

			throw new Error( 'Connection closed' );

		}

		try {

			const json = new TextDecoder().decode( data );
			const parsed = JSON.parse( json );

			// Legacy server compatibility: older builds returned a room list
			// instead of the created room object.
			if ( Array.isArray( parsed ) === true ) {

				if ( parsed.length <= 0 ) {

					throw new Error( 'Server returned an empty room list' );

				}

				const newestRoom = parsed[ parsed.length - 1 ];
				room = newestRoom;

			} else {

				room = parsed;

			}

		} catch ( e ) {

			const parseError = e instanceof Error ? e.message : String( e );
			throw new Error( 'Failed to parse room create response: ' + parseError );

		}

		if ( room == null || typeof room !== 'object' || typeof room.id !== 'string' || room.id.length <= 0 ) {

			throw new Error( 'Invalid room response from server' );

		}

		// Clean up
		writer.close().catch( () => {} );
		transport.close();

		Con_Printf( 'Created room: ' + room.id + '\n' );
		return room;

	} catch ( e ) {

		Con_Printf( 'WT_CreateRoom error: ' + e.message + '\n' );
		if ( transport ) {

			try { transport.close(); } catch ( e2 ) { /* ignore */ }

		}

		throw e;

	}

}

/*
=============
_readExact

Read exactly n bytes from a stream reader
=============
*/
// Per-reader buffer state (shared global buffer breaks concurrent lobby requests)
const _lobbyReaderBuffers = new WeakMap();

function _getLobbyReaderBuffer( reader ) {

	let buf = _lobbyReaderBuffers.get( reader );
	if ( buf == null ) {

		buf = { data: null, offset: 0 };
		_lobbyReaderBuffers.set( reader, buf );

	}

	return buf;

}

function _timeoutAfter( timeoutMs, timeoutMessage ) {

	return new Promise( ( _, reject ) => {

		setTimeout( () => reject( new Error( timeoutMessage ) ), timeoutMs );

	} );

}

async function _readExactWithTimeout( reader, n, timeoutMs, timeoutMessage ) {

	return await Promise.race( [
		_readExact( reader, n ),
		_timeoutAfter( timeoutMs, timeoutMessage )
	] );

}

async function _readLobbyErrorMessage( reader, msgLen, timeoutMessage ) {

	if ( msgLen <= 0 ) {

		return 'Lobby request failed';

	}

	const errorData = await _readExactWithTimeout( reader, msgLen, LOBBY_IO_TIMEOUT_MS, timeoutMessage );
	if ( errorData === null ) {

		return 'Lobby request failed';

	}

	const errorMsg = new TextDecoder().decode( errorData ).trim();
	if ( errorMsg.length <= 0 ) {

		return 'Lobby request failed';

	}

	return errorMsg;

}

async function _readExact( reader, n ) {

	const result = new Uint8Array( n );
	let offset = 0;
	const buf = _getLobbyReaderBuffer( reader );

	// First, use any leftover bytes from previous read
	if ( buf.data !== null && buf.offset < buf.data.length ) {

		const available = buf.data.length - buf.offset;
		const bytesToCopy = Math.min( available, n );
		result.set( buf.data.subarray( buf.offset, buf.offset + bytesToCopy ), 0 );
		offset = bytesToCopy;
		buf.offset += bytesToCopy;

		// Clear buffer if fully consumed
		if ( buf.offset >= buf.data.length ) {

			buf.data = null;
			buf.offset = 0;

		}

	}

	// Read more if needed
	while ( offset < n ) {

		const { value, done } = await reader.read();
		if ( done ) {

			return null;

		}
		if ( value == null ) {

			return null;

		}

		const bytesToCopy = Math.min( value.length, n - offset );
		result.set( value.subarray( 0, bytesToCopy ), offset );
		offset += bytesToCopy;

		// Save leftover bytes for next read
		if ( bytesToCopy < value.length ) {

			buf.data = value;
			buf.offset = bytesToCopy;

		}

	}

	return result;

}

/*
=============
WT_Connect

Connect to a remote server via WebTransport
host can be:
  - "wt://hostname:port" or "wts://hostname:port"
  - "hostname:port" (defaults to wts://)
  - Full URL like "https://hostname:port/quake"
  - URL with room parameter: "https://hostname:port?room=ROOMID"
=============
*/
export async function WT_Connect( host ) {

	if ( ! wt_initialized ) {

		Con_Printf( 'WebTransport not initialized\n' );
		return null;

	}

	// Parse the host string to build the WebTransport URL
	let url = host;

	if ( ! url.includes( '://' ) ) {

		// Default to HTTPS (required for WebTransport)
		url = 'https://' + url;

	} else if ( url.startsWith( 'wt://' ) ) {

		// Convert wt:// to https://
		url = 'https://' + url.substring( 5 );

	} else if ( url.startsWith( 'wts://' ) ) {

		// Convert wts:// to https://
		url = 'https://' + url.substring( 6 );

	}

	// Extract room ID from URL if present
	let roomId = null;
	try {

		const urlObj = new URL( url );
		roomId = urlObj.searchParams.get( 'room' );
		// Remove room param from URL for the actual connection
		// (we send it via the lobby protocol instead)
		if ( roomId ) {

			urlObj.searchParams.delete( 'room' );
			url = urlObj.toString();

		}

	} catch ( e ) {

		// URL parsing failed, continue without room extraction

	}

	Con_Printf( 'WebTransport connecting to ' + url + ( roomId ? ' (room: ' + roomId + ')' : '' ) + '\n' );

	// Direct room server connection (no lobby join parameter) should not
	// open an initial throwaway transport. Doing so creates a ghost server
	// client that times out later and can wedge unreliable datagram sends.
	if ( roomId == null ) {

		Con_Printf( 'No room ID, using direct connection\n' );
		return await _WT_ConnectDirect( url, host );

	}

	try {

		// Create the WebTransport connection
		const transport = new WebTransport( url );

		// Wait for connection to be ready
		await transport.ready;

		Con_Printf( 'WebTransport connection established\n' );

		// Create a new socket
		const sock = NET_NewQSocket();
		if ( ! sock ) {

			Con_Printf( 'WT_Connect: no free sockets\n' );
			transport.close();
			return null;

		}

		sock.address = host;
		sock.driver = net_driverlevel;

		// Create connection data
		const conn = new WebTransportConnection( transport );
		conn.connected = true;

		// Create bidirectional stream for lobby protocol
		conn.reliableStream = await transport.createBidirectionalStream();
		conn.reliableWriter = conn.reliableStream.writable.getWriter();
		conn.reliableReader = conn.reliableStream.readable.getReader();

		// If joining a room, send LOBBY_JOIN message first
		if ( roomId ) {

			Con_Printf( 'Sending LOBBY_JOIN for room: ' + roomId + '\n' );
			const roomData = new TextEncoder().encode( roomId );
			const request = new Uint8Array( 3 + roomData.length );
			request[ 0 ] = LOBBY_JOIN;
			request[ 1 ] = roomData.length & 0xff;
			request[ 2 ] = ( roomData.length >> 8 ) & 0xff;
			request.set( roomData, 3 );
			await conn.reliableWriter.write( request );
			Con_Printf( 'LOBBY_JOIN sent\n' );

			// Read first framed message - could be LOBBY_ERROR, LOBBY_ROOMS (redirect), or game data
			// Use a race with timeout in case server is slow
			const firstMsg = await Promise.race( [
				_WT_ReadFramedMessageWithType( conn.reliableReader ),
				new Promise( resolve => setTimeout( () => resolve( null ), ROOM_JOIN_TIMEOUT_MS ) )
			] );

			// Handle timeout - server didn't respond in time
			if ( firstMsg === null ) {

				Con_Printf( 'Room join timed out after %d seconds\n', ROOM_JOIN_TIMEOUT_MS / 1000 );
				transport.close();
				NET_FreeQSocket( sock );

				// Clear room from URL so refresh doesn't retry
				if ( typeof history !== 'undefined' ) {

					const cleanUrl = window.location.origin + window.location.pathname;
					history.replaceState( null, '', cleanUrl );

				}

				// Return to Join Game menu with error message
				set_key_dest( key_menu );
				M_ConnectionError( 'Connection timed out - server may be offline' );

				return null;

			}

			if ( firstMsg.type === LOBBY_ERROR ) {

				const errMsg = new TextDecoder().decode( firstMsg.data );
				Con_Printf( 'Join failed: ' + errMsg + '\n' );
				transport.close();
				NET_FreeQSocket( sock );

				// Clear room from URL so refresh doesn't retry
				if ( typeof history !== 'undefined' ) {

					const cleanUrl = window.location.origin + window.location.pathname;
					history.replaceState( null, '', cleanUrl );

				}

				// Return to Join Game menu with error message
				set_key_dest( key_menu );
				M_ConnectionError( errMsg );

				return null;

			}

			// Check if lobby is redirecting us to a room server
			if ( firstMsg.type === LOBBY_ROOMS && firstMsg.data && firstMsg.data.length > 0 ) {

				try {

					const roomInfo = JSON.parse( new TextDecoder().decode( firstMsg.data ) );
					if ( roomInfo.port ) {

						// Close lobby connection and redirect to room server
						Con_Printf( 'Redirecting to room server on port ' + roomInfo.port + '\n' );
						transport.close();
						NET_FreeQSocket( sock );

						// Build new URL with room's port (no room parameter - direct connection)
						const urlObj = new URL( url );
						urlObj.port = String( roomInfo.port );
						const roomUrl = urlObj.toString();

						// Connect directly to room server
						return await _WT_ConnectDirect( roomUrl, host, roomId );

					}

				} catch ( e ) {

					Con_Printf( 'Failed to parse room redirect: ' + e.message + '\n' );

				}

			}

			// Server responded but didn't redirect - use same-port direct connection
			// Close lobby connection and reconnect with game transport protocol
			Con_Printf( 'Room on same port, reconnecting...\n' );
			transport.close();
			NET_FreeQSocket( sock );
			return await _WT_ConnectDirect( url, host, roomId );

		}

		} catch ( error ) {

		Con_Printf( 'WebTransport connect failed: ' + error.message + '\n' );

		// Clear room from URL so refresh doesn't retry
		if ( typeof history !== 'undefined' ) {

			const cleanUrl = window.location.origin + window.location.pathname;
			history.replaceState( null, '', cleanUrl );

		}

		// Return to main menu
		M_Menu_Main_f();
		set_key_dest( key_menu );

		return null;

	}

}

/*
=============
_WT_ConnectDirect

Connect directly to a room server (no lobby protocol)
Used when redirected from lobby to a room server on a different port

Transport protocol:
- Reliable stream: [length:2][transport_packet]
- Unreliable datagrams: transport_packet
  transport_packet: [magic:1][sequence:4][ack:4][quake_payload...]
=============
*/
async function _WT_ConnectDirect( url, originalHost, roomId = null ) {

	Con_Printf( 'WebTransport connecting directly to ' + url + '\n' );

	try {

		// Create the WebTransport connection
		const transport = new WebTransport( url );

		// Wait for connection to be ready
		await transport.ready;

		Con_Printf( 'WebTransport direct connection established\n' );

		// Create a new socket
		const sock = NET_NewQSocket();
		if ( ! sock ) {

			Con_Printf( '_WT_ConnectDirect: no free sockets\n' );
			transport.close();
			return null;

		}

		sock.address = originalHost;
		sock.driver = net_driverlevel;
		sock.sendSequence = 0;
		sock.receiveSequence = - 1;
		sock.unreliableReceiveSequence = - 1;
		sock.ackSequence = - 1;

		// Create connection data
		const conn = new WebTransportConnection( transport );
		conn.connected = true;

		// Reliable stream: signon messages, stringcmds
		conn.reliableStream = await transport.createBidirectionalStream();
		conn.reliableWriter = conn.reliableStream.writable.getWriter();
		conn.reliableReader = conn.reliableStream.readable.getReader();
		Con_Printf( 'Reliable stream ready\n' );

		// Unreliable channel: WebTransport datagrams
		if ( transport.datagrams == null ) {

			throw new Error( 'WebTransport datagrams unavailable' );

		}
		conn.datagramWriter = transport.datagrams.writable.getWriter();
		conn.datagramReader = transport.datagrams.readable.getReader();
		const maxDatagramSize = transport.datagrams.maxDatagramSize;
		if ( typeof maxDatagramSize === 'number' ) {

			conn.maxDatagramSize = maxDatagramSize;

		}
		Con_Printf( 'Datagram channel ready\n' );

		// Store connection
		sock.driverdata = conn;
		wt_connections.set( sock, conn );

		// Start background stream readers
		_WT_StartBackgroundReaders( sock, conn );

		// Handle connection close
		// Per original Quake design: don't set sock.disconnected here
		// Only set conn.connected = false, which makes WT_QGetMessage return -1
		// This triggers proper cleanup via Host_Error -> CL_Disconnect -> NET_Close
		transport.closed.then( () => {

			Con_Printf( 'WebTransport connection closed\n' );
			conn.connected = false;
			// Note: Don't set sock.disconnected - that's only set by NET_FreeQSocket

		} ).catch( ( error ) => {

			Con_Printf( 'WebTransport connection error: ' + error.message + '\n' );
			conn.connected = false;
			conn.error = error;
			// Note: Don't set sock.disconnected - that's only set by NET_FreeQSocket

		} );

		// Update URL with room parameter for easy sharing
		if ( roomId != null && typeof window !== 'undefined' ) {

			const newUrl = window.location.pathname + '?room=' + roomId;
			history.replaceState( null, '', newUrl );

		}

		return sock;

	} catch ( error ) {

		Con_Printf( 'WebTransport direct connect failed: ' + error.message + '\n' );

		// Clear room from URL so refresh doesn't retry
		if ( typeof history !== 'undefined' ) {

			const cleanUrl = window.location.origin + window.location.pathname;
			history.replaceState( null, '', cleanUrl );

		}

		// Return to main menu
		M_Menu_Main_f();
		set_key_dest( key_menu );

		return null;

	}

}

/*
=============
_WT_StartBackgroundReaders

Start background readers for reliable stream + unreliable datagrams
=============
*/
function _WT_StartBackgroundReaders( sock, conn ) {

	Con_Printf( 'Starting reliable stream and datagram readers...\n' );

	// Reliable stream reader
	( async () => {

		let buffer = new Uint8Array( 0 );

		try {

			while ( conn.connected && conn.reliableReader ) {

				const { value, done } = await conn.reliableReader.read();
				if ( done || value === undefined || value.length === 0 ) break;

				// Append to buffer
				const newBuffer = new Uint8Array( buffer.length + value.length );
				newBuffer.set( buffer );
				newBuffer.set( value, buffer.length );
				buffer = newBuffer;

				// Process complete frames: [length:2][data...]
				while ( buffer.length >= 2 ) {

					const length = buffer[ 0 ] | ( buffer[ 1 ] << 8 );
					if ( buffer.length < 2 + length ) break;

					const data = buffer.subarray( 2, 2 + length );
					buffer = buffer.subarray( 2 + length );

					conn.pendingMessages.push( { reliable: true, data: new Uint8Array( data ) } );

				}

			}

		} catch ( error ) {

			if ( conn.connected ) {

				Con_DPrintf( 'Reliable reader error: ' + error.message + '\n' );

			}

		}

	} )();

	// Unreliable datagram reader
	( async () => {

		try {

			while ( conn.connected && conn.datagramReader ) {

				const { value, done } = await conn.datagramReader.read();
				if ( done ) break;
				if ( value === undefined || value.length === 0 ) continue;

				conn.pendingMessages.push( { reliable: false, data: new Uint8Array( value ) } );

			}

		} catch ( error ) {

			if ( conn.connected ) {

				Con_DPrintf( 'Datagram reader error: ' + error.message + '\n' );

			}

		}

	} )();

}

/*
=============
_WT_ReadFramedMessage

Read a framed message from the reliable stream
Frame format: [type:1][length:2][data:N]
=============
*/
async function _WT_ReadFramedMessage( reader ) {

	// Read header (3 bytes: type + length)
	const header = await _WT_ReadExact( reader, 3 );
	if ( ! header ) return null;

	const type = header[ 0 ];
	const length = header[ 1 ] | ( header[ 2 ] << 8 );

	if ( length === 0 ) return new Uint8Array( 0 );

	// Read message data
	const data = await _WT_ReadExact( reader, length );
	return data;

}

/*
=============
_WT_ReadFramedMessageWithType

Read a framed message and return both type and data
=============
*/
async function _WT_ReadFramedMessageWithType( reader ) {

	// Read header (3 bytes: type + length)
	const header = await _WT_ReadExact( reader, 3 );
	if ( ! header ) return null;

	const type = header[ 0 ];
	const length = header[ 1 ] | ( header[ 2 ] << 8 );

	if ( length === 0 ) return { type, data: new Uint8Array( 0 ) };

	// Read message data
	const data = await _WT_ReadExact( reader, length );
	if ( ! data ) return null;

	return { type, data };

}

/*
=============
_WT_ReadExact

Read exactly n bytes from a reader, with buffering for leftover bytes
=============
*/
// Per-reader buffer storage (WeakMap to avoid memory leaks)
const _wtReaderBuffers = new WeakMap();

function _getWTReaderBuffer( reader ) {

	let buf = _wtReaderBuffers.get( reader );
	if ( ! buf ) {

		buf = { data: null, offset: 0 };
		_wtReaderBuffers.set( reader, buf );

	}
	return buf;

}

async function _WT_ReadExact( reader, n ) {

	const result = new Uint8Array( n );
	let offset = 0;
	const buf = _getWTReaderBuffer( reader );

	// First, use any leftover bytes from previous read
	if ( buf.data && buf.offset < buf.data.length ) {

		const available = buf.data.length - buf.offset;
		const bytesToCopy = Math.min( available, n );
		result.set( buf.data.subarray( buf.offset, buf.offset + bytesToCopy ), 0 );
		offset = bytesToCopy;
		buf.offset += bytesToCopy;

		// Clear buffer if fully consumed
		if ( buf.offset >= buf.data.length ) {

			buf.data = null;
			buf.offset = 0;

		}

	}

	// Read more if needed
	while ( offset < n ) {

		const { value, done } = await reader.read();
		if ( done ) return null;

		const bytesToCopy = Math.min( value.length, n - offset );
		result.set( value.subarray( 0, bytesToCopy ), offset );
		offset += bytesToCopy;

		// Save leftover bytes for next read
		if ( bytesToCopy < value.length ) {

			buf.data = value;
			buf.offset = bytesToCopy;

		}

	}

	return result;

}

/*
=============
WT_CheckNewConnections

Check for new incoming connections (server-side only)
=============
*/
export function WT_CheckNewConnections() {

	// Browser clients don't accept connections
	return null;

}

/*
=============
WT_QGetMessage

Get a message from the connection
Returns:
  0 = no message
  1 = reliable message
  2 = unreliable message
  -1 = error
=============
*/
export function WT_QGetMessage( sock ) {

	const conn = sock.driverdata;
	if ( ! conn ) {

		return - 1;

	}

	if ( ! conn.connected && conn.pendingMessages.length === 0 ) {

		return - 1;

	}

	while ( conn.pendingMessages.length > 0 ) {

		// Get next message
		let msg = conn.pendingMessages.shift();

		// For unreliable messages, skip to the most recent one.
		// In original Quake, unreliable messages are overwritten by newer ones.
		// The WebTransport datagram reader queues all datagrams, so if the
		// sender is faster than the reader, stale messages pile up.
		if ( msg.reliable === false ) {

			while ( conn.pendingMessages.length > 0 ) {

				const next = conn.pendingMessages[ 0 ];
				if ( next.reliable ) break; // Stop at next reliable message
				conn.pendingMessages.shift();
				msg = next; // Use newer unreliable message

			}

		}

		const payload = _WT_ParseSequencedPacket( sock, msg.data, msg.reliable );
		if ( payload == null )
			continue;

		// Copy to net_message
		SZ_Clear( net_message );
		SZ_Write( net_message, payload, payload.length );

		sock.lastMessageTime = performance.now() / 1000;

		return msg.reliable ? 1 : 2;

	}

	if ( conn.connected )
		return 0;

	return - 1;

}

/*
=============
WT_QSendMessage

Send a reliable message via the reliable stream.
Frame format: [length:2][data...]
QUIC streams handle ordering and retransmission.
=============
*/
export function WT_QSendMessage( sock, data ) {

	const conn = sock.driverdata;
	if ( conn == null || ! conn.connected ) return - 1;

	// Check for previous async error (detected on last call)
	if ( conn.error != null ) {

		Con_DPrintf( 'WT_QSendMessage: previous error detected, connection dead\n' );
		conn.connected = false;
		return - 1;

	}

	if ( conn.reliableWriter == null ) {

		Con_DPrintf( 'WT_QSendMessage: no reliableWriter\n' );
		return - 1;

	}

	// Frame the message: [length:2][data...]
	const packet = _WT_BuildSequencedPacket( sock, data.data, data.cursize, true );
	const frame = new Uint8Array( 2 + packet.length );
	frame[ 0 ] = packet.length & 0xff;
	frame[ 1 ] = ( packet.length >> 8 ) & 0xff;
	frame.set( packet, 2 );

	// Send asynchronously - QUIC handles reliability
	conn.reliableWriter.write( frame ).catch( ( error ) => {

		Con_Printf( 'WT_QSendMessage error: ' + error.message + '\n' );
		conn.connected = false;
		conn.error = error;

	} );

	return 1;

}

/*
=============
WT_SendUnreliableMessage

Send an unreliable message via WebTransport datagrams.
=============
*/
export function WT_SendUnreliableMessage( sock, data ) {

	const conn = sock.driverdata;
	if ( conn == null || ! conn.connected ) {

		Con_DPrintf( 'WT_SendUnreliableMessage: no connection\n' );
		return - 1;

	}

	// Check for previous async error
	if ( conn.error != null ) {

		Con_DPrintf( 'WT_SendUnreliableMessage: previous error detected\n' );
		return - 1;

	}

	// Stability fallback: send client commands on reliable stream.
	if ( USE_CLIENT_OUTBOUND_DATAGRAMS !== true ) {

		return WT_QSendMessage( sock, data );

	}

	if ( conn.datagramWriter == null ) {

		Con_DPrintf( 'WT_SendUnreliableMessage: no datagramWriter\n' );
		return - 1;

	}

	const packet = _WT_BuildSequencedPacket( sock, data.data, data.cursize, true );

	if ( conn.maxDatagramSize > 0 && packet.length > conn.maxDatagramSize ) {

		// Datagram too large for current path MTU — drop unreliable payload.
		return 1;

	}

	// Send via unreliable datagrams
	conn.datagramWriter.write( packet ).catch( () => {

		// Unreliable — silently fail

	} );

	return 1;

}

/*
=============
WT_CanSendMessage

Check if we can send a reliable message
=============
*/
export function WT_CanSendMessage( sock ) {

	const conn = sock.driverdata;
	if ( ! conn ) return false;

	return conn.connected && conn.reliableWriter != null;

}

/*
=============
WT_CanSendUnreliableMessage

Check if we can send an unreliable message
=============
*/
export function WT_CanSendUnreliableMessage( sock ) {

	const conn = sock.driverdata;
	if ( ! conn ) return false;

	if ( USE_CLIENT_OUTBOUND_DATAGRAMS !== true ) {

		return WT_CanSendMessage( sock );

	}

	return conn.connected && conn.datagramWriter != null;

}

/*
=============
WT_Close

Close a connection
=============
*/
export function WT_Close( sock ) {

	const conn = sock.driverdata;
	if ( ! conn ) return;

	conn.connected = false;

	try {

		// Cancel stream readers first to unblock pending reads
		if ( conn.reliableReader ) {

			conn.reliableReader.cancel().catch( () => {} );
			conn.reliableReader = null;

		}

		if ( conn.datagramReader ) {

			conn.datagramReader.cancel().catch( () => {} );
			conn.datagramReader = null;

		}

		// Release stream writers
		if ( conn.reliableWriter ) {

			conn.reliableWriter.close().catch( () => {} );
			conn.reliableWriter = null;

		}

		if ( conn.datagramWriter ) {

			conn.datagramWriter.releaseLock();
			conn.datagramWriter = null;

		}

		// Close the transport
		conn.transport.close();

	} catch ( error ) {

		// Ignore errors during close

	}

	wt_connections.delete( sock );
	sock.driverdata = null;

}

/*
=============
WT_GetAnyMessage

Used for control messages during connection
=============
*/
export function WT_GetAnyMessage() {

	// Not used for WebTransport
	return 0;

}
