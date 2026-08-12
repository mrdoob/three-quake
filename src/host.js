// Ported from: WinQuake/host.c -- coordinates spawning and killing of local servers

import { Sys_Printf, Sys_Error, Sys_FloatTime } from './sys.js';
import { Con_Printf, Con_DPrintf, Con_SetPrintFunctions, SZ_Clear,
	MSG_WriteByte, MSG_WriteString } from './common.js';
import { svc_print, svc_disconnect } from './protocol.js';
import { cvar_t, Cvar_RegisterVariable, Cvar_SetServerBroadcast, Cvar_WriteVariables } from './cvar.js';
import { Cmd_Init, Cbuf_Init, Cbuf_Execute, Cbuf_AddText, Cbuf_InsertText, Cmd_SetClientCallbacks } from './cmd.js';
import { Memory_Init } from './zone.js';
import { V_Init } from './view.js';
import { Chase_Init } from './chase.js';
import { W_LoadWadFile } from './wad.js';
import { COM_LoadFile } from './pak.js';
import { Key_Init, Key_WriteBindings } from './keys.js';
import { Con_Init, Con_SetExternals, Con_Printf as RealConPrintf, Con_DPrintf as RealConDPrintf } from './console.js';
import { M_Init, M_SetExternals } from './menu.js';
import { PR_Init } from './pr_edict.js';
import { Mod_Init, Mod_ClearAll, R_InitTextures } from './gl_model.js';
import { NET_Init, NET_Poll, NET_Shutdown, NET_SendMessage, NET_CanSendMessage,
	NET_GetMessage, NET_SendToAll, WT_QueryRooms, WT_CreateRoom } from './net_main.js';
import { SV_Init, SV_CheckForNewClients, SV_ClearDatagram,
	SV_SendClientMessages, SV_DropClient } from './sv_main.js';
import { SV_RunClients } from './sv_user.js';
import { SV_Physics, SV_SetFrametime, sv_gravity } from './sv_phys.js';
import { sv, svs, client_t,
	host_client, set_host_client } from './server.js';
import { R_Init, D_FlushCaches } from './gl_rmisc.js';
import { VID_Init, VID_Shutdown } from './vid.js';
import { Draw_Init, Draw_Character, Draw_String, Draw_ConsoleBackground, Draw_SetExternals, Draw_PicFromWad, Draw_CachePic, Draw_Pic, Draw_SubPic, Draw_TransPic, Draw_TransPicTranslate, Draw_Fill, Draw_FadeScreen } from './gl_draw.js';
import { SCR_Init, SCR_UpdateScreen, SCR_SetExternals, SCR_EndLoadingPlaque, SCR_BeginLoadingPlaque } from './gl_screen.js';
import { S_Init, S_Update, S_Shutdown, S_StopAllSounds, S_SetCallbacks } from './snd_dma.js';
import { CDAudio_Init, CDAudio_Update, CDAudio_Shutdown } from './cd_audio.js';
import { Sbar_Init, Sbar_SetExternals } from './sbar.js';
import { CL_Init, CL_SendCmd, CL_ReadFromServer, CL_DecayLights, CL_Disconnect, CL_NextDemo, cl_name } from './cl_main.js';
import { IN_Init, IN_Commands, IN_Shutdown, IN_UpdateTouch, IN_RequestPointerLock } from './in_web.js';
import { cls, cl, SIGNONS, ca_connected, ca_dedicated } from './client.js';
import { key_dest, key_game, Key_SetExternals, set_key_dest } from './keys.js';
import { r_origin, vpn, vright, vup } from './render.js';
import { vec3_origin } from './mathlib.js';
import { pr_global_struct } from './progs.js';
import { vid, d_8to24table, renderer } from './vid.js';
import { V_RenderView, V_UpdatePalette } from './view.js';
import { S_LocalSound } from './snd_dma.js';
import { M_Menu_Main_f } from './menu.js';
import { R_Efrag_SetExternals } from './gl_refrag.js';
import { Host_InitCommands } from './host_cmd.js';
import { R_SetParticleExternals } from './r_part.js';

/*

A server can always be started, even if the system started out as a client
to a remote system.

A client can NOT be started if the system started as a dedicated server.

Memory is cleared / released when a server or client begins, not when they end.

*/

export let host_parms = null;

export let host_initialized = false;

export let host_frametime = 0;
let host_time = 0;
export let realtime = 0;
let oldrealtime = 0;
export let host_framecount = 0;

// host_client is imported from server.js (canonical copy)

export let host_basepal = null;
export let host_colormap = null;

const host_framerate = new cvar_t( 'host_framerate', '0' ); // set for slow motion
const host_speeds = new cvar_t( 'host_speeds', '0' ); // set for running times

export const sys_ticrate = new cvar_t( 'sys_ticrate', '0.05' );
const serverprofile = new cvar_t( 'serverprofile', '0' );

export const fraglimit = new cvar_t( 'fraglimit', '0', false, true );
export const timelimit = new cvar_t( 'timelimit', '0', false, true );
export const teamplay = new cvar_t( 'teamplay', '0', false, true );

export const samelevel = new cvar_t( 'samelevel', '0' );
export const noexit = new cvar_t( 'noexit', '0', false, true );

const developer = new cvar_t( 'developer', '0' );

export const skill = new cvar_t( 'skill', '1' ); // 0 - 3
export const deathmatch = new cvar_t( 'deathmatch', '0' ); // 0, 1, or 2
export const coop = new cvar_t( 'coop', '0' ); // 0 or 1

const pausable = new cvar_t( 'pausable', '1' );

const temp1 = new cvar_t( 'temp1', '0' );

export function set_host_frametime( v ) { host_frametime = v; }
// set_host_client is imported and re-exported from server.js
export { set_host_client } from './server.js';
// sv is the server state, re-exported for client-side prediction
export { sv } from './server.js';

/*
====================
GL_BeginRendering / GL_EndRendering

In original Quake these are in gl_vidnt.c.
For Three.js, BeginRendering clears the renderer and EndRendering is a no-op
(the browser composites on the next frame automatically).
====================
*/
function _GL_BeginRendering() {

	if ( renderer ) {

		renderer.clear();

	}

}

function _GL_EndRendering() {

	// Three.js presents automatically at end of rAF callback

}

/*
================
Host_ClearMemory

This clears all the memory used by both the client and server, but does
not reinitialize anything.
================
*/
export function Host_ClearMemory() {

	Con_DPrintf( 'Clearing memory\n' );
	D_FlushCaches();
	Mod_ClearAll();

	// JS doesn't have hunk memory to free (GC handles it)

	cls.signon = 0;

	// Clear sv and cl structures - in JS we reset key fields
	// sv is reset in SV_SpawnServer via Object.assign
	// cl is reset in CL_ClearState

}

/*
=======================
Host_InitLocal
=======================
*/
function Host_InitLocal() {

	Host_InitCommands();

	Cvar_RegisterVariable( host_framerate );
	Cvar_RegisterVariable( host_speeds );
	Cvar_RegisterVariable( sys_ticrate );
	Cvar_RegisterVariable( serverprofile );

	Cvar_RegisterVariable( fraglimit );
	Cvar_RegisterVariable( timelimit );
	Cvar_RegisterVariable( teamplay );

	Cvar_RegisterVariable( samelevel );
	Cvar_RegisterVariable( noexit );

	Cvar_RegisterVariable( developer );

	Cvar_RegisterVariable( skill );
	Cvar_RegisterVariable( deathmatch );
	Cvar_RegisterVariable( coop );

	Cvar_RegisterVariable( pausable );

	Cvar_RegisterVariable( temp1 );

	Host_FindMaxClients();

	host_time = 1.0; // so a think at time 0 won't get called

}

/*
======================
Host_FindMaxClients
======================
*/
function Host_FindMaxClients() {

	svs.maxclients = 1;
	svs.maxclientslimit = svs.maxclients;
	if ( svs.maxclientslimit < 4 )
		svs.maxclientslimit = 4;

	// Allocate client slots
	svs.clients = [];
	for ( let i = 0; i < svs.maxclientslimit; i ++ ) {

		svs.clients[ i ] = new client_t();

	}

	cls.state = 1; // ca_disconnected

}

/*
====================
Host_Init
====================
*/
export async function Host_Init( parms ) {

	host_parms = parms;

	Memory_Init();
	Cbuf_Init();
	Cmd_Init();
	V_Init();
	Chase_Init();
	Host_InitLocal();

	Con_Printf( 'Three-Quake Version 1.09\n' );
	Con_Printf( 'Exe: three-quake (JavaScript/Three.js)\n' );

	// W_LoadWadFile("gfx.wad") - load from pak
	const wadData = COM_LoadFile( 'gfx.wad' );
	if ( wadData ) {

		W_LoadWadFile( wadData );
		Con_Printf( 'Loaded gfx.wad\n' );

	} else {

		Con_Printf( 'Warning: gfx.wad not found in pak\n' );

	}

	Key_Init();
	Con_Init();

	// Wire up the real console print functions so all modules use the actual console
	Con_SetPrintFunctions( RealConPrintf, RealConDPrintf );

	M_Init();
	PR_Init();
	Mod_Init();
	NET_Init();
	SV_Init();
	R_SetParticleExternals( { sv_gravity: sv_gravity } );

	// Wire up cvar server broadcast callback
	Cvar_SetServerBroadcast( function ( msg ) {

		if ( sv.active ) {

			SV_BroadcastPrintf( '%s', msg );

		}

	} );

	R_InitTextures(); // needed even for dedicated servers

	// Load palette and colormap from pak
	const paletteData = COM_LoadFile( 'gfx/palette.lmp' );
	if ( paletteData ) {

		host_basepal = new Uint8Array( paletteData );

	} else {

		Con_Printf( 'Warning: gfx/palette.lmp not found\n' );

	}

	const colormapData = COM_LoadFile( 'gfx/colormap.lmp' );
	if ( colormapData ) {

		host_colormap = new Uint8Array( colormapData );

	} else {

		Con_Printf( 'Warning: gfx/colormap.lmp not found\n' );

	}

	VID_Init( host_basepal );

	// Wire Draw externals before Draw_Init so overlay canvas gets correct size
	Draw_SetExternals( {
		vid: vid,
		host_basepal: host_basepal,
		d_8to24table: d_8to24table
	} );

	Draw_Init();

	M_SetExternals( {
		key_dest_set: set_key_dest,
		key_dest_get: () => key_dest,
		cls: cls,
		sv: sv,
		svs: svs,
		cl: cl,
		vid: vid,
		Draw_CachePic: Draw_CachePic,
		Draw_TransPic: Draw_TransPic,
		Draw_Pic: Draw_Pic,
		Draw_Character: Draw_Character,
		Draw_Fill: Draw_Fill,
		Draw_FadeScreen: Draw_FadeScreen,
		Draw_ConsoleBackground: Draw_ConsoleBackground,
		Draw_String: Draw_String,
		S_LocalSound: S_LocalSound,
		SCR_BeginLoadingPlaque: SCR_BeginLoadingPlaque,
		IN_RequestPointerLock: IN_RequestPointerLock,
		host_time_get: () => host_time,
		realtime_get: () => realtime,
		CL_NextDemo: CL_NextDemo,
		WT_QueryRooms: WT_QueryRooms,
		WT_CreateRoom: WT_CreateRoom,
		cl_name: cl_name,
		Draw_TransPicTranslate: Draw_TransPicTranslate,
		Draw_SubPic: Draw_SubPic
	} );

	SCR_Init();
	R_Init();
	S_Init();
	S_SetCallbacks( {
		getHostFrametime: () => host_frametime
	} );
	CDAudio_Init();
	Sbar_SetExternals( {
		cl: cl,
		vid: vid,
		Draw_Pic: Draw_Pic,
		Draw_TransPic: Draw_TransPic,
		Draw_Character: Draw_Character,
		Draw_String: Draw_String,
		Draw_Fill: Draw_Fill,
		Draw_PicFromWad: Draw_PicFromWad,
		Draw_CachePic: Draw_CachePic
	} );
	Sbar_Init();
	CL_Init();
	IN_Init();

	// Wire cmd.js to client state for Cmd_ForwardToServer
	Cmd_SetClientCallbacks( {
		getClientState: () => ( { cls: cls, ca_connected: ca_connected } )
	} );

	// Wire cross-module externals
	Con_SetExternals( {
		cls: cls,
		vid: vid,
		Draw_Character: Draw_Character,
		Draw_String: Draw_String,
		Draw_ConsoleBackground: Draw_ConsoleBackground,
		SCR_UpdateScreen: SCR_UpdateScreen,
		SCR_EndLoadingPlaque: SCR_EndLoadingPlaque,
		M_Menu_Main_f: M_Menu_Main_f,
		S_LocalSound: S_LocalSound,
		getRealtime: () => realtime,
		developer: developer
	} );

	SCR_SetExternals( {
		vid: vid,
		cls: cls,
		cl: cl,
		V_RenderView: V_RenderView,
		V_UpdatePalette: V_UpdatePalette,
		GL_BeginRendering: _GL_BeginRendering,
		GL_EndRendering: _GL_EndRendering,
		S_StopAllSounds: S_StopAllSounds
	} );

	Key_SetExternals( {
		cls: cls,
		vid: vid
	} );

	R_Efrag_SetExternals( {
		cl: cl
	} );

	Cbuf_InsertText( 'exec quake.rc\n' );

	// Default WASD bindings for the web port (after quake.rc so user config can override)
	Cbuf_AddText( 'bind w +forward\n' );
	Cbuf_AddText( 'bind s +back\n' );
	Cbuf_AddText( 'bind a +moveleft\n' );
	Cbuf_AddText( 'bind d +moveright\n' );
	Cbuf_AddText( 'bind SPACE +jump\n' );
	Cbuf_AddText( 'bind MOUSE1 +attack\n' );

	// Always run by default for the web port
	Cbuf_AddText( 'cl_forwardspeed 400\n' );
	Cbuf_AddText( 'cl_backspeed 400\n' );

	// Load saved config from localStorage (overrides defaults above)
	try {

		const savedConfig = localStorage.getItem( CONFIG_STORAGE_KEY );
		if ( savedConfig !== null ) {

			Cbuf_AddText( savedConfig );
			Con_Printf( 'Loaded saved config from localStorage\n' );

		}

	} catch ( e ) {

		// localStorage may be unavailable
	}

	// Save config on page unload
	if ( typeof window !== 'undefined' ) {

		window.addEventListener( 'beforeunload', function () {

			Host_WriteConfiguration();

		} );

	}

	host_initialized = true;

	Sys_Printf( 'Host_Init complete\n' );

}

/*
==================
Host_ServerFrame

Runs server simulation for the current frame
==================
*/
export function Host_ServerFrame() {

	// sync frametime to physics module
	SV_SetFrametime( host_frametime );

	// run the world state
	if ( pr_global_struct ) {

		pr_global_struct.frametime = host_frametime;

	}

	// set the time and clear the general datagram
	SV_ClearDatagram();

	// check for new clients
	SV_CheckForNewClients();

	// read client messages
	SV_RunClients();

	// move things around and think
	// always pause in single player if in console or menus
	if ( ! sv.paused && ( svs.maxclients > 1 || key_dest === key_game ) )
		SV_Physics();

	// send all messages to the clients
	SV_SendClientMessages();

}

/*
==================
Host_Frame

Runs all active servers
==================
*/
export function Host_Frame( time ) {

	try {

		_Host_Frame_Internal( time );

	} catch ( e ) {

		// Host_Error and Host_EndGame throw to recover (like C's longjmp).
		// Catch and continue to next frame.
		if ( e.message && e.message.startsWith( 'Host_Error:' ) ) {

			Con_Printf( '%s\n', e.message );

		} else if ( e.message && e.message.startsWith( 'Host_EndGame:' ) ) {

			// Normal game end (demo finished, disconnect, etc.) - no need to log

		} else {

			// Unexpected error - re-throw
			throw e;

		}

	}

}

function _Host_Frame_Internal( time ) {

	// keep the random time dependent
	// Math.random() is already random in JS

	// decide the simulation time
	if ( ! _Host_FilterTime( time ) )
		return; // don't run too fast, or packets will flood out

	// allow mice or other external controllers to add commands
	IN_Commands();

	// update touch controls state based on key_dest
	IN_UpdateTouch();

	// process console commands
	Cbuf_Execute();

	NET_Poll();

	// if running the server locally, make intentions now
	if ( sv.active )
		CL_SendCmd();

	//-------------------
	//
	// server operations
	//
	//-------------------

	if ( sv.active )
		Host_ServerFrame();

	//-------------------
	//
	// client operations
	//
	//-------------------

	// if running the server remotely, send intentions now after
	// the incoming messages have been read
	if ( ! sv.active )
		CL_SendCmd();

	host_time += host_frametime;

	// fetch results from server
	if ( cls.state === ca_connected ) {

		CL_ReadFromServer();

	}

	// update video
	SCR_UpdateScreen();

	// update audio
	if ( cls.signon === SIGNONS ) {

		S_Update( r_origin, vpn, vright, vup );
		CL_DecayLights();

	} else {

		S_Update( vec3_origin, vec3_origin, vec3_origin, vec3_origin );

	}

	CDAudio_Update();

	host_framecount ++;

}

/*
==================
_Host_FilterTime

Returns false if the time is too short to run a frame
==================
*/
function _Host_FilterTime( time ) {

	realtime += time;

	// Don't run too fast - cap at 72 FPS
	// This prevents packets from flooding out and keeps physics consistent
	if ( cls.timedemo !== true && realtime - oldrealtime < 1.0 / 72.0 )
		return false; // framerate is too high

	host_frametime = realtime - oldrealtime;
	oldrealtime = realtime;

	if ( host_framerate.value > 0 ) {

		host_frametime = host_framerate.value;

	} else {

		// don't allow really long or short frames
		if ( host_frametime > 0.1 )
			host_frametime = 0.1;
		if ( host_frametime < 0.001 )
			host_frametime = 0.001;

	}

	return true;

}

/*
================
Host_Error

This shuts down both the client and server
================
*/
let host_error_reentrancy = false;

export function Host_Error( error ) {

	if ( host_error_reentrancy )
		Sys_Error( 'Host_Error: recursively entered - ' + error );

	host_error_reentrancy = true;

	SCR_EndLoadingPlaque(); // reenable screen updates

	Con_Printf( 'Host_Error: ' + error + '\n' );

	if ( sv.active )
		Host_ShutdownServer( false );

	CL_Disconnect();
	cls.demonum = - 1;

	host_error_reentrancy = false;

	// Throw to unwind the call stack back to Host_Frame (like C's longjmp)
	throw new Error( 'Host_Error: ' + error );

}

/*
================
Host_EndGame

End the current game
================
*/
export function Host_EndGame( message ) {

	Con_DPrintf( 'Host_EndGame: %s\n', message );

	if ( sv.active )
		Host_ShutdownServer( false );

	if ( cls.demonum !== - 1 ) {

		CL_NextDemo();

	} else {

		CL_Disconnect();

	}

	// Throw to unwind the call stack back to Host_Frame (like C's longjmp)
	throw new Error( 'Host_EndGame: ' + message );

}

/*
================
Host_ShutdownServer

This only happens at the end of a game, not between levels
================
*/
// Cached buffer for Host_ShutdownServer disconnect message (avoid per-call allocations)
const _shutdownBuf = new Uint8Array( 4 );
const _shutdownMsg = { allowoverflow: false, overflowed: false, data: _shutdownBuf, maxsize: 4, cursize: 0 };

export function Host_ShutdownServer( crash ) {

	if ( sv.active === false )
		return;

	sv.active = false;

	// stop all client sounds immediately
	if ( cls.state === ca_connected )
		CL_Disconnect();

	// flush any pending messages - like the score!!!
	const start = Sys_FloatTime();
	let count;
	do {

		count = 0;
		for ( let i = 0; i < svs.maxclients; i ++ ) {

			set_host_client( svs.clients[ i ] );
			if ( host_client.active && host_client.message.cursize > 0 ) {

				if ( NET_CanSendMessage( host_client.netconnection ) ) {

					NET_SendMessage( host_client.netconnection, host_client.message );
					SZ_Clear( host_client.message );

				} else {

					NET_GetMessage( host_client.netconnection );
					count ++;

				}

			}

		}

		if ( ( Sys_FloatTime() - start ) > 3.0 )
			break;

	} while ( count > 0 );

	// make sure all the clients know we're disconnecting
	_shutdownMsg.cursize = 0;
	MSG_WriteByte( _shutdownMsg, svc_disconnect );
	count = NET_SendToAll( _shutdownMsg, 5 );
	if ( count > 0 )
		Con_Printf( 'Host_ShutdownServer: NET_SendToAll failed for ' + count + ' clients\n' );

	// drop all active clients
	for ( let i = 0; i < svs.maxclients; i ++ ) {

		if ( svs.clients[ i ] != null && svs.clients[ i ].active ) {

			set_host_client( svs.clients[ i ] );
			SV_DropClient( crash );

		}

	}

	// clear structures
	Object.assign( sv, new ( sv.constructor )() );

}

/*
===============
Host_WriteConfiguration

Writes key bindings and archived cvars to localStorage
===============
*/
const CONFIG_STORAGE_KEY = 'quake_config';

export function Host_WriteConfiguration() {

	if ( host_initialized !== true )
		return;

	const config = Key_WriteBindings() + Cvar_WriteVariables();

	try {

		localStorage.setItem( CONFIG_STORAGE_KEY, config );

	} catch ( e ) {

		Con_Printf( 'Couldn\'t save config.\n' );

	}

}

/*
================
Host_Shutdown

Cleanly shut down everything
================
*/
export function Host_Shutdown() {

	if ( ! host_initialized )
		return;

	Host_WriteConfiguration();

	host_initialized = false;

	// Shutdown subsystems in reverse order
	CDAudio_Shutdown();
	S_Shutdown();
	IN_Shutdown();
	NET_Shutdown();
	VID_Shutdown();

	Con_Printf( 'Host_Shutdown complete\n' );

}

/*
================
SV_ClientPrintf

Sends text across to be displayed
================
*/
export function SV_ClientPrintf( fmt, ...args ) {

	// Format the string
	let msg = fmt;
	if ( args.length > 0 ) {

		msg = fmt.replace( /%s/g, () => args.shift() || '' );

	}

	// Write to host_client's message buffer
	if ( host_client && host_client.message ) {

		MSG_WriteByte( host_client.message, svc_print );
		MSG_WriteString( host_client.message, msg );

	}

}

/*
================
SV_BroadcastPrintf

Sends text to all active clients
================
*/
export function SV_BroadcastPrintf( fmt, ...args ) {

	// Format the string
	let msg = fmt;
	if ( args.length > 0 ) {

		msg = fmt.replace( /%s/g, () => args.shift() || '' );

	}

	Con_Printf( '%s', msg );

	// Write to all active clients
	for ( let i = 0; i < svs.maxclients; i ++ ) {

		const client = svs.clients[ i ];
		if ( client == null || ! client.active || ! client.spawned ) continue;
		MSG_WriteByte( client.message, svc_print );
		MSG_WriteString( client.message, msg );

	}

}
