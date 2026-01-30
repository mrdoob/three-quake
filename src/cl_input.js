// Ported from: WinQuake/cl_input.c -- builds an intended movement command to send to the server

import { PITCH, YAW, ROLL } from './quakedef.js';
import { Con_Printf, Q_atoi, SZ_Clear,
	MSG_WriteByte, MSG_WriteFloat, MSG_WriteShort, MSG_WriteAngle,
	net_message } from './common.js';
import { Cmd_AddCommand, Cmd_Argv } from './cmd.js';
import { cvar_t, Cvar_RegisterVariable } from './cvar.js';
import { clc_move } from './protocol.js';
import { SIGNONS,
	kbutton_t, usercmd_t,
	cl, cls, cl_entities } from './client.js';
import { anglemod, VectorCopy } from './mathlib.js';
import { host_frametime, realtime } from './host.js';
import { V_StartPitchDrift, V_StopPitchDrift } from './view.js';
import { lookspring, CL_Disconnect } from './cl_main.js';
import { NET_SendUnreliableMessage } from './net_main.js';
import { CL_StoreCommand } from './cl_pred.js';

/*
===============================================================================

KEY BUTTONS

Continuous button event tracking is complicated by the fact that two different
input sources (say, mouse button 1 and the control key) can both press the
same button, but the button should only be released when both of the
pressing key have been released.

When a key event issues a button command (+forward, +attack, etc), it appends
its key number as a parameter to the command so it can be matched up with
the release.

state bit 0 is the current state of the key
state bit 1 is edge triggered on the up to down transition
state bit 2 is edge triggered on the down to up transition

===============================================================================
*/

export const in_mlook = new kbutton_t();
export const in_klook = new kbutton_t();
export const in_left = new kbutton_t();
export const in_right = new kbutton_t();
export const in_forward = new kbutton_t();
export const in_back = new kbutton_t();
export const in_lookup = new kbutton_t();
export const in_lookdown = new kbutton_t();
export const in_moveleft = new kbutton_t();
export const in_moveright = new kbutton_t();
export const in_strafe = new kbutton_t();
export const in_speed = new kbutton_t();
export const in_use = new kbutton_t();
export const in_jump = new kbutton_t();
export const in_attack = new kbutton_t();
export const in_up = new kbutton_t();
export const in_down = new kbutton_t();

let in_impulse = 0;

function KeyDown( b ) {

	const c = Cmd_Argv( 1 );
	let k;
	if ( c.length )
		k = parseInt( c );
	else
		k = - 1; // typed manually at the console for continuous down

	if ( k === b.down[ 0 ] || k === b.down[ 1 ] )
		return; // repeating key

	if ( b.down[ 0 ] === 0 )
		b.down[ 0 ] = k;
	else if ( b.down[ 1 ] === 0 )
		b.down[ 1 ] = k;
	else {

		Con_Printf( 'Three keys down for a button!\n' );
		return;

	}

	if ( b.state & 1 )
		return; // still down
	b.state |= 1 + 2; // down + impulse down

}

function KeyUp( b ) {

	const c = Cmd_Argv( 1 );
	let k;
	if ( c.length )
		k = parseInt( c );
	else {

		// typed manually at the console, assume for unsticking, so clear all
		b.down[ 0 ] = b.down[ 1 ] = 0;
		b.state = 4; // impulse up
		return;

	}

	if ( b.down[ 0 ] === k )
		b.down[ 0 ] = 0;
	else if ( b.down[ 1 ] === k )
		b.down[ 1 ] = 0;
	else
		return; // key up without coresponding down (menu pass through)
	if ( b.down[ 0 ] || b.down[ 1 ] )
		return; // some other key is still holding it down

	if ( ! ( b.state & 1 ) )
		return; // still up (this should not happen)
	b.state &= ~1; // now up
	b.state |= 4; // impulse up

}

function IN_KLookDown() { KeyDown( in_klook ); }
function IN_KLookUp() { KeyUp( in_klook ); }
function IN_MLookDown() { KeyDown( in_mlook ); }
function IN_MLookUp() {

	KeyUp( in_mlook );
	if ( ! ( in_mlook.state & 1 ) && lookspring.value )
		V_StartPitchDrift();

}

function IN_UpDown() { KeyDown( in_up ); }
function IN_UpUp() { KeyUp( in_up ); }
function IN_DownDown() { KeyDown( in_down ); }
function IN_DownUp() { KeyUp( in_down ); }
function IN_LeftDown() { KeyDown( in_left ); }
function IN_LeftUp() { KeyUp( in_left ); }
function IN_RightDown() { KeyDown( in_right ); }
function IN_RightUp() { KeyUp( in_right ); }
function IN_ForwardDown() { KeyDown( in_forward ); }
function IN_ForwardUp() { KeyUp( in_forward ); }
function IN_BackDown() { KeyDown( in_back ); }
function IN_BackUp() { KeyUp( in_back ); }
function IN_LookupDown() { KeyDown( in_lookup ); }
function IN_LookupUp() { KeyUp( in_lookup ); }
function IN_LookdownDown() { KeyDown( in_lookdown ); }
function IN_LookdownUp() { KeyUp( in_lookdown ); }
function IN_MoveleftDown() { KeyDown( in_moveleft ); }
function IN_MoveleftUp() { KeyUp( in_moveleft ); }
function IN_MoverightDown() { KeyDown( in_moveright ); }
function IN_MoverightUp() { KeyUp( in_moveright ); }

function IN_SpeedDown() { KeyDown( in_speed ); }
function IN_SpeedUp() { KeyUp( in_speed ); }
function IN_StrafeDown() { KeyDown( in_strafe ); }
function IN_StrafeUp() { KeyUp( in_strafe ); }

function IN_AttackDown() { KeyDown( in_attack ); }
function IN_AttackUp() { KeyUp( in_attack ); }

function IN_UseDown() { KeyDown( in_use ); }
function IN_UseUp() { KeyUp( in_use ); }
function IN_JumpDown() { KeyDown( in_jump ); }
function IN_JumpUp() { KeyUp( in_jump ); }

function IN_Impulse() { in_impulse = Q_atoi( Cmd_Argv( 1 ) ); }

/*
===============
CL_KeyState

Returns 0.25 if a key was pressed and released during the frame,
0.5 if it was pressed and held
0 if held then released, and
1.0 if held for the entire time
===============
*/
export function CL_KeyState( key ) {

	let val;
	const impulsedown = key.state & 2;
	const impulseup = key.state & 4;
	const down = key.state & 1;
	val = 0;

	if ( impulsedown && ! impulseup )
		if ( down )
			val = 0.5; // pressed and held this frame
		else
			val = 0; // I_Error ();
	if ( impulseup && ! impulsedown )
		if ( down )
			val = 0; // I_Error ();
		else
			val = 0; // released this frame
	if ( ! impulsedown && ! impulseup )
		if ( down )
			val = 1.0; // held the entire frame
		else
			val = 0; // up the entire frame
	if ( impulsedown && impulseup )
		if ( down )
			val = 0.75; // released and re-pressed this frame
		else
			val = 0.25; // pressed and released this frame

	key.state &= 1; // clear impulses

	return val;

}

//==========================================================================

export const cl_upspeed = new cvar_t( 'cl_upspeed', '200' );
export const cl_forwardspeed = new cvar_t( 'cl_forwardspeed', '200', true );
export const cl_backspeed = new cvar_t( 'cl_backspeed', '200', true );
export const cl_sidespeed = new cvar_t( 'cl_sidespeed', '350' );

export const cl_movespeedkey = new cvar_t( 'cl_movespeedkey', '2.0' );

export const cl_yawspeed = new cvar_t( 'cl_yawspeed', '140' );
export const cl_pitchspeed = new cvar_t( 'cl_pitchspeed', '150' );

export const cl_anglespeedkey = new cvar_t( 'cl_anglespeedkey', '1.5' );

/*
================
CL_AdjustAngles

Moves the local angle positions
================
*/
export function CL_AdjustAngles() {

	let speed;

	if ( in_speed.state & 1 )
		speed = host_frametime * cl_anglespeedkey.value;
	else
		speed = host_frametime;

	if ( ! ( in_strafe.state & 1 ) ) {

		cl.viewangles[ YAW ] -= speed * cl_yawspeed.value * CL_KeyState( in_right );
		cl.viewangles[ YAW ] += speed * cl_yawspeed.value * CL_KeyState( in_left );
		cl.viewangles[ YAW ] = anglemod( cl.viewangles[ YAW ] );

	}

	if ( in_klook.state & 1 ) {

		V_StopPitchDrift();
		cl.viewangles[ PITCH ] -= speed * cl_pitchspeed.value * CL_KeyState( in_forward );
		cl.viewangles[ PITCH ] += speed * cl_pitchspeed.value * CL_KeyState( in_back );

	}

	const up = CL_KeyState( in_lookup );
	const down = CL_KeyState( in_lookdown );

	cl.viewangles[ PITCH ] -= speed * cl_pitchspeed.value * up;
	cl.viewangles[ PITCH ] += speed * cl_pitchspeed.value * down;

	if ( up || down )
		V_StopPitchDrift();

	if ( cl.viewangles[ PITCH ] > 80 )
		cl.viewangles[ PITCH ] = 80;
	if ( cl.viewangles[ PITCH ] < - 70 )
		cl.viewangles[ PITCH ] = - 70;

	if ( cl.viewangles[ ROLL ] > 50 )
		cl.viewangles[ ROLL ] = 50;
	if ( cl.viewangles[ ROLL ] < - 50 )
		cl.viewangles[ ROLL ] = - 50;

}

/*
================
CL_BaseMove

Send the intended movement message to the server
================
*/
export function CL_BaseMove( cmd ) {

	if ( cls.signon !== SIGNONS )
		return;

	CL_AdjustAngles();

	cmd.viewangles.fill( 0 );
	cmd.forwardmove = 0;
	cmd.sidemove = 0;
	cmd.upmove = 0;

	if ( in_strafe.state & 1 ) {

		cmd.sidemove += cl_sidespeed.value * CL_KeyState( in_right );
		cmd.sidemove -= cl_sidespeed.value * CL_KeyState( in_left );

	}

	cmd.sidemove += cl_sidespeed.value * CL_KeyState( in_moveright );
	cmd.sidemove -= cl_sidespeed.value * CL_KeyState( in_moveleft );

	cmd.upmove += cl_upspeed.value * CL_KeyState( in_up );
	cmd.upmove -= cl_upspeed.value * CL_KeyState( in_down );

	if ( ! ( in_klook.state & 1 ) ) {

		cmd.forwardmove += cl_forwardspeed.value * CL_KeyState( in_forward );
		cmd.forwardmove -= cl_backspeed.value * CL_KeyState( in_back );

	}

	//
	// adjust for speed key
	//
	if ( in_speed.state & 1 ) {

		cmd.forwardmove *= cl_movespeedkey.value;
		cmd.sidemove *= cl_movespeedkey.value;
		cmd.upmove *= cl_movespeedkey.value;

	}

}

/*
==============
CL_SendMove
==============
*/
export function CL_SendMove( cmd ) {

	const buf = {
		maxsize: 128,
		cursize: 0,
		data: new Uint8Array( 128 ),
		allowoverflow: false,
		overflowed: false
	};

	cl.cmd = cmd;

	//
	// send the movement message
	//
	MSG_WriteByte( buf, clc_move );

	MSG_WriteFloat( buf, cl.mtime[ 0 ] ); // so server can get ping times

	for ( let i = 0; i < 3; i ++ )
		MSG_WriteAngle( buf, cl.viewangles[ i ] );

	MSG_WriteShort( buf, cmd.forwardmove );
	MSG_WriteShort( buf, cmd.sidemove );
	MSG_WriteShort( buf, cmd.upmove );

	//
	// send button bits
	//
	let bits = 0;

	if ( in_attack.state & 3 )
		bits |= 1;
	in_attack.state &= ~2;

	if ( in_jump.state & 3 )
		bits |= 2;
	in_jump.state &= ~2;

	MSG_WriteByte( buf, bits );

	MSG_WriteByte( buf, in_impulse );
	in_impulse = 0;

	//
	// Store command for client-side prediction (QuakeWorld style)
	// Build a prediction command structure
	//
	const predCmd = {
		msec: Math.min( 255, Math.floor( host_frametime * 1000 ) ),
		angles: new Float32Array( 3 ),
		forwardmove: cmd.forwardmove,
		sidemove: cmd.sidemove,
		upmove: cmd.upmove,
		buttons: bits
	};
	VectorCopy( cl.viewangles, predCmd.angles );
	CL_StoreCommand( predCmd, realtime );

	//
	// deliver the message
	//
	if ( cls.demoplayback )
		return;

	//
	// allways dump the first two message, because it may contain leftover inputs
	// from the last level
	//
	if ( ++ cl.movemessages <= 2 )
		return;

	if ( NET_SendUnreliableMessage( cls.netcon, buf ) === - 1 ) {

		Con_Printf( 'CL_SendMove: lost server connection\n' );
		CL_Disconnect();

	}

}

/*
============
CL_InitInput
============
*/
export function CL_InitInput() {

	Cmd_AddCommand( '+moveup', IN_UpDown );
	Cmd_AddCommand( '-moveup', IN_UpUp );
	Cmd_AddCommand( '+movedown', IN_DownDown );
	Cmd_AddCommand( '-movedown', IN_DownUp );
	Cmd_AddCommand( '+left', IN_LeftDown );
	Cmd_AddCommand( '-left', IN_LeftUp );
	Cmd_AddCommand( '+right', IN_RightDown );
	Cmd_AddCommand( '-right', IN_RightUp );
	Cmd_AddCommand( '+forward', IN_ForwardDown );
	Cmd_AddCommand( '-forward', IN_ForwardUp );
	Cmd_AddCommand( '+back', IN_BackDown );
	Cmd_AddCommand( '-back', IN_BackUp );
	Cmd_AddCommand( '+lookup', IN_LookupDown );
	Cmd_AddCommand( '-lookup', IN_LookupUp );
	Cmd_AddCommand( '+lookdown', IN_LookdownDown );
	Cmd_AddCommand( '-lookdown', IN_LookdownUp );
	Cmd_AddCommand( '+strafe', IN_StrafeDown );
	Cmd_AddCommand( '-strafe', IN_StrafeUp );
	Cmd_AddCommand( '+moveleft', IN_MoveleftDown );
	Cmd_AddCommand( '-moveleft', IN_MoveleftUp );
	Cmd_AddCommand( '+moveright', IN_MoverightDown );
	Cmd_AddCommand( '-moveright', IN_MoverightUp );
	Cmd_AddCommand( '+speed', IN_SpeedDown );
	Cmd_AddCommand( '-speed', IN_SpeedUp );
	Cmd_AddCommand( '+attack', IN_AttackDown );
	Cmd_AddCommand( '-attack', IN_AttackUp );
	Cmd_AddCommand( '+use', IN_UseDown );
	Cmd_AddCommand( '-use', IN_UseUp );
	Cmd_AddCommand( '+jump', IN_JumpDown );
	Cmd_AddCommand( '-jump', IN_JumpUp );
	Cmd_AddCommand( 'impulse', IN_Impulse );
	Cmd_AddCommand( '+klook', IN_KLookDown );
	Cmd_AddCommand( '-klook', IN_KLookUp );
	Cmd_AddCommand( '+mlook', IN_MLookDown );
	Cmd_AddCommand( '-mlook', IN_MLookUp );

	// Enable mouse look by default for the web port
	// (original Quake required manually binding +mlook)
	in_mlook.state = 1;

}
