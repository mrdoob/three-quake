// Ported from: WinQuake/view.c -- player eye positioning

import { PITCH, YAW, ROLL,
	IT_QUAD, IT_SUIT, IT_INVISIBILITY, IT_INVULNERABILITY,
	STAT_HEALTH, STAT_WEAPON, STAT_WEAPONFRAME } from './quakedef.js';
import { Con_Printf, MSG_ReadByte, MSG_ReadCoord } from './common.js';
import { Cmd_AddCommand, Cmd_Argv } from './cmd.js';
import { cvar_t, Cvar_RegisterVariable, Cvar_Set } from './cvar.js';
import { VectorCopy, VectorAdd, VectorSubtract, VectorNormalize,
	DotProduct, AngleVectors, anglemod, M_PI } from './mathlib.js';
import { host_frametime, noclip_anglehack, sv } from './host.js';
import { r_refdef } from './render.js';
import {
	CSHIFT_CONTENTS, CSHIFT_DAMAGE, CSHIFT_BONUS, CSHIFT_POWERUP,
	NUM_CSHIFTS,
	cl, cls, cl_entities, entity_t
} from './client.js';
import { cl_forwardspeed } from './cl_input.js';
import { R_RenderView, R_UpdateVRCamera } from './gl_rmain.js';
import { R_PushDlights } from './gl_rlight.js';
import { con_forcedup } from './console.js';
import { VID_UpdateGamma, VID_IsInVR } from './vid.js';
import { cl_simorg, cl_simvel, cl_simangles, cl_simonground, cl_nopred } from './cl_pred.js';

/*

The view is allowed to move slightly from it's true position for bobbing,
but if it exceeds 8 pixels linear distance (spherical, not box), the list of
entities sent from the server may not include everything in the pvs, especially
when crossing a water boudnary.

*/

const lcd_x = new cvar_t( 'lcd_x', '0' );
const lcd_yaw = new cvar_t( 'lcd_yaw', '0' );

const scr_ofsx = new cvar_t( 'scr_ofsx', '0', false );
const scr_ofsy = new cvar_t( 'scr_ofsy', '0', false );
const scr_ofsz = new cvar_t( 'scr_ofsz', '0', false );

export const cl_rollspeed = new cvar_t( 'cl_rollspeed', '200' );
export const cl_rollangle = new cvar_t( 'cl_rollangle', '2.0' );

const cl_bob = new cvar_t( 'cl_bob', '0.02', false );
const cl_bobcycle = new cvar_t( 'cl_bobcycle', '0.6', false );
const cl_bobup = new cvar_t( 'cl_bobup', '0.5', false );

const v_kicktime = new cvar_t( 'v_kicktime', '0.5', false );
const v_kickroll = new cvar_t( 'v_kickroll', '0.6', false );
const v_kickpitch = new cvar_t( 'v_kickpitch', '0.6', false );

const v_iyaw_cycle = new cvar_t( 'v_iyaw_cycle', '2', false );
const v_iroll_cycle = new cvar_t( 'v_iroll_cycle', '0.5', false );
const v_ipitch_cycle = new cvar_t( 'v_ipitch_cycle', '1', false );
const v_iyaw_level = new cvar_t( 'v_iyaw_level', '0.3', false );
const v_iroll_level = new cvar_t( 'v_iroll_level', '0.1', false );
const v_ipitch_level = new cvar_t( 'v_ipitch_level', '0.3', false );

const v_idlescale = new cvar_t( 'v_idlescale', '0', false );

const crosshair = new cvar_t( 'crosshair', '0', true );
const cl_crossx = new cvar_t( 'cl_crossx', '0', false );
const cl_crossy = new cvar_t( 'cl_crossy', '0', false );

const gl_cshiftpercent = new cvar_t( 'gl_cshiftpercent', '100', false );

let v_dmg_time = 0;
let v_dmg_roll = 0;
let v_dmg_pitch = 0;

// r_refdef is imported from render.js (the canonical source)
// Re-export for backwards compat with modules that import from view.js
export { r_refdef };

/*
===============
V_CalcRoll

Used by view and sv_user
===============
*/
const _forward = new Float32Array( 3 );
const _right = new Float32Array( 3 );
const _up = new Float32Array( 3 );

export function V_CalcRoll( angles, velocity ) {

	AngleVectors( angles, _forward, _right, _up );
	let side = DotProduct( velocity, _right );
	const sign = side < 0 ? - 1 : 1;
	side = Math.abs( side );

	const value = cl_rollangle.value;

	if ( side < cl_rollspeed.value )
		side = side * value / cl_rollspeed.value;
	else
		side = value;

	return side * sign;

}

/*
===============
V_CalcBob

===============
*/
let _bobtime = 0;
let _bob = 0;

export function V_CalcBob() {

	// QuakeWorld: return 0 if spectator
	if ( cl.spectator )
		return 0;

	// QuakeWorld: when in air, keep returning old bob value
	if ( cl_simonground === -1 )
		return _bob;

	_bobtime += host_frametime;
	let cycle = _bobtime - ( ( _bobtime / cl_bobcycle.value ) | 0 ) * cl_bobcycle.value;
	cycle /= cl_bobcycle.value;
	if ( cycle < cl_bobup.value )
		cycle = M_PI * cycle / cl_bobup.value;
	else
		cycle = M_PI + M_PI * ( cycle - cl_bobup.value ) / ( 1.0 - cl_bobup.value );

	// bob is proportional to SIMULATED velocity in the xy plane
	// (don't count Z, or jumping messes it up)
	// QuakeWorld uses cl.simvel for predicted velocity
	_bob = Math.sqrt( cl_simvel[ 0 ] * cl_simvel[ 0 ] + cl_simvel[ 1 ] * cl_simvel[ 1 ] ) * cl_bob.value;
	_bob = _bob * 0.3 + _bob * 0.7 * Math.sin( cycle );
	if ( _bob > 4 )
		_bob = 4;
	else if ( _bob < - 7 )
		_bob = - 7;
	return _bob;

}

//=============================================================================

const v_centermove = new cvar_t( 'v_centermove', '0.15', false );
const v_centerspeed = new cvar_t( 'v_centerspeed', '500' );

export function V_StartPitchDrift() {

	if ( cl.laststop === cl.time ) {

		return; // something else is keeping it from drifting

	}

	if ( cl.nodrift || ! cl.pitchvel ) {

		cl.pitchvel = v_centerspeed.value;
		cl.nodrift = false;
		cl.driftmove = 0;

	}

}

export function V_StopPitchDrift() {

	cl.laststop = cl.time;
	cl.nodrift = true;
	cl.pitchvel = 0;

}

/*
===============
V_DriftPitch

Moves the client pitch angle towards cl.idealpitch sent by the server.

If the user is adjusting pitch manually, either with lookup/lookdown,
mlook and mouse, or klook and keyboard, pitch drifting is constantly stopped.

Drifting is enabled when the center view key is hit, mlook is released and
lookspring is non 0, or when
===============
*/
function V_DriftPitch() {

	if ( noclip_anglehack || ! cl.onground || cls.demoplayback ) {

		cl.driftmove = 0;
		cl.pitchvel = 0;
		return;

	}

	// don't count small mouse motion
	if ( cl.nodrift ) {

		if ( Math.abs( cl.cmd.forwardmove ) < cl_forwardspeed.value )
			cl.driftmove = 0;
		else
			cl.driftmove += host_frametime;

		if ( cl.driftmove > v_centermove.value ) {

			V_StartPitchDrift();

		}

		return;

	}

	const delta = cl.idealpitch - cl.viewangles[ PITCH ];

	if ( ! delta ) {

		cl.pitchvel = 0;
		return;

	}

	let move = host_frametime * cl.pitchvel;
	cl.pitchvel += host_frametime * v_centerspeed.value;

	if ( delta > 0 ) {

		if ( move > delta ) {

			cl.pitchvel = 0;
			move = delta;

		}

		cl.viewangles[ PITCH ] += move;

	} else if ( delta < 0 ) {

		if ( move > - delta ) {

			cl.pitchvel = 0;
			move = - delta;

		}

		cl.viewangles[ PITCH ] -= move;

	}

}

/*
==============================================================================

						PALETTE FLASHES

==============================================================================
*/

export const cshift_empty = { destcolor: [ 130, 80, 50 ], percent: 0 };
export const cshift_water = { destcolor: [ 130, 80, 50 ], percent: 128 };
export const cshift_slime = { destcolor: [ 0, 25, 5 ], percent: 150 };
export const cshift_lava = { destcolor: [ 255, 80, 0 ], percent: 150 };

export const v_gamma = new cvar_t( 'gamma', '1', true );

const gammatable = new Uint8Array( 256 );

// GLQUAKE
const ramps = [ new Uint8Array( 256 ), new Uint8Array( 256 ), new Uint8Array( 256 ) ];
export const v_blend = new Float32Array( 4 ); // rgba 0.0 - 1.0

function BuildGammaTable( g ) {

	if ( g === 1.0 ) {

		for ( let i = 0; i < 256; i ++ )
			gammatable[ i ] = i;
		return;

	}

	for ( let i = 0; i < 256; i ++ ) {

		let inf = ( 255 * Math.pow( ( i + 0.5 ) / 255.5, g ) + 0.5 ) | 0;
		if ( inf < 0 )
			inf = 0;
		if ( inf > 255 )
			inf = 255;
		gammatable[ i ] = inf;

	}

}

/*
=================
V_CheckGamma
=================
*/
let _oldgammavalue = 0;

function V_CheckGamma() {

	if ( v_gamma.value === _oldgammavalue )
		return false;
	_oldgammavalue = v_gamma.value;

	BuildGammaTable( v_gamma.value );
	VID_UpdateGamma( v_gamma.value );
	// vid.recalc_refdef = 1;  // force a surface cache flush

	return true;

}

/*
===============
V_ParseDamage
===============
*/
export function V_ParseDamage() {

	const armor = MSG_ReadByte();
	const blood = MSG_ReadByte();
	const from = new Float32Array( 3 );
	for ( let i = 0; i < 3; i ++ )
		from[ i ] = MSG_ReadCoord();

	let count = blood * 0.5 + armor * 0.5;
	if ( count < 10 )
		count = 10;

	cl.faceanimtime = cl.time + 0.2; // put sbar face into pain frame

	cl.cshifts[ CSHIFT_DAMAGE ].percent += 3 * count;
	if ( cl.cshifts[ CSHIFT_DAMAGE ].percent < 0 )
		cl.cshifts[ CSHIFT_DAMAGE ].percent = 0;
	if ( cl.cshifts[ CSHIFT_DAMAGE ].percent > 150 )
		cl.cshifts[ CSHIFT_DAMAGE ].percent = 150;

	if ( armor > blood ) {

		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 0 ] = 200;
		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 1 ] = 100;
		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 2 ] = 100;

	} else if ( armor ) {

		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 0 ] = 220;
		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 1 ] = 50;
		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 2 ] = 50;

	} else {

		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 0 ] = 255;
		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 1 ] = 0;
		cl.cshifts[ CSHIFT_DAMAGE ].destcolor[ 2 ] = 0;

	}

	//
	// calculate view angle kicks
	// QuakeWorld uses predicted origin and angles for accurate damage kick
	//

	VectorSubtract( from, cl_simorg, from );
	VectorNormalize( from );

	const forward = new Float32Array( 3 );
	const right = new Float32Array( 3 );
	const up = new Float32Array( 3 );
	AngleVectors( cl_simangles, forward, right, up );

	let side = DotProduct( from, right );
	v_dmg_roll = count * side * v_kickroll.value;

	side = DotProduct( from, forward );
	v_dmg_pitch = count * side * v_kickpitch.value;

	v_dmg_time = v_kicktime.value;

}

/*
==================
V_cshift_f
==================
*/
function V_cshift_f() {

	cshift_empty.destcolor[ 0 ] = parseInt( Cmd_Argv( 1 ) ) || 0;
	cshift_empty.destcolor[ 1 ] = parseInt( Cmd_Argv( 2 ) ) || 0;
	cshift_empty.destcolor[ 2 ] = parseInt( Cmd_Argv( 3 ) ) || 0;
	cshift_empty.percent = parseInt( Cmd_Argv( 4 ) ) || 0;

}

/*
==================
V_BonusFlash_f

When you run over an item, the server sends this command
==================
*/
function V_BonusFlash_f() {

	cl.cshifts[ CSHIFT_BONUS ].destcolor[ 0 ] = 215;
	cl.cshifts[ CSHIFT_BONUS ].destcolor[ 1 ] = 186;
	cl.cshifts[ CSHIFT_BONUS ].destcolor[ 2 ] = 69;
	cl.cshifts[ CSHIFT_BONUS ].percent = 50;

}

/*
=============
V_SetContentsColor

Underwater, lava, etc each has a color shift
=============
*/
const CONTENTS_EMPTY = - 1;
const CONTENTS_SOLID = - 2;
const CONTENTS_WATER = - 3;
const CONTENTS_SLIME = - 4;
const CONTENTS_LAVA = - 5;

export function V_SetContentsColor( contents ) {

	switch ( contents ) {

		case CONTENTS_EMPTY:
		case CONTENTS_SOLID:
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 0 ] = cshift_empty.destcolor[ 0 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 1 ] = cshift_empty.destcolor[ 1 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 2 ] = cshift_empty.destcolor[ 2 ];
			cl.cshifts[ CSHIFT_CONTENTS ].percent = cshift_empty.percent;
			break;
		case CONTENTS_LAVA:
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 0 ] = cshift_lava.destcolor[ 0 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 1 ] = cshift_lava.destcolor[ 1 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 2 ] = cshift_lava.destcolor[ 2 ];
			cl.cshifts[ CSHIFT_CONTENTS ].percent = cshift_lava.percent;
			break;
		case CONTENTS_SLIME:
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 0 ] = cshift_slime.destcolor[ 0 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 1 ] = cshift_slime.destcolor[ 1 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 2 ] = cshift_slime.destcolor[ 2 ];
			cl.cshifts[ CSHIFT_CONTENTS ].percent = cshift_slime.percent;
			break;
		default:
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 0 ] = cshift_water.destcolor[ 0 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 1 ] = cshift_water.destcolor[ 1 ];
			cl.cshifts[ CSHIFT_CONTENTS ].destcolor[ 2 ] = cshift_water.destcolor[ 2 ];
			cl.cshifts[ CSHIFT_CONTENTS ].percent = cshift_water.percent;

	}

}

/*
=============
V_CalcPowerupCshift
=============
*/
function V_CalcPowerupCshift() {

	if ( cl.items & IT_QUAD ) {

		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 0 ] = 0;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 1 ] = 0;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 2 ] = 255;
		cl.cshifts[ CSHIFT_POWERUP ].percent = 30;

	} else if ( cl.items & IT_SUIT ) {

		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 0 ] = 0;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 1 ] = 255;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 2 ] = 0;
		cl.cshifts[ CSHIFT_POWERUP ].percent = 20;

	} else if ( cl.items & IT_INVISIBILITY ) {

		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 0 ] = 100;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 1 ] = 100;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 2 ] = 100;
		cl.cshifts[ CSHIFT_POWERUP ].percent = 100;

	} else if ( cl.items & IT_INVULNERABILITY ) {

		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 0 ] = 255;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 1 ] = 255;
		cl.cshifts[ CSHIFT_POWERUP ].destcolor[ 2 ] = 0;
		cl.cshifts[ CSHIFT_POWERUP ].percent = 30;

	} else
		cl.cshifts[ CSHIFT_POWERUP ].percent = 0;

}

/*
=============
V_CalcBlend
=============
*/
export function V_CalcBlend() {

	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;

	for ( let j = 0; j < NUM_CSHIFTS; j ++ ) {

		if ( gl_cshiftpercent.value === 0 )
			continue;

		let a2 = ( ( cl.cshifts[ j ].percent * gl_cshiftpercent.value ) / 100.0 ) / 255.0;

		if ( a2 === 0 )
			continue;
		a = a + a2 * ( 1 - a );
		a2 = a2 / a;
		r = r * ( 1 - a2 ) + cl.cshifts[ j ].destcolor[ 0 ] * a2;
		g = g * ( 1 - a2 ) + cl.cshifts[ j ].destcolor[ 1 ] * a2;
		b = b * ( 1 - a2 ) + cl.cshifts[ j ].destcolor[ 2 ] * a2;

	}

	v_blend[ 0 ] = r / 255.0;
	v_blend[ 1 ] = g / 255.0;
	v_blend[ 2 ] = b / 255.0;
	v_blend[ 3 ] = a;
	if ( v_blend[ 3 ] > 1 )
		v_blend[ 3 ] = 1;
	if ( v_blend[ 3 ] < 0 )
		v_blend[ 3 ] = 0;

}

/*
=============
V_UpdatePalette
=============
*/
export function V_UpdatePalette() {

	V_CalcPowerupCshift();

	let _new = false;

	for ( let i = 0; i < NUM_CSHIFTS; i ++ ) {

		if ( cl.cshifts[ i ].percent !== cl.prev_cshifts[ i ].percent ) {

			_new = true;
			cl.prev_cshifts[ i ].percent = cl.cshifts[ i ].percent;

		}

		for ( let j = 0; j < 3; j ++ )
			if ( cl.cshifts[ i ].destcolor[ j ] !== cl.prev_cshifts[ i ].destcolor[ j ] ) {

				_new = true;
				cl.prev_cshifts[ i ].destcolor[ j ] = cl.cshifts[ i ].destcolor[ j ];

			}

	}

	// drop the damage value
	cl.cshifts[ CSHIFT_DAMAGE ].percent -= host_frametime * 150;
	if ( cl.cshifts[ CSHIFT_DAMAGE ].percent <= 0 )
		cl.cshifts[ CSHIFT_DAMAGE ].percent = 0;

	// drop the bonus value
	cl.cshifts[ CSHIFT_BONUS ].percent -= host_frametime * 100;
	if ( cl.cshifts[ CSHIFT_BONUS ].percent <= 0 )
		cl.cshifts[ CSHIFT_BONUS ].percent = 0;

	const force = V_CheckGamma();
	if ( ! _new && ! force )
		return;

	V_CalcBlend();

}

/*
==============================================================================

						VIEW RENDERING

==============================================================================
*/

function angledelta( a ) {

	let result = anglemod( a );
	if ( result > 180 )
		result -= 360;
	return result;

}

/*
==================
CalcGunAngle
==================
*/
let _gun_oldyaw = 0;
let _gun_oldpitch = 0;

function CalcGunAngle() {

	let yaw = r_refdef.viewangles[ YAW ];
	let pitch = - r_refdef.viewangles[ PITCH ];

	yaw = angledelta( yaw - r_refdef.viewangles[ YAW ] ) * 0.4;
	if ( yaw > 10 )
		yaw = 10;
	if ( yaw < - 10 )
		yaw = - 10;
	pitch = angledelta( - pitch - r_refdef.viewangles[ PITCH ] ) * 0.4;
	if ( pitch > 10 )
		pitch = 10;
	if ( pitch < - 10 )
		pitch = - 10;
	const move = host_frametime * 20;
	if ( yaw > _gun_oldyaw ) {

		if ( _gun_oldyaw + move < yaw )
			yaw = _gun_oldyaw + move;

	} else {

		if ( _gun_oldyaw - move > yaw )
			yaw = _gun_oldyaw - move;

	}

	if ( pitch > _gun_oldpitch ) {

		if ( _gun_oldpitch + move < pitch )
			pitch = _gun_oldpitch + move;

	} else {

		if ( _gun_oldpitch - move > pitch )
			pitch = _gun_oldpitch - move;

	}

	_gun_oldyaw = yaw;
	_gun_oldpitch = pitch;

	cl.viewent.angles[ YAW ] = r_refdef.viewangles[ YAW ] + yaw;
	cl.viewent.angles[ PITCH ] = - ( r_refdef.viewangles[ PITCH ] + pitch );

	cl.viewent.angles[ ROLL ] -= v_idlescale.value * Math.sin( cl.time * v_iroll_cycle.value ) * v_iroll_level.value;
	cl.viewent.angles[ PITCH ] -= v_idlescale.value * Math.sin( cl.time * v_ipitch_cycle.value ) * v_ipitch_level.value;
	cl.viewent.angles[ YAW ] -= v_idlescale.value * Math.sin( cl.time * v_iyaw_cycle.value ) * v_iyaw_level.value;

}

/*
==============
V_BoundOffsets
==============
*/
function V_BoundOffsets( playerorg ) {

	// absolutely bound refresh reletive to entity clipping hull
	// so the view can never be inside a solid wall

	if ( r_refdef.vieworg[ 0 ] < playerorg[ 0 ] - 14 )
		r_refdef.vieworg[ 0 ] = playerorg[ 0 ] - 14;
	else if ( r_refdef.vieworg[ 0 ] > playerorg[ 0 ] + 14 )
		r_refdef.vieworg[ 0 ] = playerorg[ 0 ] + 14;
	if ( r_refdef.vieworg[ 1 ] < playerorg[ 1 ] - 14 )
		r_refdef.vieworg[ 1 ] = playerorg[ 1 ] - 14;
	else if ( r_refdef.vieworg[ 1 ] > playerorg[ 1 ] + 14 )
		r_refdef.vieworg[ 1 ] = playerorg[ 1 ] + 14;
	if ( r_refdef.vieworg[ 2 ] < playerorg[ 2 ] - 22 )
		r_refdef.vieworg[ 2 ] = playerorg[ 2 ] - 22;
	else if ( r_refdef.vieworg[ 2 ] > playerorg[ 2 ] + 30 )
		r_refdef.vieworg[ 2 ] = playerorg[ 2 ] + 30;

}

/*
==============
V_AddIdle

Idle swaying
==============
*/
function V_AddIdle() {

	r_refdef.viewangles[ ROLL ] += v_idlescale.value * Math.sin( cl.time * v_iroll_cycle.value ) * v_iroll_level.value;
	r_refdef.viewangles[ PITCH ] += v_idlescale.value * Math.sin( cl.time * v_ipitch_cycle.value ) * v_ipitch_level.value;
	r_refdef.viewangles[ YAW ] += v_idlescale.value * Math.sin( cl.time * v_iyaw_cycle.value ) * v_iyaw_level.value;

}

/*
==============
V_CalcViewRoll

Roll is induced by movement and damage
==============
*/
export function V_CalcViewRoll() {

	// QuakeWorld uses predicted angles and velocity for roll calculation
	const side = V_CalcRoll( cl_simangles, cl_simvel );
	r_refdef.viewangles[ ROLL ] += side;

	if ( v_dmg_time > 0 ) {

		r_refdef.viewangles[ ROLL ] += v_dmg_time / v_kicktime.value * v_dmg_roll;
		r_refdef.viewangles[ PITCH ] += v_dmg_time / v_kicktime.value * v_dmg_pitch;
		v_dmg_time -= host_frametime;

	}

	if ( cl.stats[ STAT_HEALTH ] <= 0 ) {

		r_refdef.viewangles[ ROLL ] = 80; // dead view angle
		return;

	}

}

/*
==================
V_CalcIntermissionRefdef

==================
*/
export function V_CalcIntermissionRefdef() {

	// view is the weapon model (only visible from inside body)
	const view = cl.viewent;

	// QuakeWorld uses predicted origin and angles for intermission view
	VectorCopy( cl_simorg, r_refdef.vieworg );
	VectorCopy( cl_simangles, r_refdef.viewangles );
	view.model = null;

	// allways idle in intermission
	const old = v_idlescale.value;
	v_idlescale.value = 1;
	V_AddIdle();
	v_idlescale.value = old;

}

/*
==================
V_CalcRefdef

==================
*/
let _oldz = 0;

// Cached arrays for V_CalcRefdef to avoid per-frame allocations
const _calcRefdef_angles = new Float32Array( 3 );
const _calcRefdef_forward = new Float32Array( 3 );
const _calcRefdef_right = new Float32Array( 3 );
const _calcRefdef_up = new Float32Array( 3 );

export function V_CalcRefdef() {

	V_DriftPitch();

	// ent is the player model (visible when out of body)
	const ent = cl_entities[ cl.viewentity ];
	// view is the weapon model (only visible from inside body)
	const view = cl.viewent;

	// Use predicted position for local player when running remotely (QuakeWorld-style prediction)
	// Use server-interpolated position when running locally, during demos, or if prediction is disabled
	// Also fall back to ent.origin if prediction hasn't been initialized (cl_simorg is zero)
	const usePrediction = ( ! sv.active ) && ( ! cls.demoplayback ) && ( cl_nopred.value === 0 );
	const predictionInitialized = cl_simorg[ 0 ] !== 0 || cl_simorg[ 1 ] !== 0 || cl_simorg[ 2 ] !== 0;
	const playerorg = ( usePrediction && predictionInitialized ) ? cl_simorg : ent.origin;

	// transform the view offset by the model's matrix to get the offset from
	// model origin for the view
	ent.angles[ YAW ] = cl.viewangles[ YAW ]; // the model should face the view dir
	ent.angles[ PITCH ] = - cl.viewangles[ PITCH ]; // the model should face the view dir

	const bob = V_CalcBob();

	// refresh position
	VectorCopy( playerorg, r_refdef.vieworg );
	r_refdef.vieworg[ 2 ] += cl.viewheight + bob;

	// never let it sit exactly on a node line, because a water plane can
	// dissapear when viewed with the eye exactly on it.
	// the server protocol only specifies to 1/16 pixel, so add 1/32 in each axis
	r_refdef.vieworg[ 0 ] += 1.0 / 32;
	r_refdef.vieworg[ 1 ] += 1.0 / 32;
	r_refdef.vieworg[ 2 ] += 1.0 / 32;

	VectorCopy( cl.viewangles, r_refdef.viewangles );
	V_CalcViewRoll();
	V_AddIdle();

	// offsets - QuakeWorld uses simangles for prediction
	const angles = _calcRefdef_angles;
	const forward = _calcRefdef_forward;
	const right = _calcRefdef_right;
	const up = _calcRefdef_up;
	if ( usePrediction && predictionInitialized ) {
		AngleVectors( cl_simangles, forward, right, up );
	} else {
		// Use entity angles like WinQuake for local play
		angles[ PITCH ] = - ent.angles[ PITCH ]; // because entity pitches are actually backward
		angles[ YAW ] = ent.angles[ YAW ];
		angles[ ROLL ] = ent.angles[ ROLL ];
		AngleVectors( angles, forward, right, up );
	}

	for ( let i = 0; i < 3; i ++ )
		r_refdef.vieworg[ i ] += scr_ofsx.value * forward[ i ]
			+ scr_ofsy.value * right[ i ]
			+ scr_ofsz.value * up[ i ];

	V_BoundOffsets( playerorg );

	// set up gun position - QuakeWorld uses simangles for prediction
	if ( usePrediction && predictionInitialized ) {
		VectorCopy( cl_simangles, view.angles );
	} else {
		VectorCopy( cl.viewangles, view.angles );
	}

	CalcGunAngle();

	VectorCopy( playerorg, view.origin );
	view.origin[ 2 ] += cl.viewheight;

	for ( let i = 0; i < 3; i ++ ) {

		view.origin[ i ] += forward[ i ] * bob * 0.4;

	}

	view.origin[ 2 ] += bob;

	// fudge position around to keep amount of weapon visible
	// roughly equal with different FOV
	// if ( scr_viewsize.value === 110 )
	//     view.origin[2] += 1;
	// else if ( scr_viewsize.value === 100 )
	//     view.origin[2] += 2;
	// else if ( scr_viewsize.value === 90 )
	//     view.origin[2] += 1;
	// else if ( scr_viewsize.value === 80 )
	//     view.origin[2] += 0.5;

	view.model = cl.model_precache[ cl.stats[ STAT_WEAPON ] ];
	view.frame = cl.stats[ STAT_WEAPONFRAME ];
	view.colormap = null; // vid.colormap

	// set up the refresh position
	VectorAdd( r_refdef.viewangles, cl.punchangle, r_refdef.viewangles );

	// smooth out stair step ups
	// QuakeWorld uses predicted onground state
	const onGround = ( usePrediction && predictionInitialized ) ? ( cl_simonground !== -1 ) : cl.onground;
	if ( onGround && playerorg[ 2 ] - _oldz > 0 ) {

		let steptime = cl.time - cl.oldtime;
		if ( steptime < 0 )
			steptime = 0;

		_oldz += steptime * 80;
		if ( _oldz > playerorg[ 2 ] )
			_oldz = playerorg[ 2 ];
		if ( playerorg[ 2 ] - _oldz > 12 )
			_oldz = playerorg[ 2 ] - 12;
		r_refdef.vieworg[ 2 ] += _oldz - playerorg[ 2 ];
		view.origin[ 2 ] += _oldz - playerorg[ 2 ];

	} else
		_oldz = playerorg[ 2 ];

	// if ( chase_active.value )
	//     Chase_Update();

}

/*
==================
V_RenderView

The player's clipping box goes from (-16 -16 -24) to (16 16 32) from
the entity origin, so any view position inside that will be valid
==================
*/
export function V_RenderView() {

	if ( con_forcedup )
		return;

	// don't allow cheats in multiplayer
	if ( cl.maxclients > 1 ) {

		Cvar_Set( 'scr_ofsx', '0' );
		Cvar_Set( 'scr_ofsy', '0' );
		Cvar_Set( 'scr_ofsz', '0' );

	}

	if ( cl.intermission ) {

		// intermission / finale rendering
		V_CalcIntermissionRefdef();

	} else {

		if ( ! cl.paused )
			V_CalcRefdef();

	}

	R_PushDlights( cl );

	// In VR mode, update the camera rig position
	if ( VID_IsInVR() ) {

		R_UpdateVRCamera( r_refdef.vieworg );

	}

	R_RenderView();

}

//============================================================================

/*
=============
V_Init
=============
*/
export function V_Init() {

	Cmd_AddCommand( 'v_cshift', V_cshift_f );
	Cmd_AddCommand( 'bf', V_BonusFlash_f );
	Cmd_AddCommand( 'centerview', V_StartPitchDrift );

	Cvar_RegisterVariable( lcd_x );
	Cvar_RegisterVariable( lcd_yaw );

	Cvar_RegisterVariable( v_centermove );
	Cvar_RegisterVariable( v_centerspeed );

	Cvar_RegisterVariable( v_iyaw_cycle );
	Cvar_RegisterVariable( v_iroll_cycle );
	Cvar_RegisterVariable( v_ipitch_cycle );
	Cvar_RegisterVariable( v_iyaw_level );
	Cvar_RegisterVariable( v_iroll_level );
	Cvar_RegisterVariable( v_ipitch_level );

	Cvar_RegisterVariable( v_idlescale );
	Cvar_RegisterVariable( crosshair );
	Cvar_RegisterVariable( cl_crossx );
	Cvar_RegisterVariable( cl_crossy );
	Cvar_RegisterVariable( gl_cshiftpercent );

	Cvar_RegisterVariable( scr_ofsx );
	Cvar_RegisterVariable( scr_ofsy );
	Cvar_RegisterVariable( scr_ofsz );
	Cvar_RegisterVariable( cl_rollspeed );
	Cvar_RegisterVariable( cl_rollangle );
	Cvar_RegisterVariable( cl_bob );
	Cvar_RegisterVariable( cl_bobcycle );
	Cvar_RegisterVariable( cl_bobup );

	Cvar_RegisterVariable( v_kicktime );
	Cvar_RegisterVariable( v_kickroll );
	Cvar_RegisterVariable( v_kickpitch );

	BuildGammaTable( 1.0 ); // no gamma yet
	Cvar_RegisterVariable( v_gamma );
	VID_UpdateGamma( v_gamma.value );

}
