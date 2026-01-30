// Ported from: WinQuake/net_main.c -- network main module

import { Sys_Error, Sys_FloatTime } from './sys.js';
import { Con_Printf, Con_DPrintf, SZ_Alloc, SZ_Clear, COM_CheckParm, com_argc, com_argv, Q_atoi, sizebuf_t, COM_SetNetMessage } from './common.js';
import { Cmd_AddCommand, Cmd_Argc, Cmd_Argv, Cbuf_AddText } from './cmd.js';
import { cvar_t, Cvar_RegisterVariable, Cvar_Set } from './cvar.js';
import {
	NET_NAMELEN, NET_MAXMESSAGE, MAX_NET_DRIVERS,
	qsocket_t,
	net_activeSockets, net_freeSockets, net_numsockets,
	set_net_activeSockets, set_net_freeSockets, set_net_numsockets,
	net_numdrivers, set_net_numdrivers,
	net_drivers,
	net_numlandrivers, net_landrivers,
	DEFAULTnet_hostport, net_hostport,
	set_DEFAULTnet_hostport, set_net_hostport,
	net_driverlevel, set_net_driverlevel,
	net_time, set_net_time,
	net_message,
	net_activeconnections, set_net_activeconnections,
	hostCacheCount, set_hostCacheCount,
	hostcache, HOSTCACHESIZE,
	slistInProgress, slistSilent, slistLocal,
	set_slistInProgress, set_slistSilent, set_slistLocal,
	PollProcedure
} from './net.js';
import { sv } from './server.js';
import { svs } from './server.js';
import {
	Loop_Init, Loop_Shutdown, Loop_Listen,
	Loop_SearchForHosts, Loop_Connect, Loop_CheckNewConnections,
	Loop_GetMessage, Loop_SendMessage, Loop_SendUnreliableMessage,
	Loop_CanSendMessage, Loop_CanSendUnreliableMessage, Loop_Close
} from './net_loop.js';
import { MAX_SCOREBOARD } from './quakedef.js';

//============================================================================
// Module-level state
//============================================================================

let listening = false;

let slistStartTime = 0;
let slistLastShown = 0;

const net_messagetimeout = new cvar_t( 'net_messagetimeout', '300' );
export const hostname = new cvar_t( 'hostname', 'UNNAMED' );

let configRestored = false;

let pollProcedureList = null;

// macros from C: sfunc = net_drivers[sock.driver], dfunc = net_drivers[net_driverlevel]

/*
===================
SetNetTime
===================
*/
export function SetNetTime() {

	set_net_time( Sys_FloatTime() );
	return net_time;

}

/*
===================
NET_NewQSocket

Called by drivers when a new communications endpoint is required
The sequence and buffer fields will be filled in properly
===================
*/
export function NET_NewQSocket() {

	if ( net_freeSockets === null )
		return null;

	if ( net_activeconnections >= svs.maxclients )
		return null;

	// get one from free list
	const sock = net_freeSockets;
	set_net_freeSockets( sock.next );

	// add it to active list
	sock.next = net_activeSockets;
	set_net_activeSockets( sock );

	sock.disconnected = false;
	sock.connecttime = net_time;
	sock.address = 'UNSET ADDRESS';
	sock.driver = net_driverlevel;
	sock.socket = 0;
	sock.driverdata = null;
	sock.canSend = true;
	sock.sendNext = false;
	sock.lastMessageTime = net_time;
	sock.ackSequence = 0;
	sock.sendSequence = 0;
	sock.unreliableSendSequence = 0;
	sock.sendMessageLength = 0;
	sock.receiveSequence = 0;
	sock.unreliableReceiveSequence = 0;
	sock.receiveMessageLength = 0;

	return sock;

}

/*
===================
NET_FreeQSocket
===================
*/
export function NET_FreeQSocket( sock ) {

	// remove it from active list
	if ( sock === net_activeSockets ) {

		set_net_activeSockets( net_activeSockets.next );

	} else {

		let s = net_activeSockets;
		while ( s ) {

			if ( s.next === sock ) {

				s.next = sock.next;
				break;

			}

			s = s.next;

		}

		if ( ! s )
			Sys_Error( 'NET_FreeQSocket: not active\n' );

	}

	// add it to free list
	sock.next = net_freeSockets;
	set_net_freeSockets( sock );
	sock.disconnected = true;

}

/*
===================
NET_Listen_f
===================
*/
function NET_Listen_f() {

	if ( Cmd_Argc() !== 2 ) {

		Con_Printf( '"listen" is "' + ( listening ? 1 : 0 ) + '"\n' );
		return;

	}

	listening = Q_atoi( Cmd_Argv( 1 ) ) ? true : false;

	for ( let i = 0; i < net_numdrivers; i ++ ) {

		set_net_driverlevel( i );
		if ( net_drivers[ net_driverlevel ].initialized === false )
			continue;
		net_drivers[ net_driverlevel ].Listen( listening );

	}

}

/*
===================
MaxPlayers_f
===================
*/
function MaxPlayers_f() {

	if ( Cmd_Argc() !== 2 ) {

		Con_Printf( '"maxplayers" is "' + svs.maxclients + '"\n' );
		return;

	}

	if ( sv.active ) {

		Con_Printf( 'maxplayers can not be changed while a server is running.\n' );
		return;

	}

	let n = Q_atoi( Cmd_Argv( 1 ) );
	if ( n < 1 )
		n = 1;
	if ( n > svs.maxclientslimit ) {

		n = svs.maxclientslimit;
		Con_Printf( '"maxplayers" set to "' + n + '"\n' );

	}

	if ( ( n === 1 ) && listening )
		Cbuf_AddText( 'listen 0\n' );

	if ( ( n > 1 ) && ( ! listening ) )
		Cbuf_AddText( 'listen 1\n' );

	svs.maxclients = n;
	if ( n === 1 )
		Cvar_Set( 'deathmatch', '0' );
	else
		Cvar_Set( 'deathmatch', '1' );

}

/*
===================
NET_Port_f
===================
*/
function NET_Port_f() {

	if ( Cmd_Argc() !== 2 ) {

		Con_Printf( '"port" is "' + net_hostport + '"\n' );
		return;

	}

	const n = Q_atoi( Cmd_Argv( 1 ) );
	if ( n < 1 || n > 65534 ) {

		Con_Printf( 'Bad value, must be between 1 and 65534\n' );
		return;

	}

	set_DEFAULTnet_hostport( n );
	set_net_hostport( n );

	if ( listening ) {

		// force a change to the new port
		Cbuf_AddText( 'listen 0\n' );
		Cbuf_AddText( 'listen 1\n' );

	}

}

/*
===================
PrintSlistHeader
===================
*/
function PrintSlistHeader() {

	Con_Printf( 'Server          Map             Users\n' );
	Con_Printf( '--------------- --------------- -----\n' );
	slistLastShown = 0;

}

/*
===================
PrintSlist
===================
*/
function PrintSlist() {

	for ( let n = slistLastShown; n < hostCacheCount; n ++ ) {

		if ( hostcache[ n ].maxusers )
			Con_Printf( hostcache[ n ].name + ' ' + hostcache[ n ].map + ' ' + hostcache[ n ].users + '/' + hostcache[ n ].maxusers + '\n' );
		else
			Con_Printf( hostcache[ n ].name + ' ' + hostcache[ n ].map + '\n' );

	}

	slistLastShown = hostCacheCount;

}

/*
===================
PrintSlistTrailer
===================
*/
function PrintSlistTrailer() {

	if ( hostCacheCount )
		Con_Printf( '== end list ==\n\n' );
	else
		Con_Printf( 'No Quake servers found.\n\n' );

}

/*
===================
NET_Slist_f
===================
*/
export function NET_Slist_f() {

	if ( slistInProgress )
		return;

	if ( ! slistSilent ) {

		Con_Printf( 'Looking for Quake servers...\n' );
		PrintSlistHeader();

	}

	set_slistInProgress( true );
	slistStartTime = Sys_FloatTime();

	SchedulePollProcedure( slistSendProcedure, 0.0 );
	SchedulePollProcedure( slistPollProcedure, 0.1 );

	set_hostCacheCount( 0 );

}

/*
===================
Slist_Send
===================
*/
function Slist_Send() {

	for ( let i = 0; i < net_numdrivers; i ++ ) {

		set_net_driverlevel( i );
		if ( ! slistLocal && net_driverlevel === 0 )
			continue;
		if ( net_drivers[ net_driverlevel ].initialized === false )
			continue;
		net_drivers[ net_driverlevel ].SearchForHosts( true );

	}

	if ( ( Sys_FloatTime() - slistStartTime ) < 0.5 )
		SchedulePollProcedure( slistSendProcedure, 0.75 );

}

/*
===================
Slist_Poll
===================
*/
function Slist_Poll() {

	for ( let i = 0; i < net_numdrivers; i ++ ) {

		set_net_driverlevel( i );
		if ( ! slistLocal && net_driverlevel === 0 )
			continue;
		if ( net_drivers[ net_driverlevel ].initialized === false )
			continue;
		net_drivers[ net_driverlevel ].SearchForHosts( false );

	}

	if ( ! slistSilent )
		PrintSlist();

	if ( ( Sys_FloatTime() - slistStartTime ) < 1.5 ) {

		SchedulePollProcedure( slistPollProcedure, 0.1 );
		return;

	}

	if ( ! slistSilent )
		PrintSlistTrailer();
	set_slistInProgress( false );
	set_slistSilent( false );
	set_slistLocal( true );

}

const slistSendProcedure = new PollProcedure( null, 0.0, Slist_Send );
const slistPollProcedure = new PollProcedure( null, 0.0, Slist_Poll );

/*
===================
WT_QueryRooms

Stub for WebTorrent room query functionality
===================
*/
export function WT_QueryRooms() {

	// WebTorrent multiplayer not yet implemented

}

/*
===================
WT_CreateRoom

Stub for WebTorrent room creation functionality
===================
*/
export function WT_CreateRoom() {

	// WebTorrent multiplayer not yet implemented

}

/*
===================
NET_Connect
===================
*/
export function NET_Connect( host ) {

	SetNetTime();

	if ( host && host.length === 0 )
		host = null;

	if ( host ) {

		if ( host.toLowerCase() === 'local' ) {

			// only use loopback driver
			set_net_driverlevel( 0 );
			if ( net_drivers[ 0 ].initialized === false )
				return null;
			const ret = net_drivers[ 0 ].Connect( host );
			return ret;

		}

		if ( hostCacheCount ) {

			for ( let n = 0; n < hostCacheCount; n ++ ) {

				if ( host.toLowerCase() === hostcache[ n ].name.toLowerCase() ) {

					host = hostcache[ n ].cname;
					break;

				}

			}

		}

	}

	// For browser, just do a direct connect attempt
	for ( let i = 0; i < net_numdrivers; i ++ ) {

		set_net_driverlevel( i );
		if ( net_drivers[ net_driverlevel ].initialized === false )
			continue;
		const ret = net_drivers[ net_driverlevel ].Connect( host );
		if ( ret )
			return ret;

	}

	return null;

}

/*
===================
NET_CheckNewConnections
===================
*/
export function NET_CheckNewConnections() {

	SetNetTime();

	for ( let i = 0; i < net_numdrivers; i ++ ) {

		set_net_driverlevel( i );
		if ( net_drivers[ net_driverlevel ].initialized === false )
			continue;
		if ( net_driverlevel && listening === false )
			continue;
		const ret = net_drivers[ net_driverlevel ].CheckNewConnections();
		if ( ret ) {

			return ret;

		}

	}

	return null;

}

/*
===================
NET_Close
===================
*/
export function NET_Close( sock ) {

	if ( ! sock )
		return;

	if ( sock.disconnected )
		return;

	SetNetTime();

	// call the driver_Close function
	net_drivers[ sock.driver ].Close( sock );

	NET_FreeQSocket( sock );

}

/*
=================
NET_GetMessage

If there is a complete message, return it in net_message

returns 0 if no data is waiting
returns 1 if a message was received
returns 2 if an unreliable message was received
returns -1 if connection is invalid
=================
*/
export function NET_GetMessage( sock ) {

	if ( ! sock )
		return - 1;

	if ( sock.disconnected ) {

		Con_Printf( 'NET_GetMessage: disconnected socket\n' );
		return - 1;

	}

	SetNetTime();

	const ret = net_drivers[ sock.driver ].QGetMessage( sock );

	// see if this connection has timed out
	if ( ret === 0 && sock.driver ) {

		if ( net_time - sock.lastMessageTime > net_messagetimeout.value ) {

			NET_Close( sock );
			return - 1;

		}

	}

	if ( ret > 0 ) {

		if ( sock.driver ) {

			sock.lastMessageTime = net_time;
			if ( ret === 1 ) {

				// messagesReceived ++ handled in net.js
				// For now just track locally
			}

		}

	}

	return ret;

}

/*
==================
NET_SendMessage

Try to send a complete length+message unit over the reliable stream.
returns 0 if the message cannot be delivered reliably, but the connection
		is still considered valid
returns 1 if the message was sent properly
returns -1 if the connection died
==================
*/
export function NET_SendMessage( sock, data ) {

	if ( ! sock )
		return - 1;

	if ( sock.disconnected ) {

		Con_Printf( 'NET_SendMessage: disconnected socket\n' );
		return - 1;

	}

	SetNetTime();
	const r = net_drivers[ sock.driver ].QSendMessage( sock, data );

	return r;

}

/*
==================
NET_SendUnreliableMessage
==================
*/
export function NET_SendUnreliableMessage( sock, data ) {

	if ( ! sock )
		return - 1;

	if ( sock.disconnected ) {

		Con_Printf( 'NET_SendMessage: disconnected socket\n' );
		return - 1;

	}

	SetNetTime();
	const r = net_drivers[ sock.driver ].SendUnreliableMessage( sock, data );

	return r;

}

/*
==================
NET_CanSendMessage

Returns true or false if the given qsocket can currently accept a
message to be transmitted.
==================
*/
export function NET_CanSendMessage( sock ) {

	if ( ! sock )
		return false;

	if ( sock.disconnected )
		return false;

	SetNetTime();

	const r = net_drivers[ sock.driver ].CanSendMessage( sock );

	return r;

}

/*
==================
NET_SendToAll

This is a reliable *blocking* send to all attached clients.
==================
*/
export function NET_SendToAll( data, blocktime ) {

	const start = Sys_FloatTime();
	let count = 0;
	const state1 = new Array( MAX_SCOREBOARD ).fill( false );
	const state2 = new Array( MAX_SCOREBOARD ).fill( false );

	for ( let i = 0; i < svs.maxclients; i ++ ) {

		const client = svs.clients[ i ];
		if ( ! client.netconnection )
			continue;
		if ( client.active ) {

			if ( client.netconnection.driver === 0 ) {

				NET_SendMessage( client.netconnection, data );
				state1[ i ] = true;
				state2[ i ] = true;
				continue;

			}

			count ++;
			state1[ i ] = false;
			state2[ i ] = false;

		} else {

			state1[ i ] = true;
			state2[ i ] = true;

		}

	}

	// For browser/loopback, the while loop is essentially instant
	while ( count ) {

		count = 0;
		for ( let i = 0; i < svs.maxclients; i ++ ) {

			const client = svs.clients[ i ];

			if ( ! state1[ i ] ) {

				if ( NET_CanSendMessage( client.netconnection ) ) {

					state1[ i ] = true;
					NET_SendMessage( client.netconnection, data );

				} else {

					NET_GetMessage( client.netconnection );

				}

				count ++;
				continue;

			}

			if ( ! state2[ i ] ) {

				if ( NET_CanSendMessage( client.netconnection ) ) {

					state2[ i ] = true;

				} else {

					NET_GetMessage( client.netconnection );

				}

				count ++;
				continue;

			}

		}

		if ( ( Sys_FloatTime() - start ) > blocktime )
			break;

	}

	return count;

}

/*
====================
NET_Init
====================
*/
export function NET_Init() {

	let i = COM_CheckParm( '-port' );
	if ( ! i )
		i = COM_CheckParm( '-udpport' );
	if ( ! i )
		i = COM_CheckParm( '-ipxport' );

	if ( i ) {

		if ( i < com_argc - 1 )
			set_DEFAULTnet_hostport( Q_atoi( com_argv[ i + 1 ] ) );
		else
			Sys_Error( 'NET_Init: you must specify a number after -port' );

	}

	set_net_hostport( DEFAULTnet_hostport );

	if ( COM_CheckParm( '-listen' ) )
		listening = true;

	set_net_numsockets( svs.maxclientslimit );
	// non-dedicated, add one more for client
	set_net_numsockets( net_numsockets + 1 );

	SetNetTime();

	// allocate qsockets into the free list
	for ( let j = 0; j < net_numsockets; j ++ ) {

		const s = new qsocket_t();
		s.next = net_freeSockets;
		set_net_freeSockets( s );
		s.disconnected = true;

	}

	// allocate space for network message buffer
	SZ_Alloc( net_message, NET_MAXMESSAGE );

	// Share the canonical net_message with common.js (MSG_Read* functions)
	COM_SetNetMessage( net_message );

	Cvar_RegisterVariable( net_messagetimeout );
	Cvar_RegisterVariable( hostname );

	Cmd_AddCommand( 'slist', NET_Slist_f );
	Cmd_AddCommand( 'listen', NET_Listen_f );
	Cmd_AddCommand( 'maxplayers', MaxPlayers_f );
	Cmd_AddCommand( 'port', NET_Port_f );

	// Set up the loopback driver (driver 0) for single-player
	set_net_numdrivers( 1 );
	net_drivers[ 0 ].name = 'Loopback';
	net_drivers[ 0 ].Init = Loop_Init;
	net_drivers[ 0 ].Listen = Loop_Listen;
	net_drivers[ 0 ].SearchForHosts = Loop_SearchForHosts;
	net_drivers[ 0 ].Connect = Loop_Connect;
	net_drivers[ 0 ].CheckNewConnections = Loop_CheckNewConnections;
	net_drivers[ 0 ].QGetMessage = Loop_GetMessage;
	net_drivers[ 0 ].QSendMessage = Loop_SendMessage;
	net_drivers[ 0 ].SendUnreliableMessage = Loop_SendUnreliableMessage;
	net_drivers[ 0 ].CanSendMessage = Loop_CanSendMessage;
	net_drivers[ 0 ].CanSendUnreliableMessage = Loop_CanSendUnreliableMessage;
	net_drivers[ 0 ].Close = Loop_Close;
	net_drivers[ 0 ].Shutdown = Loop_Shutdown;

	// initialize all the drivers
	for ( let d = 0; d < net_numdrivers; d ++ ) {

		set_net_driverlevel( d );
		const controlSocket = net_drivers[ net_driverlevel ].Init();
		if ( controlSocket === - 1 )
			continue;
		net_drivers[ net_driverlevel ].initialized = true;
		net_drivers[ net_driverlevel ].controlSock = controlSocket;
		if ( listening )
			net_drivers[ net_driverlevel ].Listen( true );

	}

	Con_Printf( 'NET_Init complete\n' );

}

/*
====================
NET_Shutdown
====================
*/
export function NET_Shutdown() {

	SetNetTime();

	let sock = net_activeSockets;
	while ( sock ) {

		const next = sock.next;
		NET_Close( sock );
		sock = next;

	}

	// shutdown the drivers
	for ( let i = 0; i < net_numdrivers; i ++ ) {

		set_net_driverlevel( i );
		if ( net_drivers[ net_driverlevel ].initialized === true ) {

			net_drivers[ net_driverlevel ].Shutdown();
			net_drivers[ net_driverlevel ].initialized = false;

		}

	}

}

/*
===================
NET_Poll
===================
*/
export function NET_Poll() {

	configRestored = true;

	SetNetTime();

	let pp = pollProcedureList;
	while ( pp ) {

		if ( pp.nextTime > net_time )
			break;
		pollProcedureList = pp.next;
		pp.procedure( pp.arg );
		pp = pollProcedureList;

	}

}

/*
===================
SchedulePollProcedure
===================
*/
export function SchedulePollProcedure( proc, timeOffset ) {

	proc.nextTime = Sys_FloatTime() + timeOffset;

	let pp = pollProcedureList;
	let prev = null;
	while ( pp ) {

		if ( pp.nextTime >= proc.nextTime )
			break;
		prev = pp;
		pp = pp.next;

	}

	if ( prev === null ) {

		proc.next = pollProcedureList;
		pollProcedureList = proc;
		return;

	}

	proc.next = pp;
	prev.next = proc;

}
