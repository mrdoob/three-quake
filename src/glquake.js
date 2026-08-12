// Ported from: WinQuake/glquake.h -- GL definitions and state variables

import * as THREE from 'three';

/*
===============================================================================

GL DEFINITIONS AND STATE

===============================================================================
*/

export const ALIAS_BASE_SIZE_RATIO = ( 1.0 / 11.0 );
export const MAX_LBM_HEIGHT = 480;

export const TILE_SIZE = 128;

export const SKYSHIFT = 7;
export const SKYSIZE = ( 1 << SKYSHIFT );
export const SKYMASK = ( SKYSIZE - 1 );

export const BACKFACE_EPSILON = 0.01;

// Multitexture
export const TEXTURE0_SGIS = 0x835E;
export const TEXTURE1_SGIS = 0x835F;

//
// VERTEXSIZE for glpoly_t verts: x y z s t (lightmap s) (lightmap t)
//
export const VERTEXSIZE = 7;

export const MAXLIGHTMAPS = 4;

/*
===============================================================================

TEXTURE MANAGEMENT

===============================================================================
*/

export const MAX_GLTEXTURES = 1024;

export class gltexture_t {

	constructor() {

		this.identifier = '';
		this.texnum = 0;
		this.width = 0;
		this.height = 0;
		this.mipmap = false;
		// Three.js texture reference
		this.texture = null;

	}

}

export let texture_extension_number = 1;
export let texture_mode = 0; // GL_LINEAR_MIPMAP_NEAREST equivalent

export let gldepthmin = 0;
export let gldepthmax = 0;

export let currenttexture = - 1;
export let cnttextures = [ - 1, - 1 ];
export let particletexture = 0;
export let playertextures = 0;

export let gltextures = [];
export let numgltextures = 0;

export function setTextureExtensionNumber( n ) {

	texture_extension_number = n;

}

export function getTextureExtensionNumber() {

	return texture_extension_number ++;

}

/*
===============================================================================

POLYGON STRUCTURE

===============================================================================
*/

export class glpoly_t {

	constructor() {

		this.next = null;
		this.chain = null;
		this.numverts = 0;
		this.flags = 0;
		this.verts = []; // array of arrays, each [x,y,z,s,t,ls,lt]

	}

}

/*
===============================================================================

GL VERTEX TYPE

===============================================================================
*/

export class glvert_t {

	constructor() {

		this.x = 0;
		this.y = 0;
		this.z = 0;
		this.s = 0;
		this.t = 0;
		this.r = 0;
		this.g = 0;
		this.b = 0;

	}

}

export let glv = new glvert_t();

export let glx = 0;
export let gly = 0;
export let glwidth = 640;
export let glheight = 480;

/*
===============================================================================

PARTICLE TYPE

===============================================================================
*/

export const pt_static = 0;
export const pt_grav = 1;
export const pt_slowgrav = 2;
export const pt_fire = 3;
export const pt_explode = 4;
export const pt_explode2 = 5;
export const pt_blob = 6;
export const pt_blob2 = 7;

export class particle_t {

	constructor() {

		// driver-usable fields
		this.org = new Float32Array( 3 );
		this.color = 0;
		// drivers never touch the following fields
		this.next = null;
		this.vel = new Float32Array( 3 );
		this.ramp = 0;
		this.die = 0;
		this.type = pt_static;

	}

}

/*
===============================================================================

RENDER STATE VARIABLES

===============================================================================
*/

export let r_worldentity = null; // entity_t
export let r_cache_thrash = false;
export let modelorg = new Float32Array( 3 );
export let r_entorigin = new Float32Array( 3 );
export let currententity = null;
export let r_visframecount = 0;
export let r_framecount = 0;
export function set_r_framecount( value ) { r_framecount = value; }
export function inc_r_framecount() { return ++ r_framecount; }
export let frustum = []; // mplane_t[4]
export let c_brush_polys = 0;
export let c_alias_polys = 0;

// view origin
export let vup = new Float32Array( 3 );
export let vpn = new Float32Array( 3 );
export let vright = new Float32Array( 3 );
export let r_origin = new Float32Array( 3 );

// screen size info
export let r_refdef = null; // refdef_t
export let r_viewleaf = null;
export let r_oldviewleaf = null;
export let r_notexture_mip = null;
export let d_lightstylevalue = new Int32Array( 256 );

export let envmap = false;

export let skytexturenum = - 1;
export let mirrortexturenum = - 1;
export let mirror = false;
export let mirror_plane = null;

export let r_world_matrix = new Float32Array( 16 );

// GL format constants (mapped to WebGL equivalents conceptually)
export let gl_lightmap_format = 4; // GL_RGBA
export let gl_solid_format = 3; // GL_RGB
export let gl_alpha_format = 4; // GL_RGBA

export let gl_mtexable = false;

/*
===============================================================================

CVARS (placeholder objects matching cvar_t structure)

===============================================================================
*/

export const r_norefresh = { name: 'r_norefresh', string: '0', value: 0 };
export const r_drawentities = { name: 'r_drawentities', string: '1', value: 1 };
export const r_drawworld = { name: 'r_drawworld', string: '1', value: 1 };
export const r_drawviewmodel = { name: 'r_drawviewmodel', string: '1', value: 1 };
export const r_speeds = { name: 'r_speeds', string: '0', value: 0 };
export const r_waterwarp = { name: 'r_waterwarp', string: '1', value: 1 };
export const r_fullbright = { name: 'r_fullbright', string: '0', value: 0 };
export const r_lightmap = { name: 'r_lightmap', string: '0', value: 0 };
export const r_shadows = { name: 'r_shadows', string: '0', value: 0 };
export const r_mirroralpha = { name: 'r_mirroralpha', string: '1', value: 1 };
export const r_wateralpha = { name: 'r_wateralpha', string: '1', value: 1 };
export const r_dynamic = { name: 'r_dynamic', string: '1', value: 1 };
export const r_novis = { name: 'r_novis', string: '0', value: 0 };

export const gl_clear = { name: 'gl_clear', string: '0', value: 0 };
export const gl_cull = { name: 'gl_cull', string: '1', value: 1 };
export const gl_texsort = { name: 'gl_texsort', string: '1', value: 1 };
export const gl_smoothmodels = { name: 'gl_smoothmodels', string: '1', value: 1 };
export const gl_affinemodels = { name: 'gl_affinemodels', string: '0', value: 0 };
export const gl_polyblend = { name: 'gl_polyblend', string: '1', value: 1 };
export const gl_keeptjunctions = { name: 'gl_keeptjunctions', string: '0', value: 0 };
export const gl_reporttjunctions = { name: 'gl_reporttjunctions', string: '0', value: 0 };
export const gl_flashblend = { name: 'gl_flashblend', string: '1', value: 1 };
export const gl_nocolors = { name: 'gl_nocolors', string: '0', value: 0 };
export const gl_doubleeyes = { name: 'gl_doubleeyes', string: '1', value: 1 };
export const gl_max_size = { name: 'gl_max_size', string: '1024', value: 1024 };
export const gl_playermip = { name: 'gl_playermip', string: '0', value: 0 };
export const gl_subdivide_size = { name: 'gl_subdivide_size', string: '128', value: 128 };
// Texture filtering: 0 = nearest (pixelated), 1 = linear (smooth)
export const gl_texturemode = { name: 'gl_texturemode', string: '0', value: 0, archive: true };

// Track all game textures for filter updates
export const _allGameTextures = [];

export function GL_RegisterTexture( texture ) {

	if ( texture != null && _allGameTextures.includes( texture ) === false ) {

		_allGameTextures.push( texture );

	}

}

export function GL_UnregisterTexture( texture ) {

	if ( texture == null ) return;
	const index = _allGameTextures.indexOf( texture );
	if ( index !== - 1 ) _allGameTextures.splice( index, 1 );

}

export function GL_UpdateTextureFiltering() {

	const filter = gl_texturemode.value ? THREE.LinearFilter : THREE.NearestFilter;
	const mipFilter = gl_texturemode.value ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter;

	for ( const texture of _allGameTextures ) {

		if ( texture ) {

			texture.magFilter = filter;
			texture.minFilter = texture.generateMipmaps ? mipFilter : filter;
			texture.needsUpdate = true;

		}

	}

}

/*
===============================================================================

THREE.JS HELPER FUNCTIONS
(Replacing raw GL_Bind / GL_BeginRendering / etc.)

===============================================================================
*/

export function GL_Bind( texnum ) {

	currenttexture = texnum;

}

export function GL_DisableMultitexture() {

	// no-op in Three.js

}

export function GL_EnableMultitexture() {

	// no-op in Three.js

}

export function GL_BeginRendering( x, y, width, height ) {

	// In Three.js, rendering is handled by the renderer
	// These values are set by the video initialization

}

export function GL_EndRendering() {

	// no-op in Three.js

}

// v_blend for dynamic light blend effects
export let v_blend = new Float32Array( 4 );
