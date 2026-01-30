// Ported from: WinQuake/sv_user.c -- server code for moving users

import { Sys_Printf } from './sys.js';
import { Con_Printf, Con_DPrintf, MSG_ReadFloat, MSG_ReadAngle, MSG_ReadShort,
	MSG_ReadByte, MSG_ReadChar, MSG_ReadString, MSG_BeginReading,
	msg_badread, net_message } from './common.js';
import { vec3_origin, DotProduct, VectorCopy, VectorAdd, VectorSubtract,
	VectorMA, VectorScale, VectorNormalize, Length, AngleVectors, M_PI } from './mathlib.js';
import { ON_EPSILON, PITCH, YAW, ROLL } from './quakedef.js';
import { MOVETYPE_NONE, MOVETYPE_WALK, MOVETYPE_NOCLIP, FL_ONGROUND,
	FL_WATERJUMP, sv, svs, sv_player, pr_global_struct, host_frametime,
	sv_friction, sv_stopspeed, SV_SetPlayer,
	SV_Move, SV_LinkEdict, PR_ExecuteProgram, EDICT_TO_PROG } from './sv_phys.js';

const MAX_FORWARD = 6;
const NUM_PING_TIMES = 16;

// cvars
export const sv_edgefriction = { name: 'edgefriction', string: '2', value: 2 };
export const sv_maxspeed = { name: 'sv_maxspeed', string: '320', value: 320, server: true };
export const sv_accelerate = { name: 'sv_accelerate', string: '10', value: 10 };
export const sv_idealpitchscale = { name: 'sv_idealpitchscale', string: '0.8', value: 0.8 };

// module-level state (matching C static/global variables)
const forward = new Float32Array( 3 );
const right = new Float32Array( 3 );
const up = new Float32Array( 3 );

let wishdir = new Float32Array( 3 );
let wishspeed = 0;

// world
let angles = null; // float *
let origin = null; // float *
let velocity = null; // float *

let onground = false;

let cmd = { forwardmove: 0, sidemove: 0, upmove: 0 };

// External references (set by engine)
export let host_client = null;
export const key_game = 0;
let _get_key_dest = null; // getter injected via callbacks to avoid circular deps

// Stubs for external functions
export let V_CalcRoll = null;
export let SV_DropClient = null;
export let NET_GetMessage = null;
export let Cbuf_InsertText = null;
let _set_host_client = null;
export let Cmd_ExecuteString = null;
export let src_client = 0;

// clc_ constants (from protocol.h)
export const clc_bad = 0;
export const clc_nop = 1;
export const clc_disconnect = 2;
export const clc_move = 3;
export const clc_stringcmd = 4;

export function SV_User_SetCallbacks( callbacks ) {

	if ( callbacks.V_CalcRoll ) V_CalcRoll = callbacks.V_CalcRoll;
	if ( callbacks.SV_DropClient ) SV_DropClient = callbacks.SV_DropClient;
	if ( callbacks.NET_GetMessage ) NET_GetMessage = callbacks.NET_GetMessage;
	if ( callbacks.Cbuf_InsertText ) Cbuf_InsertText = callbacks.Cbuf_InsertText;
	if ( callbacks.Cmd_ExecuteString ) Cmd_ExecuteString = callbacks.Cmd_ExecuteString;
	if ( callbacks.host_client !== undefined ) host_client = callbacks.host_client;
	if ( callbacks.set_host_client ) _set_host_client = callbacks.set_host_client;
	if ( callbacks.get_key_dest ) _get_key_dest = callbacks.get_key_dest;

}

function Q_strncasecmp( s1, s2, n ) {

	return s1.substring( 0, n ).toLowerCase() === s2.substring( 0, n ).toLowerCase();

}

/*
===============
SV_SetIdealPitch
===============
*/
export function SV_SetIdealPitch() {

	const z = new Float32Array( MAX_FORWARD );
	const top = new Float32Array( 3 );
	const bottom = new Float32Array( 3 );

	if ( ! ( ( sv_player.v.flags | 0 ) & FL_ONGROUND ) )
		return;

	const angleval = sv_player.v.angles[ YAW ] * M_PI * 2 / 360;
	const sinval = Math.sin( angleval );
	const cosval = Math.cos( angleval );

	for ( let i = 0; i < MAX_FORWARD; i ++ ) {

		top[ 0 ] = sv_player.v.origin[ 0 ] + cosval * ( i + 3 ) * 12;
		top[ 1 ] = sv_player.v.origin[ 1 ] + sinval * ( i + 3 ) * 12;
		top[ 2 ] = sv_player.v.origin[ 2 ] + sv_player.v.view_ofs[ 2 ];

		bottom[ 0 ] = top[ 0 ];
		bottom[ 1 ] = top[ 1 ];
		bottom[ 2 ] = top[ 2 ] - 160;

		const tr = SV_Move( top, vec3_origin, vec3_origin, bottom, 1, sv_player );
		if ( tr.allsolid )
			return; // looking at a wall, leave ideal the way is was

		if ( tr.fraction === 1 )
			return; // near a dropoff

		z[ i ] = top[ 2 ] + tr.fraction * ( bottom[ 2 ] - top[ 2 ] );

	}

	let dir = 0;
	let steps = 0;
	for ( let j = 1; j < MAX_FORWARD; j ++ ) {

		const step = z[ j ] - z[ j - 1 ];
		if ( step > - ON_EPSILON && step < ON_EPSILON )
			continue;

		if ( dir && ( step - dir > ON_EPSILON || step - dir < - ON_EPSILON ) )
			return; // mixed changes

		steps ++;
		dir = step;

	}

	if ( dir === 0 ) {

		sv_player.v.idealpitch = 0;
		return;

	}

	if ( steps < 2 )
		return;
	sv_player.v.idealpitch = - dir * sv_idealpitchscale.value;

}

/*
==================
SV_UserFriction
==================
*/
export function SV_UserFriction() {

	const vel = velocity;
	const start = new Float32Array( 3 );
	const stop = new Float32Array( 3 );

	const speed = Math.sqrt( vel[ 0 ] * vel[ 0 ] + vel[ 1 ] * vel[ 1 ] );
	if ( speed === 0 )
		return;

	// if the leading edge is over a dropoff, increase friction
	start[ 0 ] = stop[ 0 ] = origin[ 0 ] + vel[ 0 ] / speed * 16;
	start[ 1 ] = stop[ 1 ] = origin[ 1 ] + vel[ 1 ] / speed * 16;
	start[ 2 ] = origin[ 2 ] + sv_player.v.mins[ 2 ];
	stop[ 2 ] = start[ 2 ] - 34;

	const trace = SV_Move( start, vec3_origin, vec3_origin, stop, true, sv_player );

	let friction;
	if ( trace.fraction === 1.0 )
		friction = sv_friction.value * sv_edgefriction.value;
	else
		friction = sv_friction.value;

	// apply friction
	const control = speed < sv_stopspeed.value ? sv_stopspeed.value : speed;
	let newspeed = speed - host_frametime * control * friction;

	if ( newspeed < 0 )
		newspeed = 0;
	newspeed /= speed;

	vel[ 0 ] = vel[ 0 ] * newspeed;
	vel[ 1 ] = vel[ 1 ] * newspeed;
	vel[ 2 ] = vel[ 2 ] * newspeed;

}

/*
==============
SV_Accelerate
==============
*/
export function SV_Accelerate() {

	const currentspeed = DotProduct( velocity, wishdir );
	const addspeed = wishspeed - currentspeed;
	if ( addspeed <= 0 )
		return;
	let accelspeed = sv_accelerate.value * host_frametime * wishspeed;
	if ( accelspeed > addspeed )
		accelspeed = addspeed;

	for ( let i = 0; i < 3; i ++ )
		velocity[ i ] += accelspeed * wishdir[ i ];

}

/*
==============
SV_AirAccelerate
==============
*/
export function SV_AirAccelerate( wishveloc ) {

	const wishvelCopy = new Float32Array( 3 );
	wishvelCopy[ 0 ] = wishveloc[ 0 ];
	wishvelCopy[ 1 ] = wishveloc[ 1 ];
	wishvelCopy[ 2 ] = wishveloc[ 2 ];

	let wishspd = VectorNormalize( wishvelCopy );
	if ( wishspd > 30 )
		wishspd = 30;
	const currentspeed = DotProduct( velocity, wishvelCopy );
	const addspeed = wishspd - currentspeed;
	if ( addspeed <= 0 )
		return;
	let accelspeed = sv_accelerate.value * wishspeed * host_frametime;
	if ( accelspeed > addspeed )
		accelspeed = addspeed;

	for ( let i = 0; i < 3; i ++ )
		velocity[ i ] += accelspeed * wishvelCopy[ i ];

}

/*
==============
DropPunchAngle
==============
*/
function DropPunchAngle() {

	let len = VectorNormalize( sv_player.v.punchangle );

	len -= 10 * host_frametime;
	if ( len < 0 )
		len = 0;
	VectorScale( sv_player.v.punchangle, len, sv_player.v.punchangle );

}

/*
===================
SV_WaterMove
===================
*/
export function SV_WaterMove() {

	const wishvel = new Float32Array( 3 );

	//
	// user intentions
	//
	AngleVectors( sv_player.v.v_angle, forward, right, up );

	for ( let i = 0; i < 3; i ++ )
		wishvel[ i ] = forward[ i ] * cmd.forwardmove + right[ i ] * cmd.sidemove;

	if ( cmd.forwardmove === 0 && cmd.sidemove === 0 && cmd.upmove === 0 )
		wishvel[ 2 ] -= 60; // drift towards bottom
	else
		wishvel[ 2 ] += cmd.upmove;

	let _wishspeed = Length( wishvel );
	if ( _wishspeed > sv_maxspeed.value ) {

		VectorScale( wishvel, sv_maxspeed.value / _wishspeed, wishvel );
		_wishspeed = sv_maxspeed.value;

	}

	_wishspeed *= 0.7;

	//
	// water friction
	//
	let speed = Length( velocity );
	let newspeed;
	if ( speed ) {

		newspeed = speed - host_frametime * speed * sv_friction.value;
		if ( newspeed < 0 )
			newspeed = 0;
		VectorScale( velocity, newspeed / speed, velocity );

	} else {

		newspeed = 0;

	}

	//
	// water acceleration
	//
	if ( _wishspeed === 0 )
		return;

	const addspeed = _wishspeed - newspeed;
	if ( addspeed <= 0 )
		return;

	VectorNormalize( wishvel );
	let accelspeed = sv_accelerate.value * _wishspeed * host_frametime;
	if ( accelspeed > addspeed )
		accelspeed = addspeed;

	for ( let i = 0; i < 3; i ++ )
		velocity[ i ] += accelspeed * wishvel[ i ];

}

/*
==============
SV_WaterJump
==============
*/
function SV_WaterJump() {

	if ( sv.time > sv_player.v.teleport_time
		|| sv_player.v.waterlevel === 0 ) {

		sv_player.v.flags = ( sv_player.v.flags | 0 ) & ~FL_WATERJUMP;
		sv_player.v.teleport_time = 0;

	}

	sv_player.v.velocity[ 0 ] = sv_player.v.movedir[ 0 ];
	sv_player.v.velocity[ 1 ] = sv_player.v.movedir[ 1 ];

}

/*
===================
SV_AirMove
===================
*/
export function SV_AirMove() {

	const wishvel = new Float32Array( 3 );

	AngleVectors( sv_player.v.angles, forward, right, up );

	let fmove = cmd.forwardmove;
	const smove = cmd.sidemove;

	// hack to not let you back into teleporter
	if ( sv.time < sv_player.v.teleport_time && fmove < 0 )
		fmove = 0;

	for ( let i = 0; i < 3; i ++ )
		wishvel[ i ] = forward[ i ] * fmove + right[ i ] * smove;

	if ( ( sv_player.v.movetype | 0 ) !== MOVETYPE_WALK )
		wishvel[ 2 ] = cmd.upmove;
	else
		wishvel[ 2 ] = 0;

	VectorCopy( wishvel, wishdir );
	wishspeed = VectorNormalize( wishdir );
	if ( wishspeed > sv_maxspeed.value ) {

		VectorScale( wishvel, sv_maxspeed.value / wishspeed, wishvel );
		wishspeed = sv_maxspeed.value;

	}

	if ( sv_player.v.movetype === MOVETYPE_NOCLIP ) {

		// noclip
		VectorCopy( wishvel, velocity );

	} else if ( onground ) {

		SV_UserFriction();
		SV_Accelerate();

	} else {

		// not on ground, so little effect on velocity
		SV_AirAccelerate( wishvel );

	}

}

/*
===================
SV_ClientThink

the move fields specify an intended velocity in pix/sec
the angle fields specify an exact angular motion in degrees
===================
*/
export function SV_ClientThink() {

	const v_angle = new Float32Array( 3 );

	if ( sv_player.v.movetype === MOVETYPE_NONE )
		return;

	onground = ( sv_player.v.flags | 0 ) & FL_ONGROUND;

	origin = sv_player.v.origin;
	velocity = sv_player.v.velocity;

	DropPunchAngle();

	//
	// if dead, behave differently
	//
	if ( sv_player.v.health <= 0 )
		return;

	//
	// angles
	// show 1/3 the pitch angle and all the roll angle
	cmd = host_client.cmd;
	angles = sv_player.v.angles;

	VectorAdd( sv_player.v.v_angle, sv_player.v.punchangle, v_angle );
	angles[ ROLL ] = V_CalcRoll( sv_player.v.angles, sv_player.v.velocity ) * 4;
	if ( sv_player.v.fixangle === 0 ) {

		angles[ PITCH ] = - v_angle[ PITCH ] / 3;
		angles[ YAW ] = v_angle[ YAW ];

	}

	if ( ( sv_player.v.flags | 0 ) & FL_WATERJUMP ) {

		SV_WaterJump();
		return;

	}

	//
	// walk
	//
	if ( ( sv_player.v.waterlevel >= 2 )
		&& ( sv_player.v.movetype !== MOVETYPE_NOCLIP ) ) {

		SV_WaterMove();
		return;

	}

	SV_AirMove();

}

/*
===================
SV_ReadClientMove
===================
*/
export function SV_ReadClientMove( move ) {

	const angle = new Float32Array( 3 );

	// read ping time
	host_client.ping_times[ host_client.num_pings % NUM_PING_TIMES ]
		= sv.time - MSG_ReadFloat();
	host_client.num_pings ++;

	// read current angles
	for ( let i = 0; i < 3; i ++ )
		angle[ i ] = MSG_ReadAngle();

	VectorCopy( angle, host_client.edict.v.v_angle );

	// read movement
	move.forwardmove = MSG_ReadShort();
	move.sidemove = MSG_ReadShort();
	move.upmove = MSG_ReadShort();

	// read buttons
	const bits = MSG_ReadByte();
	host_client.edict.v.button0 = bits & 1;
	host_client.edict.v.button2 = ( bits & 2 ) >> 1;

	const impulse = MSG_ReadByte();
	if ( impulse )
		host_client.edict.v.impulse = impulse;

}

/*
===================
SV_ReadClientMessage

Returns false if the client should be killed
===================
*/
export function SV_ReadClientMessage() {

	let ret;

	do {

		ret = NET_GetMessage( host_client.netconnection );
		if ( ret === - 1 ) {

			Sys_Printf( 'SV_ReadClientMessage: NET_GetMessage failed\n' );
			return false;

		}

		if ( ! ret )
			return true;

		MSG_BeginReading();

		let continueOuter = false;
		while ( true ) {

			if ( ! host_client.active )
				return false; // a command caused an error

			if ( msg_badread ) {

				Sys_Printf( 'SV_ReadClientMessage: badread\n' );
				return false;

			}

			const cmdByte = MSG_ReadChar();

			switch ( cmdByte ) {

				case - 1:
					continueOuter = true;
					break; // end of message (goto nextmsg)

				default:
					Sys_Printf( 'SV_ReadClientMessage: unknown command char\n' );
					return false;

				case clc_nop:
					break;

				case clc_stringcmd: {

					const s = MSG_ReadString();
					let allowed;
					if ( host_client.privileged )
						allowed = 2;
					else
						allowed = 0;

					if ( Q_strncasecmp( s, 'status', 6 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'god', 3 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'notarget', 8 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'fly', 3 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'name', 4 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'noclip', 6 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'say', 3 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'say_team', 8 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'tell', 4 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'color', 5 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'kill', 4 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'pause', 5 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'spawn', 5 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'begin', 5 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'prespawn', 8 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'kick', 4 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'ping', 4 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'give', 4 ) ) allowed = 1;
					else if ( Q_strncasecmp( s, 'ban', 3 ) ) allowed = 1;

					if ( allowed === 2 )
						Cbuf_InsertText( s );
					else if ( allowed === 1 )
						Cmd_ExecuteString( s, src_client );
					else
						Con_DPrintf( '%s tried to %s\n', host_client.name, s );
					break;

				}

				case clc_disconnect:
					return false;

				case clc_move:
					// Ensure cmd object exists before reading into it
					if ( ! host_client.cmd ) {
						host_client.cmd = { forwardmove: 0, sidemove: 0, upmove: 0 };
					}
					SV_ReadClientMove( host_client.cmd );
					break;

			}

			if ( continueOuter ) break;

		}

	} while ( ret === 1 );

	return true;

}

/*
==================
SV_RunClients
==================
*/
export function SV_RunClients() {

	for ( let i = 0; i < svs.maxclients; i ++ ) {

		host_client = svs.clients[ i ];
		if ( _set_host_client ) _set_host_client( host_client );

		if ( ! host_client.active )
			continue;

		SV_SetPlayer( host_client.edict );

		if ( ! SV_ReadClientMessage() ) {

			SV_DropClient( false ); // client misbehaved...
			continue;

		}

		if ( ! host_client.spawned ) {

			// clear client movement until a new packet is received
			host_client.cmd = { forwardmove: 0, sidemove: 0, upmove: 0 };
			continue;

		}

		// always pause in single player if in console or menus
		if ( ! sv.paused && ( svs.maxclients > 1 || ( _get_key_dest ? _get_key_dest() : 0 ) === key_game ) )
			SV_ClientThink();

	}

}
