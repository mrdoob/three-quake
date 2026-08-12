// Ported from: WinQuake/render.h -- public interface to refresh functions

import { entity_state_t } from './quakedef.js';
import { vrect_t } from './vid.js';
import { MSG_ReadCoord, MSG_ReadChar, MSG_ReadByte } from './common.js';
import {
	R_RunParticleEffect as _R_RunParticleEffect,
	R_RocketTrail as _R_RocketTrail,
	R_EntityParticles as _R_EntityParticles,
	R_BlobExplosion as _R_BlobExplosion,
	R_ParticleExplosion as _R_ParticleExplosion,
	R_ParticleExplosion2 as _R_ParticleExplosion2,
	R_LavaSplash as _R_LavaSplash,
	R_TeleportSplash as _R_TeleportSplash
} from './r_part.js';

//============================================================================
// Constants
//============================================================================

export const MAXCLIPPLANES = 11;

export const TOP_RANGE = 16; // soldier uniform colors
export const BOTTOM_RANGE = 96;

//============================================================================
// efrag_t -- entity fragment for BSP leaf association
//============================================================================

export class efrag_t {

	constructor() {

		this.leaf = null; // mleaf_t
		this.leafnext = null; // efrag_t -- next efrag in same leaf
		this.entity = null; // entity_t -- owning entity
		this.entnext = null; // efrag_t -- next efrag for same entity

	}

}

//============================================================================
// entity_t -- client-side entity state
//============================================================================

export class entity_t {

	constructor() {

		this.forcelink = false; // model changed

		this.update_type = 0;

		this.baseline = new entity_state_t(); // to fill in defaults in updates

		this.msgtime = 0; // time of last update
		this.msg_origins = [
			new Float32Array( 3 ), // last two updates (0 is newest)
			new Float32Array( 3 )
		];
		this.origin = new Float32Array( 3 );
		this.msg_angles = [
			new Float32Array( 3 ), // last two updates (0 is newest)
			new Float32Array( 3 )
		];
		this.angles = new Float32Array( 3 );
		this.model = null; // model_t -- NULL = no model
		this.efrag = null; // efrag_t -- linked list of efrags
		this.frame = 0;
		this.syncbase = 0; // for client-side animations
		this.colormap = null; // byte pointer
		this.effects = 0; // light, particles, etc
		this.skinnum = 0; // for Alias models
		this.visframe = 0; // last frame this entity was found in an active leaf

		this.dlightframe = 0; // dynamic lighting
		this.dlightbits = 0;

		// FIXME: could turn these into a union
		this.trivial_accept = 0;
		this.topnode = null; // mnode_t -- for bmodels, first world node
		                     // that splits bmodel, or NULL if not split

	}

}

//============================================================================
// refdef_t -- refresh definition
//
// !!! if this is changed, it must be changed in asm_draw.h too !!!
//============================================================================

export class refdef_t {

	constructor() {

		this.vrect = new vrect_t(); // subwindow in video for refresh
		this.vrectScale = 1; // backing pixels per virtual 2D coordinate
		this.aliasvrect = new vrect_t(); // scaled Alias version
		this.vrectright = 0;
		this.vrectbottom = 0; // right & bottom screen coords
		this.aliasvrectright = 0;
		this.aliasvrectbottom = 0; // scaled Alias versions
		this.vrectrightedge = 0; // rightmost right edge we care about
		this.fvrectx = 0;
		this.fvrecty = 0; // for floating-point compares
		this.fvrectx_adj = 0;
		this.fvrecty_adj = 0; // left and top edges, for clamping
		this.vrect_x_adj_shift20 = 0; // (vrect.x + 0.5 - epsilon) << 20
		this.vrectright_adj_shift20 = 0; // (vrectright + 0.5 - epsilon) << 20
		this.fvrectright_adj = 0;
		this.fvrectbottom_adj = 0; // right and bottom edges, for clamping
		this.fvrectright = 0; // rightmost edge, for Alias clamping
		this.fvrectbottom = 0; // bottommost edge, for Alias clamping
		this.horizontalFieldOfView = 0; // at Z = 1.0, this many X is visible
		                                // 2.0 = 90 degrees
		this.xOrigin = 0; // should probably always be 0.5
		this.yOrigin = 0; // between be around 0.3 to 0.5

		this.vieworg = new Float32Array( 3 );
		this.viewangles = new Float32Array( 3 );

		this.fov_x = 0;
		this.fov_y = 0;

		this.ambientlight = 0;

	}

}

//============================================================================
// Globals
//============================================================================

export const r_refdef = new refdef_t();

// view origin
export const r_origin = new Float32Array( 3 );
export const vpn = new Float32Array( 3 ); // view plane normal (forward)
export const vright = new Float32Array( 3 ); // view right vector
export const vup = new Float32Array( 3 ); // view up vector

export let r_notexture_mip = null; // texture_t -- fallback texture

export let reinit_surfcache = 0; // if 1, surface cache is currently empty
export let r_cache_thrash = false; // set if thrashing the surface cache

//============================================================================
// Refresh function declarations (stubs -- implemented in gl_rmain.js)
//============================================================================

export function R_Init() {

	// Implemented in gl_rmain.js

}

export function R_InitTextures() {

	// Implemented in gl_rmisc.js

}

export function R_InitEfrags() {

	// Stub

}

export function R_RenderView() {

	// Implemented in gl_rmain.js -- must set r_refdef first

}

export function R_ViewChanged( pvrect, lineadj, aspect ) {

	// Called whenever r_refdef or vid change

}

export function R_InitSky( mt ) {

	// Called at level load

}

// R_AddEfrags and R_RemoveEfrags implemented in gl_refrag.js
export { R_AddEfrags, R_RemoveEfrags, R_StoreEfrags } from './gl_refrag.js';

export function R_NewMap() {

	// Implemented in gl_rmain.js

}

//============================================================================
// Particle effect stubs
//============================================================================

export function R_ParseParticleEffect() {

	const org = new Float32Array( 3 );
	const dir = new Float32Array( 3 );

	for ( let i = 0; i < 3; i ++ )
		org[ i ] = MSG_ReadCoord();
	for ( let i = 0; i < 3; i ++ )
		dir[ i ] = MSG_ReadChar() * ( 1.0 / 16 );

	const msgcount = MSG_ReadByte();
	const color = MSG_ReadByte();

	let count;
	if ( msgcount === 255 )
		count = 1024;
	else
		count = msgcount;

	_R_RunParticleEffect( org, dir, color, count );

}

export function R_RunParticleEffect( org, dir, color, count ) {

	_R_RunParticleEffect( org, dir, color, count );

}

export function R_RocketTrail( start, end, type ) {

	_R_RocketTrail( start, end, type );

}

export function R_EntityParticles( ent ) {

	_R_EntityParticles( ent );

}

export function R_BlobExplosion( org ) {

	_R_BlobExplosion( org );

}

export function R_ParticleExplosion( org ) {

	_R_ParticleExplosion( org );

}

export function R_ParticleExplosion2( org, colorStart, colorLength ) {

	_R_ParticleExplosion2( org, colorStart, colorLength );

}

export function R_LavaSplash( org ) {

	_R_LavaSplash( org );

}

export function R_TeleportSplash( org ) {

	_R_TeleportSplash( org );

}

export function R_PushDlights() {

	// Stub

}

//============================================================================
// Surface cache related
//============================================================================

export function D_SurfaceCacheForRes( width, height ) {

	return 0;

}

export function D_FlushCaches() {

	// Stub

}

export function D_DeleteSurfaceCache() {

	// Stub

}

export function D_InitCaches( buffer, size ) {

	// Stub

}

export function R_SetVrect( pvrect, pvrectin, lineadj ) {

	// Stub

}
