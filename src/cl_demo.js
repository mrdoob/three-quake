// Ported from: WinQuake/cl_demo.c -- demo recording and playback

import { MAX_MSGLEN } from './quakedef.js';
import { Con_Printf, Con_DPrintf, SZ_Clear,
	MSG_WriteByte, MSG_WriteString,
	LittleLong, LittleFloat,
	net_message, COM_DefaultExtension } from './common.js';
import { Sys_Error } from './sys.js';
import { Cmd_Argc, Cmd_Argv, Cmd_ExecuteString, cmd_source, src_command } from './cmd.js';
import { svc_nop, svc_disconnect } from './protocol.js';
import { VectorCopy } from './mathlib.js';
import { SIGNONS, cl, cls, ca_disconnected, ca_connected } from './client.js';
import { CL_Disconnect } from './cl_main.js';
import { host_framecount, realtime } from './host.js';
import { NET_GetMessage } from './net_main.js';
import { COM_FindFile } from './pak.js';

/*
==============================================================================

DEMO CODE

When a demo is playing back, all NET_SendMessages are skipped, and
NET_GetMessages are read from the demo file.

Whenever cl.time gets past the last received message, another message is
read from the demo file.
==============================================================================
*/

/*
==============
CL_StopPlayback

Called when a demo file runs out, or the user starts a game
==============
*/
export function CL_StopPlayback() {

	if ( ! cls.demoplayback )
		return;

	cls.demoplayback = false;
	cls.demofile = null;
	cls.demodata = null;
	cls.demopos = 0;
	cls.state = ca_disconnected;

	if ( cls.timedemo )
		CL_FinishTimeDemo();

}

/*
====================
CL_WriteDemoMessage

Dumps the current net message, prefixed by the length and view angles
====================
*/
// Demo recording buffer state
let demo_buffer = null; // Uint8Array
let demo_buffer_pos = 0;
let demo_name = '';

function DemoBuffer_Init( name ) {

	demo_buffer = new Uint8Array( 65536 );
	demo_buffer_pos = 0;
	demo_name = name;

}

function DemoBuffer_Grow( needed ) {

	if ( demo_buffer_pos + needed <= demo_buffer.length ) return;

	let newSize = demo_buffer.length;
	while ( newSize < demo_buffer_pos + needed ) {

		newSize *= 2;

	}

	const newBuf = new Uint8Array( newSize );
	newBuf.set( demo_buffer );
	demo_buffer = newBuf;

}

function DemoBuffer_WriteBytes( data, offset, length ) {

	DemoBuffer_Grow( length );
	for ( let i = 0; i < length; i ++ ) {

		demo_buffer[ demo_buffer_pos ++ ] = data[ offset + i ];

	}

}

function DemoBuffer_WriteString( str ) {

	DemoBuffer_Grow( str.length );
	for ( let i = 0; i < str.length; i ++ ) {

		demo_buffer[ demo_buffer_pos ++ ] = str.charCodeAt( i );

	}

}

const _demoWriteView = new DataView( new ArrayBuffer( 16 ) );
const _demoWriteBytes = new Uint8Array( _demoWriteView.buffer );

export function CL_WriteDemoMessage() {

	if ( demo_buffer == null )
		return;

	// Write message length (4 bytes, little-endian)
	_demoWriteView.setInt32( 0, net_message.cursize, true );

	// Write view angles (3x4 bytes, little-endian float)
	for ( let i = 0; i < 3; i ++ ) {

		_demoWriteView.setFloat32( 4 + i * 4, cl.viewangles[ i ], true );

	}

	DemoBuffer_WriteBytes( _demoWriteBytes, 0, 16 );

	// Write message data
	DemoBuffer_WriteBytes( net_message.data, 0, net_message.cursize );

}

/*
====================
CL_GetMessage

Handles recording and playback of demos, on top of NET_ code
====================
*/
export function CL_GetMessage() {

	if ( cls.demoplayback ) {

		// decide if it is time to grab the next message
		if ( cls.signon === SIGNONS ) { // allways grab until fully connected

			if ( cls.timedemo ) {

				if ( host_framecount === cls.td_lastframe )
					return 0; // allready read this frame's message
				cls.td_lastframe = host_framecount;
				// if this is the second frame, grab the real td_starttime
				// so the bogus time on the first frame doesn't count
				if ( host_framecount === cls.td_startframe + 1 )
					cls.td_starttime = realtime;

			} else if ( /* cl.time > 0 && */ cl.time <= cl.mtime[ 0 ] ) {

				return 0; // don't need another message yet

			}

		}

		// get the next message from demo data
		if ( ! cls.demodata || cls.demopos >= cls.demodata.length ) {

			CL_StopPlayback();
			return 0;

		}

		// read message length (4 bytes, little-endian)
		if ( cls.demopos + 4 > cls.demodata.length ) {

			CL_StopPlayback();
			return 0;

		}

		const view = new DataView( cls.demodata.buffer, cls.demodata.byteOffset + cls.demopos, 4 );
		net_message.cursize = view.getInt32( 0, true ); // little-endian
		cls.demopos += 4;

		// read view angles (3 floats = 12 bytes)
		VectorCopy( cl.mviewangles[ 0 ], cl.mviewangles[ 1 ] );
		for ( let i = 0; i < 3; i ++ ) {

			if ( cls.demopos + 4 > cls.demodata.length ) {

				CL_StopPlayback();
				return 0;

			}

			const fview = new DataView( cls.demodata.buffer, cls.demodata.byteOffset + cls.demopos, 4 );
			cl.mviewangles[ 0 ][ i ] = fview.getFloat32( 0, true );
			cls.demopos += 4;

		}

		net_message.cursize = LittleLong( net_message.cursize );
		if ( net_message.cursize > MAX_MSGLEN )
			Sys_Error( 'Demo message > MAX_MSGLEN' );

		// read message data
		if ( cls.demopos + net_message.cursize > cls.demodata.length ) {

			CL_StopPlayback();
			return 0;

		}

		// Ensure net_message.data is large enough
		if ( ! net_message.data || net_message.data.length < net_message.cursize )
			net_message.data = new Uint8Array( MAX_MSGLEN );

		for ( let i = 0; i < net_message.cursize; i ++ )
			net_message.data[ i ] = cls.demodata[ cls.demopos + i ];
		cls.demopos += net_message.cursize;

		return 1;

	}

	// Not playing back a demo - get from network
	let r;
	while ( true ) {

		r = NET_GetMessage( cls.netcon );
		if ( r !== 1 && r !== 2 )
			return r;
		// discard nop keepalive message
		if ( net_message.cursize === 1 && net_message.data[ 0 ] === svc_nop )
			Con_Printf( '<-- server to client keepalive\n' );
		else
			break;

	}

	if ( cls.demorecording === true )
		CL_WriteDemoMessage();
	return r;

}

/*
====================
CL_Stop_f

stop recording a demo
====================
*/
export function CL_Stop_f() {

	if ( cmd_source !== src_command )
		return;

	if ( cls.demorecording === false ) {

		Con_Printf( 'Not recording a demo.\n' );
		return;

	}

	// write a disconnect message to the demo file
	SZ_Clear( net_message );
	MSG_WriteByte( net_message, svc_disconnect );
	CL_WriteDemoMessage();

	// download the demo file
	if ( demo_buffer != null && demo_buffer_pos > 0 ) {

		const blob = new Blob( [ demo_buffer.slice( 0, demo_buffer_pos ) ], { type: 'application/octet-stream' } );
		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url;
		a.download = demo_name;
		a.click();
		URL.revokeObjectURL( url );

	}

	// finish up
	demo_buffer = null;
	demo_buffer_pos = 0;
	cls.demofile = null;
	cls.demorecording = false;
	Con_Printf( 'Completed demo\n' );

}

/*
====================
CL_Record_f

record <demoname> <map> [cd track]
====================
*/
export function CL_Record_f() {

	if ( cmd_source !== src_command )
		return;

	const c = Cmd_Argc();
	if ( c !== 2 && c !== 3 && c !== 4 ) {

		Con_Printf( 'record <demoname> [<map> [cd track]]\n' );
		return;

	}

	if ( Cmd_Argv( 1 ).indexOf( '..' ) !== - 1 ) {

		Con_Printf( 'Relative pathnames are not allowed.\n' );
		return;

	}

	if ( c === 2 && cls.state === ca_connected ) {

		Con_Printf( 'Can not record - already connected to server\nClient demo recording must be started before connecting\n' );
		return;

	}

	// write the forced cd track number, or -1
	let track;
	if ( c === 4 ) {

		track = parseInt( Cmd_Argv( 3 ) );
		Con_Printf( 'Forcing CD track to %i\n', track );

	} else
		track = - 1;

	const name = COM_DefaultExtension( Cmd_Argv( 1 ), '.dem' );

	// start the map up
	if ( c > 2 ) {

		Cmd_ExecuteString( 'map ' + Cmd_Argv( 2 ), src_command );

	}

	Con_Printf( 'recording to %s.\n', name );

	// Create in-memory buffer for demo data
	DemoBuffer_Init( name );

	cls.forcetrack = track;

	// Write forced track header (text line)
	DemoBuffer_WriteString( String( cls.forcetrack ) + '\n' );

	cls.demofile = true; // flag that recording is active (checked by CL_WriteDemoMessage)
	cls.demorecording = true;

}

/*
====================
CL_PlayDemo_f

play [demoname]
====================
*/
export function CL_PlayDemo_f() {

	if ( cmd_source !== src_command )
		return;

	if ( Cmd_Argc() !== 2 ) {

		Con_Printf( 'play <demoname> : plays a demo\n' );
		return;

	}

	//
	// disconnect from server
	//
	CL_Disconnect();

	//
	// open the demo file
	//
	let name = Cmd_Argv( 1 );
	name = COM_DefaultExtension( name, '.dem' );

	Con_Printf( 'Playing demo from %s.\n', name );

	const result = COM_FindFile( name );
	if ( ! result ) {

		Con_Printf( 'ERROR: couldn\'t open %s.\n', name );
		cls.demonum = - 1;
		return;

	}

	// Copy to standalone ArrayBuffer (COM_FindFile returns a view into PAK)
	const buf = new ArrayBuffer( result.size );
	new Uint8Array( buf ).set( result.data );
	CL_PlayDemoFromData( buf );

}

/*
====================
CL_PlayDemoFromData

Play a demo from an ArrayBuffer (browser-specific entry point)
====================
*/
export function CL_PlayDemoFromData( data ) {

	CL_Disconnect();

	cls.demodata = new Uint8Array( data );
	cls.demopos = 0;

	cls.demoplayback = true;
	cls.state = ca_connected;
	cls.forcetrack = 0;

	// Parse force track from first line
	let neg = false;
	while ( cls.demopos < cls.demodata.length ) {

		const c = cls.demodata[ cls.demopos ++ ];
		if ( c === 0x0A ) break; // '\n'
		if ( c === 0x2D ) // '-'
			neg = true;
		else
			cls.forcetrack = cls.forcetrack * 10 + ( c - 0x30 ); // c - '0'

	}

	if ( neg )
		cls.forcetrack = - cls.forcetrack;

	Con_Printf( 'Playing demo (forcetrack %i)\n', cls.forcetrack );

}

/*
====================
CL_FinishTimeDemo

====================
*/
function CL_FinishTimeDemo() {

	cls.timedemo = false;

	// the first frame didn't count
	const frames = ( host_framecount - cls.td_startframe ) - 1;
	let time = realtime - cls.td_starttime;
	if ( time === 0 )
		time = 1;
	Con_Printf( '%i frames %5.1f seconds %5.1f fps\n', frames, time, frames / time );

}

/*
====================
CL_TimeDemo_f

timedemo [demoname]
====================
*/
export function CL_TimeDemo_f() {

	if ( cmd_source !== src_command )
		return;

	if ( Cmd_Argc() !== 2 ) {

		Con_Printf( 'timedemo <demoname> : gets demo speeds\n' );
		return;

	}

	CL_PlayDemo_f();

	// cls.td_starttime will be grabbed at the second frame of the demo, so
	// all the loading time doesn't get counted

	cls.timedemo = true;
	cls.td_startframe = host_framecount;
	cls.td_lastframe = - 1; // get a new message this frame

}
