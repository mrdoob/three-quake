// Ported from: WinQuake/pr_cmds.c -- QuakeC built-in functions

import {
	Con_Printf, Con_DPrintf,
	MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong,
	MSG_WriteCoord, MSG_WriteAngle, MSG_WriteString,
} from './common.js';
import {
	VectorCopy, VectorSubtract, VectorNormalize, VectorMA, VectorScale, VectorAdd,
	DotProduct, Length, AngleVectors, vec3_origin, anglemod, M_PI,
} from './mathlib.js';
import { MAX_MODELS, MAX_SOUNDS } from './quakedef.js';
import {
	OFS_RETURN, OFS_PARM0, OFS_PARM1, OFS_PARM2, OFS_PARM3,
	OFS_PARM4, OFS_PARM5, OFS_PARM6, OFS_PARM7,
} from './pr_comp.js';
import {
	progs, pr_functions,
	pr_global_struct, pr_globals_float, pr_globals_int,
	pr_argc, pr_trace, pr_xfunction,
	PR_GetString, PR_SetTrace, PR_SetXFunction,
	G_FLOAT, G_FLOAT_SET, G_INT, G_INT_SET, G_VECTOR, G_STRING, G_EDICT, G_EDICTNUM,
	EDICT_NUM, NUM_FOR_EDICT, NEXT_EDICT,
	EDICT_TO_PROG, PROG_TO_EDICT,
	RETURN_EDICT,
	E_STRING,
	sv,
	PR_SetBuiltins,
	PR_SetTempString,
} from './progs.js';
import {
	ED_Alloc, ED_Free, ED_Print, ED_PrintNum, ED_PrintEdicts,
	ED_FindFunction, ED_FindField,
} from './pr_edict.js';
import { PR_HostError, PR_RunError } from './pr_exec.js';
import { SV_Move, SV_LinkEdict, SV_PointContents } from './world.js';
import { SV_movestep, SV_CheckBottom, SV_MoveToGoal as SV_MoveToGoal_Real, SV_Move_SetCallbacks } from './sv_move.js';
import { SV_StartSound, SV_StartParticle, sv_aim } from './sv_main.js';
import { Cbuf_AddText } from './cmd.js';
import { Cvar_VariableValue, Cvar_Set } from './cvar.js';
import { FL_ONGROUND, FL_FLY, FL_SWIM, svs, ss_loading, ss_active } from './server.js';
import { Mod_ForName, Mod_PointInLeaf, Mod_LeafPVS } from './gl_model.js';
import {
	svc_sound, svc_print, svc_centerprint, svc_stufftext, svc_lightstyle,
	svc_spawnstatic, svc_spawnstaticsound,
} from './protocol.js';

/*
===============================================================================

						BUILT-IN FUNCTIONS

===============================================================================
*/

function PF_VarString( first ) {

	// Use array.join() instead of string concatenation to avoid O(n²) allocations
	const parts = [];
	for ( let i = first; i < pr_argc; i ++ ) {

		parts.push( G_STRING( OFS_PARM0 + i * 3 ) );

	}

	return parts.join( '' );

}

/*
=================
PF_error

This is a TERMINAL error, which will kill off the entire server.
Dumps self.

error(value)
=================
*/
function PF_error() {

	const s = PF_VarString( 0 );
	Con_Printf( '======SERVER ERROR in %s:\n%s\n',
		PR_GetString( pr_xfunction.s_name ), s );
	const ed = PROG_TO_EDICT( pr_global_struct.self );
	ED_Print( ed );

	PR_HostError( 'Program error' );

}

/*
=================
PF_objerror

Dumps out self, then an error message. The program is aborted and self is
removed, but the level can continue.

objerror(value)
=================
*/
function PF_objerror() {

	const s = PF_VarString( 0 );
	Con_Printf( '======OBJECT ERROR in %s:\n%s\n',
		PR_GetString( pr_xfunction.s_name ), s );
	const ed = PROG_TO_EDICT( pr_global_struct.self );
	ED_Print( ed );
	ED_Free( ed );

	PR_HostError( 'Program error' );

}

/*
==============
PF_makevectors

Writes new values for v_forward, v_up, and v_right based on angles
makevectors(vector)
==============
*/
function PF_makevectors() {

	const ang = G_VECTOR( OFS_PARM0 );
	const forward = pr_global_struct.v_forward;
	const right = pr_global_struct.v_right;
	const up = pr_global_struct.v_up;
	AngleVectors( ang, forward, right, up );

}

/*
=================
PF_setorigin

setorigin (entity, origin)
=================
*/
function PF_setorigin() {

	const e = G_EDICT( OFS_PARM0 );
	const org = G_VECTOR( OFS_PARM1 );
	VectorCopy( org, e.v.origin );
	SV_LinkEdict( e, false );

}

/*
=================
PF_setsize

the size box is rotated by the current angle

setsize (entity, minvector, maxvector)
=================
*/
function PF_setsize() {

	const e = G_EDICT( OFS_PARM0 );
	const min = G_VECTOR( OFS_PARM1 );
	const max = G_VECTOR( OFS_PARM2 );

	for ( let i = 0; i < 3; i ++ ) {

		if ( min[ i ] > max[ i ] )
			PR_RunError( 'backwards mins/maxs' );

	}

	VectorCopy( min, e.v.mins );
	VectorCopy( max, e.v.maxs );
	VectorSubtract( max, min, e.v.size );

	SV_LinkEdict( e, false );

}

/*
=================
PF_setmodel

setmodel(entity, model)
=================
*/
function PF_setmodel() {

	const e = G_EDICT( OFS_PARM0 );
	const m = G_STRING( OFS_PARM1 );

	// check to see if model was properly precached
	let i = 0;
	if ( sv.model_precache ) {

		for ( i = 0; i < sv.model_precache.length; i ++ ) {

			if ( sv.model_precache[ i ] == null ) break;
			if ( sv.model_precache[ i ] === m ) break;

		}

		if ( i >= sv.model_precache.length || sv.model_precache[ i ] == null )
			PR_RunError( 'no precache: %s\n', m );

	}

	e.v.model = G_INT( OFS_PARM1 );
	e.v.modelindex = i;

	// Set mins/maxs from model if available
	if ( sv.models && sv.models[ i ] ) {

		const mod = sv.models[ i ];
		VectorCopy( mod.mins, e.v.mins );
		VectorCopy( mod.maxs, e.v.maxs );
		VectorSubtract( mod.maxs, mod.mins, e.v.size );

	} else {

		VectorCopy( vec3_origin, e.v.mins );
		VectorCopy( vec3_origin, e.v.maxs );
		VectorCopy( vec3_origin, e.v.size );

	}

	SV_LinkEdict( e, false );

}

/*
=================
PF_bprint

broadcast print to everyone on server

bprint(value)
=================
*/
function PF_bprint() {

	const s = PF_VarString( 0 );
	Con_Printf( '%s', s );

	// send to all clients
	for ( let i = 0; i < svs.maxclients; i ++ ) {

		const client = svs.clients[ i ];
		if ( ! client || ! client.active ) continue;
		MSG_WriteByte( client.message, svc_print );
		MSG_WriteString( client.message, s );

	}

}

/*
=================
PF_sprint

single print to a specific client

sprint(clientent, value)
=================
*/
function PF_sprint() {

	const entnum = G_EDICTNUM( OFS_PARM0 );
	const s = PF_VarString( 1 );

	if ( entnum < 1 || entnum > ( svs.maxclients || 1 ) ) {

		Con_Printf( 'tried to sprint to a non-client\n' );
		return;

	}

	const client = svs.clients[ entnum - 1 ];
	if ( client ) {

		MSG_WriteByte( client.message, svc_print );
		MSG_WriteString( client.message, s );

	}

}

/*
=================
PF_centerprint

single print to a specific client

centerprint(clientent, value)
=================
*/
function PF_centerprint() {

	const entnum = G_EDICTNUM( OFS_PARM0 );
	const s = PF_VarString( 1 );

	if ( entnum < 1 || entnum > ( svs.maxclients || 1 ) ) {

		Con_Printf( 'tried to sprint to a non-client\n' );
		return;

	}

	const client = svs.clients[ entnum - 1 ];
	if ( client ) {

		MSG_WriteByte( client.message, svc_centerprint );
		MSG_WriteString( client.message, s );

	}

}

/*
=================
PF_normalize

vector normalize(vector)
=================
*/
function PF_normalize() {

	const value1 = G_VECTOR( OFS_PARM0 );

	let len = value1[ 0 ] * value1[ 0 ] + value1[ 1 ] * value1[ 1 ] + value1[ 2 ] * value1[ 2 ];
	len = Math.sqrt( len );

	const ret = G_VECTOR( OFS_RETURN );
	if ( len === 0 ) {

		ret[ 0 ] = ret[ 1 ] = ret[ 2 ] = 0;

	} else {

		len = 1 / len;
		ret[ 0 ] = value1[ 0 ] * len;
		ret[ 1 ] = value1[ 1 ] * len;
		ret[ 2 ] = value1[ 2 ] * len;

	}

}

/*
=================
PF_vlen

scalar vlen(vector)
=================
*/
function PF_vlen() {

	const value1 = G_VECTOR( OFS_PARM0 );

	let len = value1[ 0 ] * value1[ 0 ] + value1[ 1 ] * value1[ 1 ] + value1[ 2 ] * value1[ 2 ];
	len = Math.sqrt( len );

	G_FLOAT_SET( OFS_RETURN, len );

}

/*
=================
PF_vectoyaw

float vectoyaw(vector)
=================
*/
function PF_vectoyaw() {

	const value1 = G_VECTOR( OFS_PARM0 );
	let yaw;

	if ( value1[ 1 ] === 0 && value1[ 0 ] === 0 ) {

		yaw = 0;

	} else {

		yaw = ( Math.atan2( value1[ 1 ], value1[ 0 ] ) * 180 / M_PI ) | 0;
		if ( yaw < 0 )
			yaw += 360;

	}

	G_FLOAT_SET( OFS_RETURN, yaw );

}

/*
=================
PF_vectoangles

vector vectoangles(vector)
=================
*/
function PF_vectoangles() {

	const value1 = G_VECTOR( OFS_PARM0 );
	let yaw, pitch;

	if ( value1[ 1 ] === 0 && value1[ 0 ] === 0 ) {

		yaw = 0;
		if ( value1[ 2 ] > 0 )
			pitch = 90;
		else
			pitch = 270;

	} else {

		yaw = ( Math.atan2( value1[ 1 ], value1[ 0 ] ) * 180 / M_PI ) | 0;
		if ( yaw < 0 )
			yaw += 360;

		const forward = Math.sqrt( value1[ 0 ] * value1[ 0 ] + value1[ 1 ] * value1[ 1 ] );
		pitch = ( Math.atan2( value1[ 2 ], forward ) * 180 / M_PI ) | 0;
		if ( pitch < 0 )
			pitch += 360;

	}

	G_FLOAT_SET( OFS_RETURN, pitch );
	G_FLOAT_SET( OFS_RETURN + 1, yaw );
	G_FLOAT_SET( OFS_RETURN + 2, 0 );

}

/*
=================
PF_Random

Returns a number from 0<= num < 1

random()
=================
*/
function PF_random() {

	G_FLOAT_SET( OFS_RETURN, Math.random() );

}

/*
=================
PF_particle

particle(origin, color, count)
=================
*/
function PF_particle() {

	const org = G_VECTOR( OFS_PARM0 );
	const dir = G_VECTOR( OFS_PARM1 );
	const color = G_FLOAT( OFS_PARM2 );
	const count = G_FLOAT( OFS_PARM3 );
	SV_StartParticle( org, dir, color, count );

}

/*
=================
PF_ambientsound
=================
*/
function PF_ambientsound() {

	const pos = G_VECTOR( OFS_PARM0 );
	const samp = G_STRING( OFS_PARM1 );
	const vol = G_FLOAT( OFS_PARM2 );
	const attenuation = G_FLOAT( OFS_PARM3 );

	// find the sound in the precache list
	let soundnum;
	for ( soundnum = 0; soundnum < MAX_SOUNDS; soundnum ++ ) {

		if ( sv.sound_precache[ soundnum ] == null ) break;
		if ( samp === sv.sound_precache[ soundnum ] ) break;

	}

	if ( soundnum >= MAX_SOUNDS || sv.sound_precache[ soundnum ] == null ) {

		Con_Printf( 'no precache: %s\n', samp );
		return;

	}

	// write it to the signon buffer
	MSG_WriteByte( sv.signon, svc_spawnstaticsound );
	for ( let i = 0; i < 3; i ++ )
		MSG_WriteCoord( sv.signon, pos[ i ] );

	MSG_WriteByte( sv.signon, soundnum );
	MSG_WriteByte( sv.signon, ( vol * 255 ) | 0 );
	MSG_WriteByte( sv.signon, ( attenuation * 64 ) | 0 );

}

/*
=================
PF_sound

Each entity can have eight independent sound sources, like voice,
weapon, feet, etc.
=================
*/
function PF_sound() {

	const entity = G_EDICT( OFS_PARM0 );
	const channel = G_FLOAT( OFS_PARM1 ) | 0;
	const sample = G_STRING( OFS_PARM2 );
	const volume = ( G_FLOAT( OFS_PARM3 ) * 255 ) | 0;
	const attenuation = G_FLOAT( OFS_PARM4 );

	SV_StartSound( entity, channel, sample, volume, attenuation );

}

/*
=================
PF_break

break()
=================
*/
function PF_break() {

	Con_Printf( 'break statement\n' );
	// In C this dumps to debugger; in JS we just log
	debugger; // eslint-disable-line no-debugger

}

/*
=================
PF_traceline

Used for use tracing and shot targeting

traceline (vector1, vector2, tryents, ignore)
=================
*/
function PF_traceline() {

	const v1 = G_VECTOR( OFS_PARM0 );
	const v2 = G_VECTOR( OFS_PARM1 );
	const nomonsters = G_FLOAT( OFS_PARM2 ) | 0;
	const ent = G_EDICT( OFS_PARM3 );

	const trace = SV_Move( v1, vec3_origin, vec3_origin, v2, nomonsters, ent );

	pr_global_struct.trace_allsolid = trace.allsolid ? 1 : 0;
	pr_global_struct.trace_startsolid = trace.startsolid ? 1 : 0;
	pr_global_struct.trace_fraction = trace.fraction;
	VectorCopy( trace.endpos, pr_global_struct.trace_endpos );
	VectorCopy( trace.plane.normal, pr_global_struct.trace_plane_normal );
	pr_global_struct.trace_plane_dist = trace.plane.dist;
	if ( trace.ent != null )
		pr_global_struct.trace_ent = EDICT_TO_PROG( trace.ent );
	else
		pr_global_struct.trace_ent = EDICT_TO_PROG( sv.edicts[ 0 ] );
	pr_global_struct.trace_inopen = trace.inopen ? 1 : 0;
	pr_global_struct.trace_inwater = trace.inwater ? 1 : 0;

}

/*
=================
PF_checkpos

Returns true if the given entity can move to the given position from its
current position by walking or rolling.
Not implemented in original Quake either (dead code in id's source).
scalar checkpos (entity, vector)
=================
*/
function PF_checkpos() {

}

/*
=================
PF_checkclient

Returns a client (or object that has a client enemy) that would be a
valid target.
=================
*/
let checkpvs = null;

function PF_newcheckclient( check ) {

	// cycle to the next one
	if ( check < 1 )
		check = 1;
	if ( check > svs.maxclients )
		check = svs.maxclients;

	let i;
	if ( check === svs.maxclients )
		i = 1;
	else
		i = check + 1;

	let ent;
	for ( ; ; i ++ ) {

		if ( i === svs.maxclients + 1 )
			i = 1;

		ent = EDICT_NUM( i );

		if ( i === check )
			break; // didn't find anything else

		if ( ent.free )
			continue;
		if ( ent.v.health <= 0 )
			continue;
		if ( ( ent.v.flags | 0 ) & 128 ) // FL_NOTARGET
			continue;

		// anything that is a client, or has a client as an enemy
		break;

	}

	// get the PVS for the entity
	if ( sv.worldmodel ) {

		const org = new Float32Array( 3 );
		VectorAdd( ent.v.origin, ent.v.view_ofs, org );
		const leaf = Mod_PointInLeaf( org, sv.worldmodel );
		const pvs = Mod_LeafPVS( leaf, sv.worldmodel );
		const numBytes = ( sv.worldmodel.numleafs + 7 ) >> 3;
		if ( ! checkpvs || checkpvs.length < numBytes )
			checkpvs = new Uint8Array( numBytes );
		checkpvs.set( pvs.subarray( 0, numBytes ) );

	}

	return i;

}

function PF_checkclient() {

	// find a new check if on a new frame
	if ( sv.time - sv.lastchecktime >= 0.1 ) {

		sv.lastcheck = PF_newcheckclient( sv.lastcheck );
		sv.lastchecktime = sv.time;

	}

	// return check if it might be visible
	const ent = EDICT_NUM( sv.lastcheck );
	if ( ent.free || ent.v.health <= 0 ) {

		RETURN_EDICT( sv.edicts[ 0 ] );
		return;

	}

	// if current entity can't possibly see the check entity, return 0
	if ( sv.worldmodel && checkpvs ) {

		const self = PROG_TO_EDICT( pr_global_struct.self );
		const view = new Float32Array( 3 );
		VectorAdd( self.v.origin, self.v.view_ofs, view );
		const leaf = Mod_PointInLeaf( view, sv.worldmodel );
		// get leaf index: leaf._leafIndex is set during BSP load
		const l = ( leaf._leafIndex != null ? leaf._leafIndex : - 1 ) - 1;
		if ( l < 0 || ! ( checkpvs[ l >> 3 ] & ( 1 << ( l & 7 ) ) ) ) {

			RETURN_EDICT( sv.edicts[ 0 ] );
			return;

		}

	}

	// might be able to see it
	RETURN_EDICT( ent );

}

/*
=================
PF_stuffcmd

Sends text over to the client's execution buffer

stuffcmd (clientent, value)
=================
*/
function PF_stuffcmd() {

	const entnum = G_EDICTNUM( OFS_PARM0 );
	if ( entnum < 1 || entnum > ( svs.maxclients || 1 ) )
		PR_RunError( 'Parm 0 not a client' );

	const str = G_STRING( OFS_PARM1 );
	const client = svs.clients[ entnum - 1 ];
	if ( client ) {

		MSG_WriteByte( client.message, svc_stufftext );
		MSG_WriteString( client.message, str );

	}

}

/*
=================
PF_localcmd

Sends text to the server's command buffer

localcmd (string)
=================
*/
function PF_localcmd() {

	const str = G_STRING( OFS_PARM0 );
	Cbuf_AddText( str );

}

/*
=================
PF_cvar

float cvar (string)
=================
*/
function PF_cvar() {

	const str = G_STRING( OFS_PARM0 );
	G_FLOAT_SET( OFS_RETURN, Cvar_VariableValue( str ) );

}

/*
=================
PF_cvar_set

float cvar (string)
=================
*/
function PF_cvar_set() {

	const varName = G_STRING( OFS_PARM0 );
	const val = G_STRING( OFS_PARM1 );
	Cvar_Set( varName, val );

}

/*
=================
PF_findradius

Returns a chain of entities that have origins within a spherical area

findradius (origin, radius)
=================
*/
function PF_findradius() {

	let chain = sv.edicts[ 0 ];

	const org = G_VECTOR( OFS_PARM0 );
	const rad = G_FLOAT( OFS_PARM1 );

	const eorg = new Float32Array( 3 );

	for ( let i = 1; i < sv.num_edicts; i ++ ) {

		const ent = EDICT_NUM( i );
		if ( ent.free )
			continue;
		if ( ent.v.solid === 0 ) // SOLID_NOT
			continue;
		for ( let j = 0; j < 3; j ++ )
			eorg[ j ] = org[ j ] - ( ent.v.origin[ j ] + ( ent.v.mins[ j ] + ent.v.maxs[ j ] ) * 0.5 );
		if ( Length( eorg ) > rad )
			continue;

		ent.v.chain = EDICT_TO_PROG( chain );
		chain = ent;

	}

	RETURN_EDICT( chain );

}

/*
=========
PF_dprint
=========
*/
function PF_dprint() {

	Con_DPrintf( '%s', PF_VarString( 0 ) );

}

// Temp string for ftos/vtos (in C this is a static buffer in pr_strings space)
function PF_ftos() {

	const v = G_FLOAT( OFS_PARM0 );
	let str;

	if ( v === ( v | 0 ) )
		str = String( v | 0 );
	else
		str = v.toFixed( 1 );

	// Write into the fixed pr_string_temp area (reused each call, like C)
	const ofs = PR_SetTempString( str );
	G_INT_SET( OFS_RETURN, ofs );

}

function PF_fabs() {

	const v = G_FLOAT( OFS_PARM0 );
	G_FLOAT_SET( OFS_RETURN, Math.abs( v ) );

}

function PF_vtos() {

	const v = G_VECTOR( OFS_PARM0 );
	const str = '\'' + v[ 0 ].toFixed( 1 ) + ' ' + v[ 1 ].toFixed( 1 ) + ' ' + v[ 2 ].toFixed( 1 ) + '\'';

	// Write into the fixed pr_string_temp area (reused each call, like C)
	const ofs = PR_SetTempString( str );
	G_INT_SET( OFS_RETURN, ofs );

}

function PF_Spawn() {

	const ed = ED_Alloc();
	RETURN_EDICT( ed );

}

function PF_Remove() {

	const ed = G_EDICT( OFS_PARM0 );
	ED_Free( ed );

}

// entity (entity start, .string field, string match) find = #5;
function PF_Find() {

	let e = G_EDICTNUM( OFS_PARM0 );
	const f = G_INT( OFS_PARM1 );
	const s = G_STRING( OFS_PARM2 );

	if ( ! s )
		PR_RunError( 'PF_Find: bad search string' );

	for ( e ++; e < sv.num_edicts; e ++ ) {

		const ed = EDICT_NUM( e );
		if ( ed.free )
			continue;
		const t = E_STRING( ed, f );
		if ( ! t )
			continue;
		if ( t === s ) {

			RETURN_EDICT( ed );
			return;

		}

	}

	RETURN_EDICT( sv.edicts[ 0 ] );

}

function PR_CheckEmptyString( s ) {

	if ( s == null || s.length === 0 || s.charCodeAt( 0 ) <= 32 )
		PR_RunError( 'Bad string' );

}

function PF_precache_file() {

	// precache_file is only used to copy files with qcc, it does nothing
	G_INT_SET( OFS_RETURN, G_INT( OFS_PARM0 ) );

}

function PF_precache_sound() {

	const s = G_STRING( OFS_PARM0 );
	G_INT_SET( OFS_RETURN, G_INT( OFS_PARM0 ) );
	PR_CheckEmptyString( s );

	if ( sv.state !== ss_loading )
		PR_RunError( 'PF_Precache_*: Precache can only be done in spawn functions' );

	if ( sv.sound_precache ) {

		for ( let i = 0; i < MAX_SOUNDS; i ++ ) {

			if ( sv.sound_precache[ i ] == null ) {

				sv.sound_precache[ i ] = s;
				return;

			}

			if ( sv.sound_precache[ i ] === s )
				return;

		}

		PR_RunError( 'PF_precache_sound: overflow' );

	}

}

function PF_precache_model() {

	const s = G_STRING( OFS_PARM0 );
	G_INT_SET( OFS_RETURN, G_INT( OFS_PARM0 ) );
	PR_CheckEmptyString( s );

	if ( sv.state !== ss_loading )
		PR_RunError( 'PF_Precache_*: Precache can only be done in spawn functions' );

	if ( sv.model_precache ) {

		for ( let i = 0; i < MAX_MODELS; i ++ ) {

			if ( sv.model_precache[ i ] == null ) {

				sv.model_precache[ i ] = s;
				sv.models[ i ] = Mod_ForName( s, true );
				return;

			}

			if ( sv.model_precache[ i ] === s )
				return;

		}

		PR_RunError( 'PF_precache_model: overflow' );

	}

}

function PF_coredump() {

	ED_PrintEdicts();

}

function PF_traceon() {

	PR_SetTrace( true );

}

function PF_traceoff() {

	PR_SetTrace( false );

}

function PF_eprint() {

	ED_PrintNum( G_EDICTNUM( OFS_PARM0 ) );

}

/*
===============
PF_walkmove

float(float yaw, float dist) walkmove
===============
*/
function PF_walkmove() {

	const ent = PROG_TO_EDICT( pr_global_struct.self );
	const yaw = G_FLOAT( OFS_PARM0 );
	const dist = G_FLOAT( OFS_PARM1 );

	if ( ! ( ( ent.v.flags | 0 ) & ( FL_ONGROUND | FL_FLY | FL_SWIM ) ) ) {

		G_FLOAT_SET( OFS_RETURN, 0 );
		return;

	}

	const yawRad = yaw * M_PI / 180;
	const move = new Float32Array( 3 );
	move[ 0 ] = Math.cos( yawRad ) * dist;
	move[ 1 ] = Math.sin( yawRad ) * dist;
	move[ 2 ] = 0;

	// save program state, because SV_movestep may call other progs
	const oldf = pr_xfunction;
	const oldself = pr_global_struct.self;

	G_FLOAT_SET( OFS_RETURN, SV_movestep( ent, move, true ) ? 1 : 0 );

	// restore program state
	PR_SetXFunction( oldf );
	pr_global_struct.self = oldself;

}

/*
===============
PF_droptofloor

void() droptofloor
===============
*/
function PF_droptofloor() {

	const ent = PROG_TO_EDICT( pr_global_struct.self );

	const end = new Float32Array( 3 );
	VectorCopy( ent.v.origin, end );
	end[ 2 ] -= 256;

	const trace = SV_Move( ent.v.origin, ent.v.mins, ent.v.maxs, end, false, ent );

	if ( trace.fraction === 1 || trace.allsolid ) {

		G_FLOAT_SET( OFS_RETURN, 0 );

	} else {

		VectorCopy( trace.endpos, ent.v.origin );
		SV_LinkEdict( ent, false );
		ent.v.flags = ( ent.v.flags | 0 ) | FL_ONGROUND;
		ent.v.groundentity = EDICT_TO_PROG( trace.ent );
		G_FLOAT_SET( OFS_RETURN, 1 );

	}

}

/*
===============
PF_lightstyle

void(float style, string value) lightstyle
===============
*/
function PF_lightstyle() {

	const style = G_FLOAT( OFS_PARM0 ) | 0;
	const val = G_STRING( OFS_PARM1 );

	// change the string in sv
	if ( sv.lightstyles ) {

		sv.lightstyles[ style ] = val;

	}

	// send message to all clients on this server
	if ( sv.state !== ss_active )
		return;

	for ( let j = 0; j < svs.maxclients; j ++ ) {

		const client = svs.clients[ j ];
		if ( ! client ) continue;
		if ( client.active || client.spawned ) {

			MSG_WriteChar( client.message, svc_lightstyle );
			MSG_WriteChar( client.message, style );
			MSG_WriteString( client.message, val );

		}

	}

}

function PF_rint() {

	const f = G_FLOAT( OFS_PARM0 );
	if ( f > 0 )
		G_FLOAT_SET( OFS_RETURN, ( f + 0.5 ) | 0 );
	else
		G_FLOAT_SET( OFS_RETURN, ( f - 0.5 ) | 0 );

}

function PF_floor() {

	G_FLOAT_SET( OFS_RETURN, Math.floor( G_FLOAT( OFS_PARM0 ) ) );

}

function PF_ceil() {

	G_FLOAT_SET( OFS_RETURN, Math.ceil( G_FLOAT( OFS_PARM0 ) ) );

}

/*
=============
PF_checkbottom
=============
*/
function PF_checkbottom() {

	const ent = G_EDICT( OFS_PARM0 );
	G_FLOAT_SET( OFS_RETURN, SV_CheckBottom( ent ) ? 1 : 0 );

}

/*
=============
PF_pointcontents
=============
*/
function PF_pointcontents() {

	const v = G_VECTOR( OFS_PARM0 );
	G_FLOAT_SET( OFS_RETURN, SV_PointContents( v ) );

}

/*
=============
PF_nextent

entity nextent(entity)
=============
*/
function PF_nextent() {

	let i = G_EDICTNUM( OFS_PARM0 );

	while ( true ) {

		i ++;
		if ( i === sv.num_edicts ) {

			RETURN_EDICT( sv.edicts[ 0 ] );
			return;

		}

		const ent = EDICT_NUM( i );
		if ( ! ent.free ) {

			RETURN_EDICT( ent );
			return;

		}

	}

}

/*
=============
PF_aim

Pick a vector for the player to shoot along
vector aim(entity, missilespeed)
=============
*/
const DAMAGE_AIM = 2;

function PF_aim() {

	const ent = G_EDICT( OFS_PARM0 );
	// speed = G_FLOAT( OFS_PARM1 ); // not used in original C

	const start = new Float32Array( 3 );
	const dir = new Float32Array( 3 );
	const end = new Float32Array( 3 );
	const bestdir = new Float32Array( 3 );

	VectorCopy( ent.v.origin, start );
	start[ 2 ] += 20;

	// try sending a trace straight
	VectorCopy( pr_global_struct.v_forward, dir );
	VectorMA( start, 2048, dir, end );
	const tr = SV_Move( start, vec3_origin, vec3_origin, end, false, ent );
	if ( tr.ent && tr.ent.v.takedamage === DAMAGE_AIM
		&& ( ! pr_global_struct.teamplay || ent.v.team <= 0 || ent.v.team !== tr.ent.v.team ) ) {

		const ret = G_VECTOR( OFS_RETURN );
		VectorCopy( pr_global_struct.v_forward, ret );
		return;

	}

	// try all possible entities
	VectorCopy( dir, bestdir );
	let bestdist = sv_aim.value;
	let bestent = null;

	for ( let i = 1; i < sv.num_edicts; i ++ ) {

		const check = EDICT_NUM( i );
		if ( check.v.takedamage !== DAMAGE_AIM )
			continue;
		if ( check === ent )
			continue;
		if ( pr_global_struct.teamplay && ent.v.team > 0 && ent.v.team === check.v.team )
			continue; // don't aim at teammate

		for ( let j = 0; j < 3; j ++ )
			end[ j ] = check.v.origin[ j ] + 0.5 * ( check.v.mins[ j ] + check.v.maxs[ j ] );
		VectorSubtract( end, start, dir );
		VectorNormalize( dir );
		const dist = DotProduct( dir, pr_global_struct.v_forward );
		if ( dist < bestdist )
			continue; // too far to turn
		const tr2 = SV_Move( start, vec3_origin, vec3_origin, end, false, ent );
		if ( tr2.ent === check ) {

			// can shoot at this one
			bestdist = dist;
			bestent = check;

		}

	}

	const ret = G_VECTOR( OFS_RETURN );
	if ( bestent != null ) {

		VectorSubtract( bestent.v.origin, ent.v.origin, dir );
		const dist = DotProduct( dir, pr_global_struct.v_forward );
		VectorScale( pr_global_struct.v_forward, dist, end );
		end[ 2 ] = dir[ 2 ];
		VectorNormalize( end );
		VectorCopy( end, ret );

	} else {

		VectorCopy( bestdir, ret );

	}

}

/*
==============
PF_changeyaw

This was a major timewaster in progs, so it was converted to C
==============
*/
function PF_changeyaw() {

	const ent = PROG_TO_EDICT( pr_global_struct.self );
	let current = anglemod( ent.v.angles[ 1 ] );
	const ideal = ent.v.ideal_yaw;
	const speed = ent.v.yaw_speed;

	if ( current === ideal )
		return;

	let move = ideal - current;
	if ( ideal > current ) {

		if ( move >= 180 )
			move = move - 360;

	} else {

		if ( move <= - 180 )
			move = move + 360;

	}

	if ( move > 0 ) {

		if ( move > speed )
			move = speed;

	} else {

		if ( move < - speed )
			move = - speed;

	}

	ent.v.angles[ 1 ] = anglemod( current + move );

}

//===============================================================================
// MESSAGE WRITING
//===============================================================================

const MSG_BROADCAST = 0; // unreliable to all
const MSG_ONE = 1; // reliable to one (msg_entity)
const MSG_ALL = 2; // reliable to all
const MSG_INIT = 3; // write to the init string

function WriteDest() {

	const dest = G_FLOAT( OFS_PARM0 ) | 0;

	switch ( dest ) {

		case MSG_BROADCAST:
			return sv.datagram;
		case MSG_ONE: {

			const ent = PROG_TO_EDICT( pr_global_struct.msg_entity );
			const entnum = NUM_FOR_EDICT( ent );
			if ( entnum < 1 || entnum > ( svs.maxclients || 1 ) ) {

				PR_RunError( 'WriteDest: not a client' );
				return null;

			}

			const client = svs.clients[ entnum - 1 ];
			return client.message;

		}

		case MSG_ALL:
			return sv.reliable_datagram;
		case MSG_INIT:
			return sv.signon;
		default:
			PR_RunError( 'WriteDest: bad destination' );
			return null;

	}

}

function PF_WriteByte() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteByte( dest, G_FLOAT( OFS_PARM1 ) | 0 );

}

function PF_WriteChar() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteChar( dest, G_FLOAT( OFS_PARM1 ) | 0 );

}

function PF_WriteShort() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteShort( dest, G_FLOAT( OFS_PARM1 ) | 0 );

}

function PF_WriteLong() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteLong( dest, G_FLOAT( OFS_PARM1 ) | 0 );

}

function PF_WriteCoord() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteCoord( dest, G_FLOAT( OFS_PARM1 ) );

}

function PF_WriteAngle() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteAngle( dest, G_FLOAT( OFS_PARM1 ) );

}

function PF_WriteString() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteString( dest, G_STRING( OFS_PARM1 ) );

}

function PF_WriteEntity() {

	const dest = WriteDest();
	if ( dest ) MSG_WriteShort( dest, NUM_FOR_EDICT( G_EDICT( OFS_PARM1 ) ) );

}

//=============================================================================

function PF_makestatic() {

	const ent = G_EDICT( OFS_PARM0 );

	MSG_WriteByte( sv.signon, svc_spawnstatic );
	MSG_WriteByte( sv.signon, ent.v.modelindex | 0 );
	MSG_WriteByte( sv.signon, ent.v.frame | 0 );
	MSG_WriteByte( sv.signon, ent.v.colormap | 0 );
	MSG_WriteByte( sv.signon, ent.v.skin | 0 );
	for ( let i = 0; i < 3; i ++ ) {

		MSG_WriteCoord( sv.signon, ent.v.origin[ i ] );
		MSG_WriteAngle( sv.signon, ent.v.angles[ i ] );

	}

	// throw the entity away now
	ED_Free( ent );

}

/*
==============
PF_setspawnparms
==============
*/
function PF_setspawnparms() {

	const ent = G_EDICT( OFS_PARM0 );
	const i = NUM_FOR_EDICT( ent );
	if ( i < 1 || i > svs.maxclients )
		PR_RunError( 'Entity is not a client' );

	// copy spawn parms out of the client_t
	const client = svs.clients[ i - 1 ];
	for ( let j = 0; j < 16; j ++ ) // NUM_SPAWN_PARMS = 16

		pr_global_struct[ 'parm' + ( j + 1 ) ] = client.spawn_parms[ j ];

}

/*
==============
PF_changelevel
==============
*/
function PF_changelevel() {

	// make sure we don't issue two changelevels
	if ( svs.changelevel_issued )
		return;
	svs.changelevel_issued = true;

	const s = G_STRING( OFS_PARM0 );
	Cbuf_AddText( 'changelevel ' + s + '\n' );

}

/*
=================
SV_MoveToGoal
=================
*/
function SV_MoveToGoal() {

	SV_MoveToGoal_Real();

}

function PF_Fixme() {

	PR_RunError( 'unimplemented builtin' );

}

//============================================================================
// Builtin dispatch table
// This matches the C pr_builtin[] array exactly
//============================================================================

const pr_builtin = [
	PF_Fixme,			// #0
	PF_makevectors,		// void(entity e) makevectors = #1;
	PF_setorigin,		// void(entity e, vector o) setorigin = #2;
	PF_setmodel,		// void(entity e, string m) setmodel = #3;
	PF_setsize,			// void(entity e, vector min, vector max) setsize = #4;
	PF_Fixme,			// void(entity e, vector min, vector max) setabssize = #5;
	PF_break,			// void() break = #6;
	PF_random,			// float() random = #7;
	PF_sound,			// void(entity e, float chan, string samp) sound = #8;
	PF_normalize,		// vector(vector v) normalize = #9;
	PF_error,			// void(string e) error = #10;
	PF_objerror,		// void(string e) objerror = #11;
	PF_vlen,			// float(vector v) vlen = #12;
	PF_vectoyaw,		// float(vector v) vectoyaw = #13;
	PF_Spawn,			// entity() spawn = #14;
	PF_Remove,			// void(entity e) remove = #15;
	PF_traceline,		// float(vector v1, vector v2, float tryents) traceline = #16;
	PF_checkclient,		// entity() clientlist = #17;
	PF_Find,			// entity(entity start, .string fld, string match) find = #18;
	PF_precache_sound,	// void(string s) precache_sound = #19;
	PF_precache_model,	// void(string s) precache_model = #20;
	PF_stuffcmd,		// void(entity client, string s) stuffcmd = #21;
	PF_findradius,		// entity(vector org, float rad) findradius = #22;
	PF_bprint,			// void(string s) bprint = #23;
	PF_sprint,			// void(entity client, string s) sprint = #24;
	PF_dprint,			// void(string s) dprint = #25;
	PF_ftos,			// void(string s) ftos = #26;
	PF_vtos,			// void(string s) vtos = #27;
	PF_coredump,		// #28
	PF_traceon,			// #29
	PF_traceoff,		// #30
	PF_eprint,			// void(entity e) debug print an entire entity = #31
	PF_walkmove,		// float(float yaw, float dist) walkmove = #32
	PF_Fixme,			// #33
	PF_droptofloor,		// #34
	PF_lightstyle,		// #35
	PF_rint,			// #36
	PF_floor,			// #37
	PF_ceil,			// #38
	PF_Fixme,			// #39
	PF_checkbottom,		// #40
	PF_pointcontents,	// #41
	PF_Fixme,			// #42
	PF_fabs,			// #43
	PF_aim,				// #44
	PF_cvar,			// #45
	PF_localcmd,		// #46
	PF_nextent,			// #47
	PF_particle,		// #48
	PF_changeyaw,		// #49
	PF_Fixme,			// #50
	PF_vectoangles,		// #51

	PF_WriteByte,		// #52
	PF_WriteChar,		// #53
	PF_WriteShort,		// #54
	PF_WriteLong,		// #55
	PF_WriteCoord,		// #56
	PF_WriteAngle,		// #57
	PF_WriteString,		// #58
	PF_WriteEntity,		// #59

	PF_Fixme,			// #60 (Quake2: sin)
	PF_Fixme,			// #61 (Quake2: cos)
	PF_Fixme,			// #62 (Quake2: sqrt)
	PF_Fixme,			// #63 (Quake2: changepitch)
	PF_Fixme,			// #64 (Quake2: TraceToss)
	PF_Fixme,			// #65 (Quake2: etos)
	PF_Fixme,			// #66 (Quake2: WaterMove)

	SV_MoveToGoal,		// #67
	PF_precache_file,	// #68
	PF_makestatic,		// #69

	PF_changelevel,		// #70
	PF_Fixme,			// #71

	PF_cvar_set,		// #72
	PF_centerprint,		// #73

	PF_ambientsound,	// #74

	PF_precache_model,	// #75 precache_model2
	PF_precache_sound,	// #76 precache_sound2 is different only for qcc
	PF_precache_file,	// #77

	PF_setspawnparms,	// #78
];

/*
===============
PR_InitBuiltins

Registers the builtin function table. Called during PR_Init.
===============
*/
export function PR_InitBuiltins() {

	PR_SetBuiltins( pr_builtin, pr_builtin.length );

	// Wire up sv_move.js callbacks
	SV_Move_SetCallbacks( {
		PF_changeyaw: PF_changeyaw,
		G_FLOAT: G_FLOAT,
		G_FLOAT_SET: G_FLOAT_SET,
	} );

}
