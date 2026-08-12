// Ported from: WinQuake/gl_model.c + gl_model.h + modelgen.h + spritegn.h
// models.c -- model loading and caching
//
// models are the only shared resource between a client and server running
// on the same machine.

import * as THREE from 'three';
import { Sys_Error } from './sys.js';
import { Con_Printf, COM_FileBase } from './common.js';
import { d_8to24table, vid } from './vid.js';
import { COM_LoadFile } from './pak.js';
import { DotProduct, VectorCopy, Length } from './mathlib.js';
import { R_InitSky as R_InitSky_warp, GL_SubdivideSurface as GL_SubdivideSurface_warp, GL_Warp_SetLoadmodel } from './gl_warp.js';
import { GL_MakeAliasModelDisplayLists as GL_MakeAliasModelDisplayLists_mesh } from './gl_mesh.js';

// Sky textures (set by R_InitSky during level load)
export let solidskytexture = null;
export let alphaskytexture = null;
import {
	BSPVERSION,
	LUMP_ENTITIES, LUMP_PLANES, LUMP_TEXTURES, LUMP_VERTEXES,
	LUMP_VISIBILITY, LUMP_NODES, LUMP_TEXINFO, LUMP_FACES,
	LUMP_LIGHTING, LUMP_CLIPNODES, LUMP_LEAFS, LUMP_MARKSURFACES,
	LUMP_EDGES, LUMP_SURFEDGES, LUMP_MODELS, HEADER_LUMPS,
	MAX_MAP_HULLS, MAX_MAP_LEAFS,
	CONTENTS_EMPTY,
	MIPLEVELS, MAXLIGHTMAPS, NUM_AMBIENTS,
	TEX_SPECIAL
} from './bspfile.js';
import { gl_texturemode, GL_RegisterTexture, GL_UnregisterTexture } from './glquake.js';

// ============================================================================
// modelgen.h constants
// ============================================================================

export const ALIAS_VERSION = 6;
export const ALIAS_ONSEAM = 0x0020;

// synctype_t
export const ST_SYNC = 0;
export const ST_RAND = 1;

// aliasframetype_t
export const ALIAS_SINGLE = 0;
export const ALIAS_GROUP = 1;

// aliasskintype_t
export const ALIAS_SKIN_SINGLE = 0;
export const ALIAS_SKIN_GROUP = 1;

export const DT_FACES_FRONT = 0x0010;

// little-endian "IDPO"
export const IDPOLYHEADER = ( 'O'.charCodeAt( 0 ) << 24 ) + ( 'P'.charCodeAt( 0 ) << 16 ) + ( 'D'.charCodeAt( 0 ) << 8 ) + 'I'.charCodeAt( 0 );

export const ALIAS_BASE_SIZE_RATIO = ( 1.0 / 11.0 );
export const MAX_LBM_HEIGHT = 480;

// ============================================================================
// spritegn.h constants
// ============================================================================

export const SPRITE_VERSION = 1;

export const SPR_VP_PARALLEL_UPRIGHT = 0;
export const SPR_FACING_UPRIGHT = 1;
export const SPR_VP_PARALLEL = 2;
export const SPR_ORIENTED = 3;
export const SPR_VP_PARALLEL_ORIENTED = 4;

// spriteframetype_t
export const SPR_SINGLE = 0;
export const SPR_GROUP = 1;

// little-endian "IDSP"
export const IDSPRITEHEADER = ( 'P'.charCodeAt( 0 ) << 24 ) + ( 'S'.charCodeAt( 0 ) << 16 ) + ( 'D'.charCodeAt( 0 ) << 8 ) + 'I'.charCodeAt( 0 );

// ============================================================================
// gl_model.h -- entity effects
// ============================================================================

export const EF_BRIGHTFIELD = 1;
export const EF_MUZZLEFLASH = 2;
export const EF_BRIGHTLIGHT = 4;
export const EF_DIMLIGHT = 8;

// ============================================================================
// Surface flags
// ============================================================================

export const SURF_PLANEBACK = 2;
export const SURF_DRAWSKY = 4;
export const SURF_DRAWSPRITE = 8;
export const SURF_DRAWTURB = 0x10;
export const SURF_DRAWTILED = 0x20;
export const SURF_DRAWBACKGROUND = 0x40;
export const SURF_UNDERWATER = 0x80;

// ============================================================================
// Plane sides
// ============================================================================

export const SIDE_FRONT = 0;
export const SIDE_BACK = 1;
export const SIDE_ON = 2;

// ============================================================================
// GL poly vertex size
// ============================================================================

export const VERTEXSIZE = 7;

// ============================================================================
// Model types
// ============================================================================

export const mod_brush = 0;
export const mod_sprite = 1;
export const mod_alias = 2;

// ============================================================================
// Entity effect flags (model flags from MDL header)
// ============================================================================

export const EF_ROCKET = 1;		// leave a trail
export const EF_GRENADE = 2;		// leave a trail
export const EF_GIB = 4;			// leave a trail
export const EF_ROTATE = 8;		// rotate (bonus items)
export const EF_TRACER = 16;		// green split trail
export const EF_ZOMGIB = 32;		// small blood trail
export const EF_TRACER2 = 64;		// orange split trail + rotate
export const EF_TRACER3 = 128;		// purple trail

// ============================================================================
// Alias model limits
// ============================================================================

export const MAX_SKINS = 32;
export const MAXALIASVERTS = 1024;
export const MAXALIASFRAMES = 256;
export const MAXALIASTRIS = 2048;

// ============================================================================
// In-memory model structures (m*_t)
// ============================================================================

export class mvertex_t {

	constructor() {

		this.position = new Float32Array( 3 );

	}

}

export class mplane_t {

	constructor() {

		this.normal = new Float32Array( 3 );
		this.dist = 0;
		this.type = 0;		// for texture axis selection and fast side tests
		this.signbits = 0;	// signx + signy<<1 + signz<<2

	}

}

export class texture_t {

	constructor() {

		this.name = '';
		this.width = 0;
		this.height = 0;
		this.gl_texturenum = 0;
		this.texturechain = null;	// for gl_texsort drawing
		this.anim_total = 0;		// total tenths in sequence ( 0 = no)
		this.anim_min = 0;
		this.anim_max = 0;
		this.anim_next = null;		// in the animation sequence
		this.alternate_anims = null;	// bmodels in frame 1 use these
		this.offsets = new Uint32Array( MIPLEVELS );	// four mip maps stored
		this.pixels = null;			// Uint8Array of raw pixel data

	}

}

export class medge_t {

	constructor() {

		this.v = new Uint16Array( 2 );
		this.cachededgeoffset = 0;

	}

}

export class mtexinfo_t {

	constructor() {

		this.vecs = [
			new Float32Array( 4 ),
			new Float32Array( 4 )
		];
		this.mipadjust = 0;
		this.texture = null;
		this.flags = 0;

	}

}

export class glpoly_t {

	constructor() {

		this.next = null;
		this.chain = null;
		this.numverts = 0;
		this.flags = 0;			// for SURF_UNDERWATER
		this.verts = [];		// array of Float32Array(VERTEXSIZE) -- variable sized (xyz s1t1 s2t2)

	}

}

export class msurface_t {

	constructor() {

		this.visframe = 0;		// should be drawn when node is crossed

		this.plane = null;
		this.flags = 0;

		this.firstedge = 0;		// look up in model->surfedges[], negative numbers
		this.numedges = 0;		// are backwards edges

		this.texturemins = new Int16Array( 2 );
		this.extents = new Int16Array( 2 );

		this.light_s = 0;
		this.light_t = 0;		// gl lightmap coordinates

		this.polys = null;				// multiple if warped
		this.texturechain = null;

		this.texinfo = null;

		// lighting info
		this.dlightframe = 0;
		this.dlightbits = 0;

		this.lightmaptexturenum = 0;
		this.styles = new Uint8Array( MAXLIGHTMAPS );
		this.cached_light = new Int32Array( MAXLIGHTMAPS );	// values currently used in lightmap
		this.cached_dlight = false;							// true if dynamic light in cache
		this.samples = null;		// Uint8Array -- [numstyles*surfsize]
		this.sampleOffset = 0;		// offset into lightdata

	}

}

export class mnode_t {

	constructor() {

		// common with leaf
		this.contents = 0;		// 0, to differentiate from leafs
		this.visframe = 0;		// node needs to be traversed if current

		this.minmaxs = new Float32Array( 6 );	// for bounding box culling

		this.parent = null;

		// node specific
		this.plane = null;
		this.children = [ null, null ];

		this.firstsurface = 0;
		this.numsurfaces = 0;

	}

}

export class mleaf_t {

	constructor() {

		// common with node
		this.contents = 0;		// will be a negative contents number
		this.visframe = 0;		// node needs to be traversed if current

		this.minmaxs = new Float32Array( 6 );	// for bounding box culling

		this.parent = null;

		// leaf specific
		this.compressed_vis = null;		// Uint8Array slice
		this.compressed_vis_offset = 0;
		this.efrags = null;

		this.firstmarksurface = 0;		// index into marksurfaces array
		this.nummarksurfaces = 0;
		this.key = 0;					// BSP sequence number for leaf's contents
		this.ambient_sound_level = new Uint8Array( NUM_AMBIENTS );

	}

}

export class dclipnode_t {

	constructor() {

		this.planenum = 0;
		this.children = new Int16Array( 2 );

	}

}

export class hull_t {

	constructor() {

		this.clipnodes = null;	// array of dclipnode_t
		this.planes = null;		// array of mplane_t
		this.firstclipnode = 0;
		this.lastclipnode = 0;
		this.clip_mins = new Float32Array( 3 );
		this.clip_maxs = new Float32Array( 3 );

	}

}

// ============================================================================
// Sprite model structures
// ============================================================================

export class mspriteframe_t {

	constructor() {

		this.width = 0;
		this.height = 0;
		this.up = 0;
		this.down = 0;
		this.left = 0;
		this.right = 0;
		this.gl_texturenum = 0;

	}

}

export class mspritegroup_t {

	constructor() {

		this.numframes = 0;
		this.intervals = null;	// Float32Array
		this.frames = [];		// array of mspriteframe_t

	}

}

export class mspriteframedesc_t {

	constructor() {

		this.type = 0;			// spriteframetype_t
		this.frameptr = null;	// mspriteframe_t or mspritegroup_t

	}

}

export class msprite_t {

	constructor() {

		this.type = 0;
		this.maxwidth = 0;
		this.maxheight = 0;
		this.numframes = 0;
		this.beamlength = 0;
		this.cachespot = null;
		this.frames = [];		// array of mspriteframedesc_t

	}

}

// ============================================================================
// Alias model structures
// ============================================================================

export class trivertx_t {

	constructor() {

		this.v = new Uint8Array( 3 );
		this.lightnormalindex = 0;

	}

}

export class stvert_t {

	constructor() {

		this.onseam = 0;
		this.s = 0;
		this.t = 0;

	}

}

export class dtriangle_t {

	constructor() {

		this.facesfront = 0;
		this.vertindex = new Int32Array( 3 );

	}

}

export class mtriangle_t {

	constructor() {

		this.facesfront = 0;
		this.vertindex = new Int32Array( 3 );

	}

}

export class maliasframedesc_t {

	constructor() {

		this.firstpose = 0;
		this.numposes = 0;
		this.interval = 0;
		this.bboxmin = new trivertx_t();
		this.bboxmax = new trivertx_t();
		this.frame = 0;
		this.name = '';

	}

}

export class aliashdr_t {

	constructor() {

		this.ident = 0;
		this.version = 0;
		this.scale = new Float32Array( 3 );
		this.scale_origin = new Float32Array( 3 );
		this.boundingradius = 0;
		this.eyeposition = new Float32Array( 3 );
		this.numskins = 0;
		this.skinwidth = 0;
		this.skinheight = 0;
		this.numverts = 0;
		this.numtris = 0;
		this.numframes = 0;
		this.synctype = 0;
		this.flags = 0;
		this.size = 0;

		this.numposes = 0;
		this.poseverts = 0;
		this.posedata = null;		// array of trivertx_t arrays
		this.commands = null;		// gl command list with embedded s/t
		this.gl_texturenum = [];	// [MAX_SKINS][4]
		this.texels = [];			// [MAX_SKINS] - only for player skins
		this.frames = [];			// array of maliasframedesc_t

		// Initialize gl_texturenum as 2D array
		for ( let i = 0; i < MAX_SKINS; i ++ ) {

			this.gl_texturenum[ i ] = [ 0, 0, 0, 0 ];
			this.texels[ i ] = 0;

		}

	}

}

// ============================================================================
// dmodel_t -- on-disk submodel structure
// ============================================================================

export class dmodel_t {

	constructor() {

		this.mins = new Float32Array( 3 );
		this.maxs = new Float32Array( 3 );
		this.origin = new Float32Array( 3 );
		this.headnode = new Int32Array( MAX_MAP_HULLS );
		this.visleafs = 0;
		this.firstface = 0;
		this.numfaces = 0;

	}

}

// ============================================================================
// Whole model
// ============================================================================

export class model_t {

	constructor() {

		this.name = '';
		this.needload = false;		// bmodels and sprites don't cache normally

		this.type = 0;				// modtype_t
		this.numframes = 0;
		this.synctype = 0;

		this.flags = 0;

		// volume occupied by the model graphics
		this.mins = new Float32Array( 3 );
		this.maxs = new Float32Array( 3 );
		this.radius = 0;

		// solid volume for clipping
		this.clipbox = false;
		this.clipmins = new Float32Array( 3 );
		this.clipmaxs = new Float32Array( 3 );

		// brush model
		this.firstmodelsurface = 0;
		this.nummodelsurfaces = 0;

		this.numsubmodels = 0;
		this.submodels = null;		// array of dmodel_t

		this.numplanes = 0;
		this.planes = null;			// array of mplane_t

		this.numleafs = 0;			// number of visible leafs, not counting 0
		this.leafs = null;			// array of mleaf_t

		this.numvertexes = 0;
		this.vertexes = null;		// array of mvertex_t

		this.numedges = 0;
		this.edges = null;			// array of medge_t

		this.numnodes = 0;
		this.nodes = null;			// array of mnode_t

		this.numtexinfo = 0;
		this.texinfo = null;		// array of mtexinfo_t

		this.numsurfaces = 0;
		this.surfaces = null;		// array of msurface_t

		this.numsurfedges = 0;
		this.surfedges = null;		// Int32Array

		this.numclipnodes = 0;
		this.clipnodes = null;		// array of dclipnode_t

		this.nummarksurfaces = 0;
		this.marksurfaces = null;	// array of indices into surfaces

		this.hulls = [];
		for ( let i = 0; i < MAX_MAP_HULLS; i ++ )
			this.hulls[ i ] = new hull_t();

		this.numtextures = 0;
		this.textures = null;		// array of texture_t

		this.visdata = null;		// Uint8Array
		this.lightdata = null;		// Uint8Array
		this.entities = null;		// string

		// additional model data
		this.cache = { data: null };	// cache_user_t equivalent
		this._threeTextures = new Set();

	}

}

// ============================================================================
// Module-level state (mirrors C globals)
// ============================================================================

let loadmodel = null;
let loadname = '';

const mod_novis = new Uint8Array( MAX_MAP_LEAFS / 8 );

const MAX_MOD_KNOWN = 512;
const mod_known = [];
let mod_numknown = 0;

// Initialize mod_known array
for ( let i = 0; i < MAX_MOD_KNOWN; i ++ )
	mod_known[ i ] = new model_t();

// Alias model globals
export let pheader = null;
export const stverts = [];
export const triangles = [];
export const poseverts = [];
let posenum = 0;

// Initialize alias arrays
for ( let i = 0; i < MAXALIASVERTS; i ++ )
	stverts[ i ] = new stvert_t();
for ( let i = 0; i < MAXALIASTRIS; i ++ )
	triangles[ i ] = new mtriangle_t();

// GL texture placeholder
let r_notexture_mip = null;

// mod_base: Uint8Array - the raw file bytes of the BSP currently being loaded
let mod_base = null;

// Decompressed visibility buffer (reused)
const decompressed = new Uint8Array( MAX_MAP_LEAFS / 8 );

// ============================================================================
// Stub functions for GL operations not yet ported
// ============================================================================

function GL_LoadTexture( name, width, height, data, mipmap, alpha, splitFullbright ) {

	// Convert 8-bit palette-indexed pixels to RGBA and create a THREE.DataTexture
	const rgba = new Uint8Array( width * height * 4 );
	const fullbrightStart = vid.fullbright; // palette index 224+
	let hasFullbright = false;
	let fullbrightTexture = null;

	for ( let i = 0; i < width * height; i ++ ) {

		const palIdx = data[ i ];

		if ( alpha && palIdx === 255 ) {

			// Transparent pixel (used for '{' textures)
			rgba[ i * 4 ] = 0;
			rgba[ i * 4 + 1 ] = 0;
			rgba[ i * 4 + 2 ] = 0;
			rgba[ i * 4 + 3 ] = 0;

		} else {

			const color = d_8to24table[ palIdx ];
			rgba[ i * 4 ] = color & 0xff;
			rgba[ i * 4 + 1 ] = ( color >> 8 ) & 0xff;
			rgba[ i * 4 + 2 ] = ( color >> 16 ) & 0xff;
			rgba[ i * 4 + 3 ] = 255;

			if ( palIdx >= fullbrightStart ) hasFullbright = true;

		}

	}

	// If texture has fullbright pixels (palette 224-255), create a separate
	// fullbright texture for use as emissiveMap. Fullbright pixels should render
	// at full intensity regardless of lighting (e.g. glowing buttons, lava).
	// Set fullbright pixels to BLACK in the base texture so they don't get
	// darkened by the lightmap, and put them in the fullbright texture instead.
	if ( hasFullbright === true && splitFullbright === true ) {

		const fbRgba = new Uint8Array( width * height * 4 );

		for ( let i = 0; i < width * height; i ++ ) {

			const palIdx = data[ i ];

			if ( palIdx >= fullbrightStart && ! ( alpha && palIdx === 255 ) ) {

				// Copy to fullbright texture
				fbRgba[ i * 4 ] = rgba[ i * 4 ];
				fbRgba[ i * 4 + 1 ] = rgba[ i * 4 + 1 ];
				fbRgba[ i * 4 + 2 ] = rgba[ i * 4 + 2 ];
				fbRgba[ i * 4 + 3 ] = 255;

				// Black out in base texture
				rgba[ i * 4 ] = 0;
				rgba[ i * 4 + 1 ] = 0;
				rgba[ i * 4 + 2 ] = 0;

			}

		}

		fullbrightTexture = new THREE.DataTexture( fbRgba, width, height, THREE.RGBAFormat );
		const fbFilter = gl_texturemode.value ? THREE.LinearFilter : THREE.NearestFilter;
		const fbMipFilter = gl_texturemode.value ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter;
		fullbrightTexture.magFilter = fbFilter;
		fullbrightTexture.minFilter = mipmap ? fbMipFilter : fbFilter;
		fullbrightTexture.wrapS = THREE.RepeatWrapping;
		fullbrightTexture.wrapT = THREE.RepeatWrapping;
		fullbrightTexture.generateMipmaps = mipmap;
		fullbrightTexture.colorSpace = THREE.SRGBColorSpace;
		fullbrightTexture.needsUpdate = true;
		GL_RegisterTexture( fullbrightTexture );
		if ( loadmodel != null ) loadmodel._threeTextures.add( fullbrightTexture );

	}

	const texture = new THREE.DataTexture( rgba, width, height, THREE.RGBAFormat );
	// Use cvar to determine filter mode: 0 = nearest (pixelated), 1 = linear (smooth)
	const filter = gl_texturemode.value ? THREE.LinearFilter : THREE.NearestFilter;
	const mipFilter = gl_texturemode.value ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter;
	texture.magFilter = filter;
	texture.minFilter = mipmap ? mipFilter : filter;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.generateMipmaps = mipmap;
	texture.colorSpace = THREE.SRGBColorSpace;
	// Note: flipY defaults to false for DataTexture, which is correct for Quake
	// Quake's UV T=0 at top + texture row 0 at V=0 means no flip is needed
	texture.needsUpdate = true;

	// Attach fullbright texture if one was created
	if ( fullbrightTexture != null ) {

		texture._fullbright = fullbrightTexture;

	}

	// Register for filter updates when setting changes
	GL_RegisterTexture( texture );
	if ( loadmodel != null ) loadmodel._threeTextures.add( texture );

	return texture;

}

function GL_SubdivideSurface( s ) {

	GL_Warp_SetLoadmodel( loadmodel );
	GL_SubdivideSurface_warp( s );

}

function GL_MakeAliasModelDisplayLists( mod, hdr ) {

	GL_MakeAliasModelDisplayLists_mesh( mod, hdr );

}

function R_InitSky( tx ) {

	// Sky texture is 256*128, split into solid (right half) and alpha (left half)
	// tx.pixels starts at mip level 0 data, tx.offsets[0] is offset from miptex header
	const mt = {
		data: tx.pixels,
		offsets: [ 0 ] // pixels already starts at the texture data
	};
	const result = R_InitSky_warp( mt, d_8to24table );
	if ( loadmodel != null ) {

		loadmodel._threeTextures.add( result.solidTexture );
		loadmodel._threeTextures.add( result.alphaTexture );

	}
	solidskytexture = result.solidTexture;
	alphaskytexture = result.alphaTexture;

}

// ============================================================================
// Mod_Init
// ============================================================================

export function Mod_Init() {

	// Cvar_RegisterVariable( gl_subdivide_size );
	mod_novis.fill( 0xff );

	// Create the notexture mip
	r_notexture_mip = new texture_t();
	r_notexture_mip.name = 'notexture';
	r_notexture_mip.width = 16;
	r_notexture_mip.height = 16;

}

// ============================================================================
// Mod_Extradata
//
// Caches the data if needed
// ============================================================================

export function Mod_Extradata( mod ) {

	const r = mod.cache.data;
	if ( r )
		return r;

	Mod_LoadModel( mod, true );

	if ( ! mod.cache.data )
		Sys_Error( 'Mod_Extradata: caching failed' );
	return mod.cache.data;

}

// ============================================================================
// Mod_PointInLeaf
// ============================================================================

export function Mod_PointInLeaf( p, model ) {

	if ( ! model || ! model.nodes )
		Sys_Error( 'Mod_PointInLeaf: bad model' );

	let node = model.nodes[ 0 ];
	let nodeIndex = 0;

	while ( true ) {

		if ( node.contents < 0 ) {

			// This is actually a leaf
			// In C: return (mleaf_t *)node
			// In JS: nodes and leafs are separate arrays, so leafs
			// are pointed to via children as negative indices
			return node;

		}

		const plane = node.plane;
		const d = DotProduct( p, plane.normal ) - plane.dist;
		if ( d > 0 )
			node = node.children[ 0 ];
		else
			node = node.children[ 1 ];

	}

}

// ============================================================================
// Mod_DecompressVis
// ============================================================================

export function Mod_DecompressVis( _in, inOffset, model ) {

	const row = ( model.numleafs + 7 ) >> 3;
	let outIdx = 0;

	if ( _in === null ) {

		// no vis info, so make all visible
		for ( let i = 0; i < row; i ++ )
			decompressed[ i ] = 0xff;
		return decompressed;

	}

	let pos = inOffset;

	while ( outIdx < row ) {

		if ( _in[ pos ] ) {

			decompressed[ outIdx ] = _in[ pos ];
			outIdx ++;
			pos ++;
			continue;

		}

		const c = _in[ pos + 1 ];
		pos += 2;
		for ( let j = 0; j < c; j ++ ) {

			decompressed[ outIdx ] = 0;
			outIdx ++;

		}

	}

	return decompressed;

}

// ============================================================================
// Mod_LeafPVS
// ============================================================================

export function Mod_LeafPVS( leaf, model ) {

	if ( leaf === model.leafs[ 0 ] )
		return mod_novis;
	return Mod_DecompressVis( leaf.compressed_vis, leaf.compressed_vis_offset, model );

}

// ============================================================================
// Mod_ClearAll
// ============================================================================

export function Mod_ClearAll() {

	const disposedTextures = new Set();
	for ( let i = 0; i < mod_numknown; i ++ ) {

		const mod = mod_known[ i ];
		if ( mod.type === mod_alias ) continue;

		for ( const texture of mod._threeTextures ) {

			GL_UnregisterTexture( texture );
			if ( disposedTextures.has( texture ) === false ) {

				disposedTextures.add( texture );
				texture.dispose();

			}

		}
		mod._threeTextures.clear();

		if ( mod.type === mod_brush && mod.textures != null ) {

			for ( let j = 0; j < mod.textures.length; j ++ ) {

				const modelTexture = mod.textures[ j ];
				if ( modelTexture == null || modelTexture.gl_texture == null ) continue;
				modelTexture.gl_texture._fullbright = null;
				modelTexture.gl_texture = null;

			}

		} else if ( mod.type === mod_sprite ) {

			mod.cache.data = null;

		}

		mod.needload = true;

	}

	solidskytexture = null;
	alphaskytexture = null;

}

// ============================================================================
// Mod_FindName
// ============================================================================

export function Mod_FindName( name ) {

	if ( ! name || name.length === 0 )
		Sys_Error( 'Mod_ForName: NULL name' );

	// search the currently loaded models
	let i;
	for ( i = 0; i < mod_numknown; i ++ ) {

		if ( mod_known[ i ].name === name )
			break;

	}

	if ( i === mod_numknown ) {

		if ( mod_numknown === MAX_MOD_KNOWN )
			Sys_Error( 'mod_numknown == MAX_MOD_KNOWN' );
		mod_known[ i ].name = name;
		mod_known[ i ].needload = true;
		mod_numknown ++;

	}

	return mod_known[ i ];

}

// ============================================================================
// Mod_TouchModel
// ============================================================================

export function Mod_TouchModel( name ) {

	const mod = Mod_FindName( name );

	if ( ! mod.needload ) {

		if ( mod.type === mod_alias ) {

			// Cache_Check equivalent - just check if data exists
			// (JS has GC, so we just check the reference)

		}

	}

}

// ============================================================================
// Mod_LoadModel
//
// Loads a model into the cache
// ============================================================================

export function Mod_LoadModel( mod, crash ) {

	if ( ! mod.needload ) {

		if ( mod.type === mod_alias ) {

			const d = mod.cache.data;
			if ( d )
				return mod;

		} else {

			return mod;		// not cached at all

		}

	}

	// load the file
	const buf = COM_LoadFile( mod.name );
	if ( ! buf ) {

		if ( crash )
			Sys_Error( 'Mod_NumForName: ' + mod.name + ' not found' );
		return null;

	}

	// allocate a new model
	loadname = COM_FileBase( mod.name );

	loadmodel = mod;

	// fill it in

	// call the appropriate loader
	mod.needload = false;

	const view = new DataView( buf );
	const magic = view.getInt32( 0, true );

	if ( magic === IDPOLYHEADER ) {

		Mod_LoadAliasModel( mod, buf );

	} else if ( magic === IDSPRITEHEADER ) {

		Mod_LoadSpriteModel( mod, buf );

	} else {

		Mod_LoadBrushModel( mod, buf );

	}

	return mod;

}

// ============================================================================
// Mod_ForName
//
// Loads in a model for the given name
// ============================================================================

export function Mod_ForName( name, crash ) {

	const mod = Mod_FindName( name );

	return Mod_LoadModel( mod, crash );

}

// ============================================================================
//
//                     BRUSHMODEL LOADING
//
// ============================================================================

// On-disk structure sizes (must match the BSP file layout)
const SIZEOF_DVERTEX = 12;			// 3 floats
const SIZEOF_DEDGE = 4;			// 2 unsigned shorts
const SIZEOF_DFACE = 20;			// short planenum, short side, int firstedge, short numedges, short texinfo, byte styles[4], int lightofs
const SIZEOF_DNODE = 24;			// int planenum, short children[2], short mins[3], short maxs[3], unsigned short firstface, unsigned short numfaces
const SIZEOF_DLEAF = 28;			// int contents, int visofs, short mins[3], short maxs[3], unsigned short firstmarksurface, unsigned short nummarksurfaces, byte ambient_level[4]
const SIZEOF_DCLIPNODE = 8;		// int planenum, short children[2]
const SIZEOF_TEXINFO = 40;			// float vecs[2][4], int miptex, int flags
const SIZEOF_DPLANE = 20;			// float normal[3], float dist, int type
const SIZEOF_DMODEL = 64;			// float mins[3], maxs[3], origin[3], int headnode[4], int visleafs, int firstface, int numfaces

// ============================================================================
// Helper: read a null-terminated string from Uint8Array
// ============================================================================

function readString( bytes, offset, maxLen ) {

	let s = '';
	for ( let i = 0; i < maxLen; i ++ ) {

		const c = bytes[ offset + i ];
		if ( c === 0 ) break;
		s += String.fromCharCode( c );

	}

	return s;

}

// ============================================================================
// Mod_LoadTextures
// ============================================================================

function Mod_LoadTextures( fileofs, filelen ) {

	if ( filelen === 0 ) {

		loadmodel.textures = null;
		return;

	}

	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );

	const nummiptex = view.getInt32( 0, true );

	loadmodel.numtextures = nummiptex;
	loadmodel.textures = new Array( nummiptex );

	for ( let i = 0; i < nummiptex; i ++ ) {

		const dataofs = view.getInt32( 4 + i * 4, true );
		if ( dataofs === - 1 ) {

			loadmodel.textures[ i ] = null;
			continue;

		}

		// miptex_t at mod_base + fileofs + dataofs
		const mtOfs = fileofs + dataofs;
		const mtView = new DataView( mod_base.buffer, mod_base.byteOffset + mtOfs );

		const name = readString( mod_base, mtOfs, 16 );
		const width = mtView.getUint32( 16, true );
		const height = mtView.getUint32( 20, true );
		const offsets = [];
		for ( let j = 0; j < MIPLEVELS; j ++ )
			offsets[ j ] = mtView.getUint32( 24 + j * 4, true );

		if ( ( width & 15 ) || ( height & 15 ) )
			Sys_Error( 'Texture ' + name + ' is not 16 aligned' );

		const pixels = ( width * height / 64 ) * 85;

		const tx = new texture_t();
		loadmodel.textures[ i ] = tx;

		tx.name = name;
		tx.width = width;
		tx.height = height;
		for ( let j = 0; j < MIPLEVELS; j ++ )
			tx.offsets[ j ] = offsets[ j ];

		// Copy the pixel data (follows the miptex header in the file)
		// miptex header size is 16 (name) + 4 (width) + 4 (height) + 4*4 (offsets) = 40
		const SIZEOF_MIPTEX = 40;
		tx.pixels = new Uint8Array( pixels );
		for ( let j = 0; j < pixels; j ++ )
			tx.pixels[ j ] = mod_base[ mtOfs + SIZEOF_MIPTEX + j ];

		if ( name.substring( 0, 3 ) === 'sky' ) {

			R_InitSky( tx );

		} else {

			tx.gl_texture = GL_LoadTexture( name, tx.width, tx.height, tx.pixels, true, false, true );

		}

	}

	//
	// sequence the animations
	//
	const ANIM_CYCLE = 2;

	for ( let i = 0; i < nummiptex; i ++ ) {

		const tx = loadmodel.textures[ i ];
		if ( ! tx || tx.name.charAt( 0 ) !== '+' )
			continue;
		if ( tx.anim_next )
			continue;	// already sequenced

		// find the number of frames in the animation
		const anims = new Array( 10 ).fill( null );
		const altanims = new Array( 10 ).fill( null );

		let max = tx.name.charCodeAt( 1 );
		let altmax = 0;

		if ( max >= 'a'.charCodeAt( 0 ) && max <= 'z'.charCodeAt( 0 ) )
			max -= 'a'.charCodeAt( 0 ) - 'A'.charCodeAt( 0 );
		if ( max >= '0'.charCodeAt( 0 ) && max <= '9'.charCodeAt( 0 ) ) {

			max -= '0'.charCodeAt( 0 );
			altmax = 0;
			anims[ max ] = tx;
			max ++;

		} else if ( max >= 'A'.charCodeAt( 0 ) && max <= 'J'.charCodeAt( 0 ) ) {

			altmax = max - 'A'.charCodeAt( 0 );
			max = 0;
			altanims[ altmax ] = tx;
			altmax ++;

		} else {

			Sys_Error( 'Bad animating texture ' + tx.name );

		}

		for ( let j = i + 1; j < nummiptex; j ++ ) {

			const tx2 = loadmodel.textures[ j ];
			if ( ! tx2 || tx2.name.charAt( 0 ) !== '+' )
				continue;
			if ( tx2.name.substring( 2 ) !== tx.name.substring( 2 ) )
				continue;

			let num = tx2.name.charCodeAt( 1 );
			if ( num >= 'a'.charCodeAt( 0 ) && num <= 'z'.charCodeAt( 0 ) )
				num -= 'a'.charCodeAt( 0 ) - 'A'.charCodeAt( 0 );
			if ( num >= '0'.charCodeAt( 0 ) && num <= '9'.charCodeAt( 0 ) ) {

				num -= '0'.charCodeAt( 0 );
				anims[ num ] = tx2;
				if ( num + 1 > max )
					max = num + 1;

			} else if ( num >= 'A'.charCodeAt( 0 ) && num <= 'J'.charCodeAt( 0 ) ) {

				num = num - 'A'.charCodeAt( 0 );
				altanims[ num ] = tx2;
				if ( num + 1 > altmax )
					altmax = num + 1;

			} else {

				Sys_Error( 'Bad animating texture ' + tx.name );

			}

		}

		// link them all together
		for ( let j = 0; j < max; j ++ ) {

			const tx2 = anims[ j ];
			if ( ! tx2 )
				Sys_Error( 'Missing frame ' + j + ' of ' + tx.name );
			tx2.anim_total = max * ANIM_CYCLE;
			tx2.anim_min = j * ANIM_CYCLE;
			tx2.anim_max = ( j + 1 ) * ANIM_CYCLE;
			tx2.anim_next = anims[ ( j + 1 ) % max ];
			if ( altmax )
				tx2.alternate_anims = altanims[ 0 ];

		}

		for ( let j = 0; j < altmax; j ++ ) {

			const tx2 = altanims[ j ];
			if ( ! tx2 )
				Sys_Error( 'Missing frame ' + j + ' of ' + tx.name );
			tx2.anim_total = altmax * ANIM_CYCLE;
			tx2.anim_min = j * ANIM_CYCLE;
			tx2.anim_max = ( j + 1 ) * ANIM_CYCLE;
			tx2.anim_next = altanims[ ( j + 1 ) % altmax ];
			if ( max )
				tx2.alternate_anims = anims[ 0 ];

		}

	}

}

// ============================================================================
// Mod_LoadLighting
// ============================================================================

function Mod_LoadLighting( fileofs, filelen ) {

	if ( filelen === 0 ) {

		loadmodel.lightdata = null;
		return;

	}

	loadmodel.lightdata = new Uint8Array( filelen );
	loadmodel.lightdata.set( mod_base.subarray( fileofs, fileofs + filelen ) );

}

// ============================================================================
// Mod_LoadVisibility
// ============================================================================

function Mod_LoadVisibility( fileofs, filelen ) {

	if ( filelen === 0 ) {

		loadmodel.visdata = null;
		return;

	}

	loadmodel.visdata = new Uint8Array( filelen );
	loadmodel.visdata.set( mod_base.subarray( fileofs, fileofs + filelen ) );

}

// ============================================================================
// Mod_LoadEntities
// ============================================================================

function Mod_LoadEntities( fileofs, filelen ) {

	if ( filelen === 0 ) {

		loadmodel.entities = null;
		return;

	}

	// Read as string
	let s = '';
	for ( let i = 0; i < filelen; i ++ ) {

		const c = mod_base[ fileofs + i ];
		if ( c === 0 ) break;
		s += String.fromCharCode( c );

	}

	loadmodel.entities = s;

}

// ============================================================================
// Mod_LoadVertexes
// ============================================================================

function Mod_LoadVertexes( fileofs, filelen ) {

	if ( filelen % SIZEOF_DVERTEX )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DVERTEX;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.vertexes = out;
	loadmodel.numvertexes = count;

	for ( let i = 0; i < count; i ++ ) {

		const v = new mvertex_t();
		const base = i * SIZEOF_DVERTEX;
		v.position[ 0 ] = view.getFloat32( base, true );
		v.position[ 1 ] = view.getFloat32( base + 4, true );
		v.position[ 2 ] = view.getFloat32( base + 8, true );
		out[ i ] = v;

	}

}

// ============================================================================
// Mod_LoadEdges
// ============================================================================

function Mod_LoadEdges( fileofs, filelen ) {

	if ( filelen % SIZEOF_DEDGE )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DEDGE;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count + 1 );

	loadmodel.edges = out;
	loadmodel.numedges = count;

	for ( let i = 0; i < count; i ++ ) {

		const e = new medge_t();
		const base = i * SIZEOF_DEDGE;
		e.v[ 0 ] = view.getUint16( base, true );
		e.v[ 1 ] = view.getUint16( base + 2, true );
		out[ i ] = e;

	}

	// +1 slot (matches C allocation)
	out[ count ] = new medge_t();

}

// ============================================================================
// Mod_LoadSurfedges
// ============================================================================

function Mod_LoadSurfedges( fileofs, filelen ) {

	if ( filelen % 4 )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / 4;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Int32Array( count );

	loadmodel.surfedges = out;
	loadmodel.numsurfedges = count;

	for ( let i = 0; i < count; i ++ )
		out[ i ] = view.getInt32( i * 4, true );

}

// ============================================================================
// Mod_LoadPlanes
// ============================================================================

function Mod_LoadPlanes( fileofs, filelen ) {

	if ( filelen % SIZEOF_DPLANE )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DPLANE;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count * 2 ); // allocate 2x like C code

	loadmodel.planes = out;
	loadmodel.numplanes = count;

	for ( let i = 0; i < count; i ++ ) {

		const p = new mplane_t();
		const base = i * SIZEOF_DPLANE;
		let bits = 0;

		for ( let j = 0; j < 3; j ++ ) {

			p.normal[ j ] = view.getFloat32( base + j * 4, true );
			if ( p.normal[ j ] < 0 )
				bits |= 1 << j;

		}

		p.dist = view.getFloat32( base + 12, true );
		p.type = view.getInt32( base + 16, true );
		p.signbits = bits;

		out[ i ] = p;

	}

	// Fill remaining slots (C allocates count*2)
	for ( let i = count; i < count * 2; i ++ )
		out[ i ] = new mplane_t();

}

// ============================================================================
// Mod_LoadTexinfo
// ============================================================================

function Mod_LoadTexinfo( fileofs, filelen ) {

	if ( filelen % SIZEOF_TEXINFO )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_TEXINFO;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.texinfo = out;
	loadmodel.numtexinfo = count;

	for ( let i = 0; i < count; i ++ ) {

		const ti = new mtexinfo_t();
		const base = i * SIZEOF_TEXINFO;

		// Read vecs[2][4] = 8 floats
		for ( let j = 0; j < 4; j ++ )
			ti.vecs[ 0 ][ j ] = view.getFloat32( base + j * 4, true );
		for ( let j = 0; j < 4; j ++ )
			ti.vecs[ 1 ][ j ] = view.getFloat32( base + 16 + j * 4, true );

		// Compute mipadjust from vector lengths
		const len1 = Length( ti.vecs[ 0 ] ); // only first 3 components matter but Length uses all 3
		const len2 = Length( ti.vecs[ 1 ] );
		const lenAvg = ( len1 + len2 ) / 2;
		if ( lenAvg < 0.32 )
			ti.mipadjust = 4;
		else if ( lenAvg < 0.49 )
			ti.mipadjust = 3;
		else if ( lenAvg < 0.99 )
			ti.mipadjust = 2;
		else
			ti.mipadjust = 1;

		const miptex = view.getInt32( base + 32, true );
		ti.flags = view.getInt32( base + 36, true );

		if ( ! loadmodel.textures ) {

			ti.texture = r_notexture_mip;	// checkerboard texture
			ti.flags = 0;

		} else {

			if ( miptex >= loadmodel.numtextures )
				Sys_Error( 'miptex >= loadmodel->numtextures' );
			ti.texture = loadmodel.textures[ miptex ];
			if ( ! ti.texture ) {

				ti.texture = r_notexture_mip;	// texture not found
				ti.flags = 0;

			}

		}

		out[ i ] = ti;

	}

}

// ============================================================================
// CalcSurfaceExtents
//
// Fills in s->texturemins[] and s->extents[]
// ============================================================================

function CalcSurfaceExtents( s ) {

	const mins = [ 999999, 999999 ];
	const maxs = [ - 99999, - 99999 ];

	const tex = s.texinfo;

	for ( let i = 0; i < s.numedges; i ++ ) {

		let e = loadmodel.surfedges[ s.firstedge + i ];
		let v;
		if ( e >= 0 )
			v = loadmodel.vertexes[ loadmodel.edges[ e ].v[ 0 ] ];
		else
			v = loadmodel.vertexes[ loadmodel.edges[ - e ].v[ 1 ] ];

		for ( let j = 0; j < 2; j ++ ) {

			const val = v.position[ 0 ] * tex.vecs[ j ][ 0 ] +
						v.position[ 1 ] * tex.vecs[ j ][ 1 ] +
						v.position[ 2 ] * tex.vecs[ j ][ 2 ] +
						tex.vecs[ j ][ 3 ];
			if ( val < mins[ j ] )
				mins[ j ] = val;
			if ( val > maxs[ j ] )
				maxs[ j ] = val;

		}

	}

	for ( let i = 0; i < 2; i ++ ) {

		const bmins = Math.floor( mins[ i ] / 16 );
		const bmaxs = Math.ceil( maxs[ i ] / 16 );

		s.texturemins[ i ] = bmins * 16;
		s.extents[ i ] = ( bmaxs - bmins ) * 16;
		if ( ! ( tex.flags & TEX_SPECIAL ) && s.extents[ i ] > 512 )
			Sys_Error( 'Bad surface extents' );

	}

}

// ============================================================================
// Mod_LoadFaces
// ============================================================================

function Mod_LoadFaces( fileofs, filelen ) {

	if ( filelen % SIZEOF_DFACE )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DFACE;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.surfaces = out;
	loadmodel.numsurfaces = count;

	for ( let surfnum = 0; surfnum < count; surfnum ++ ) {

		const s = new msurface_t();
		const base = surfnum * SIZEOF_DFACE;

		s.firstedge = view.getInt32( base + 4, true );
		s.numedges = view.getInt16( base + 8, true );
		s.flags = 0;

		const planenum = view.getUint16( base, true );
		const side = view.getInt16( base + 2, true );
		if ( side )
			s.flags |= SURF_PLANEBACK;

		s.plane = loadmodel.planes[ planenum ];

		s.texinfo = loadmodel.texinfo[ view.getInt16( base + 10, true ) ];

		CalcSurfaceExtents( s );

		// lighting info
		for ( let i = 0; i < MAXLIGHTMAPS; i ++ )
			s.styles[ i ] = mod_base[ fileofs + base + 12 + i ];

		const lightofs = view.getInt32( base + 16, true );
		if ( lightofs === - 1 ) {

			s.samples = null;

		} else {

			s.samples = loadmodel.lightdata;
			s.sampleOffset = lightofs;

		}

		// set the drawing flags
		if ( s.texinfo.texture && s.texinfo.texture.name.substring( 0, 3 ) === 'sky' ) {

			s.flags |= ( SURF_DRAWSKY | SURF_DRAWTILED );
			GL_SubdivideSurface( s );
			out[ surfnum ] = s;
			continue;

		}

		if ( s.texinfo.texture && s.texinfo.texture.name.charAt( 0 ) === '*' ) {

			s.flags |= ( SURF_DRAWTURB | SURF_DRAWTILED );
			for ( let i = 0; i < 2; i ++ ) {

				s.extents[ i ] = 16384;
				s.texturemins[ i ] = - 8192;

			}

			GL_SubdivideSurface( s );
			out[ surfnum ] = s;
			continue;

		}

		out[ surfnum ] = s;

	}

}

// ============================================================================
// Mod_SetParent
// ============================================================================

function Mod_SetParent( node, parent ) {

	node.parent = parent;
	if ( node.contents < 0 )
		return;
	Mod_SetParent( node.children[ 0 ], node );
	Mod_SetParent( node.children[ 1 ], node );

}

// ============================================================================
// Mod_LoadNodes
// ============================================================================

function Mod_LoadNodes( fileofs, filelen ) {

	if ( filelen % SIZEOF_DNODE )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DNODE;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.nodes = out;
	loadmodel.numnodes = count;

	for ( let i = 0; i < count; i ++ ) {

		const node = new mnode_t();
		const base = i * SIZEOF_DNODE;

		for ( let j = 0; j < 3; j ++ ) {

			node.minmaxs[ j ] = view.getInt16( base + 8 + j * 2, true );
			node.minmaxs[ 3 + j ] = view.getInt16( base + 14 + j * 2, true );

		}

		const p = view.getInt32( base, true );
		node.plane = loadmodel.planes[ p ];

		node.firstsurface = view.getUint16( base + 20, true );
		node.numsurfaces = view.getUint16( base + 22, true );

		for ( let j = 0; j < 2; j ++ ) {

			const child = view.getInt16( base + 4 + j * 2, true );
			if ( child >= 0 ) {

				node.children[ j ] = null; // will be resolved after all nodes created
				node._childIndex = node._childIndex || [];
				node._childIndex[ j ] = { type: 'node', index: child };

			} else {

				node._childIndex = node._childIndex || [];
				node._childIndex[ j ] = { type: 'leaf', index: - 1 - child };

			}

		}

		out[ i ] = node;

	}

	// Resolve children references now that all nodes and leafs exist
	for ( let i = 0; i < count; i ++ ) {

		const node = out[ i ];
		for ( let j = 0; j < 2; j ++ ) {

			const ci = node._childIndex[ j ];
			if ( ci.type === 'node' ) {

				node.children[ j ] = loadmodel.nodes[ ci.index ];

			} else {

				node.children[ j ] = loadmodel.leafs[ ci.index ];

			}

		}

		delete node._childIndex;

	}

	Mod_SetParent( loadmodel.nodes[ 0 ], null );

}

// ============================================================================
// Mod_LoadLeafs
// ============================================================================

function Mod_LoadLeafs( fileofs, filelen ) {

	if ( filelen % SIZEOF_DLEAF )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DLEAF;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.leafs = out;
	loadmodel.numleafs = count;

	for ( let i = 0; i < count; i ++ ) {

		const leaf = new mleaf_t();
		leaf._leafIndex = i; // store index for PVS checks (C uses pointer arithmetic: leaf - sv.worldmodel->leafs)
		const base = i * SIZEOF_DLEAF;

		for ( let j = 0; j < 3; j ++ ) {

			leaf.minmaxs[ j ] = view.getInt16( base + 8 + j * 2, true );
			leaf.minmaxs[ 3 + j ] = view.getInt16( base + 14 + j * 2, true );

		}

		leaf.contents = view.getInt32( base, true );

		const firstmarksurfaceIdx = view.getUint16( base + 20, true );
		leaf.nummarksurfaces = view.getUint16( base + 22, true );

		// In C: leaf->firstmarksurface = loadmodel->marksurfaces + firstmarksurface;
		// This is a pointer into the marksurfaces array (which is an array of msurface_t*)
		// In JS we store the sub-array so leaf.firstmarksurface[j] works like C
		leaf.firstmarksurface = loadmodel.marksurfaces.slice(
			firstmarksurfaceIdx, firstmarksurfaceIdx + leaf.nummarksurfaces
		);

		const visofs = view.getInt32( base + 4, true );
		if ( visofs === - 1 ) {

			leaf.compressed_vis = null;

		} else {

			leaf.compressed_vis = loadmodel.visdata;
			leaf.compressed_vis_offset = visofs;

		}

		leaf.efrags = null;

		for ( let j = 0; j < 4; j ++ )
			leaf.ambient_sound_level[ j ] = mod_base[ fileofs + base + 24 + j ];

		// gl underwater warp
		if ( leaf.contents !== CONTENTS_EMPTY ) {

			for ( let j = 0; j < leaf.nummarksurfaces; j ++ ) {

				leaf.firstmarksurface[ j ].flags |= SURF_UNDERWATER;

			}

		}

		out[ i ] = leaf;

	}

}

// ============================================================================
// Mod_LoadClipnodes
// ============================================================================

function Mod_LoadClipnodes( fileofs, filelen ) {

	if ( filelen % SIZEOF_DCLIPNODE )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DCLIPNODE;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.clipnodes = out;
	loadmodel.numclipnodes = count;

	// hull 1 - player standing
	const hull1 = loadmodel.hulls[ 1 ];
	hull1.clipnodes = out;
	hull1.firstclipnode = 0;
	hull1.lastclipnode = count - 1;
	hull1.planes = loadmodel.planes;
	hull1.clip_mins[ 0 ] = - 16;
	hull1.clip_mins[ 1 ] = - 16;
	hull1.clip_mins[ 2 ] = - 24;
	hull1.clip_maxs[ 0 ] = 16;
	hull1.clip_maxs[ 1 ] = 16;
	hull1.clip_maxs[ 2 ] = 32;

	// hull 2 - shambler
	const hull2 = loadmodel.hulls[ 2 ];
	hull2.clipnodes = out;
	hull2.firstclipnode = 0;
	hull2.lastclipnode = count - 1;
	hull2.planes = loadmodel.planes;
	hull2.clip_mins[ 0 ] = - 32;
	hull2.clip_mins[ 1 ] = - 32;
	hull2.clip_mins[ 2 ] = - 24;
	hull2.clip_maxs[ 0 ] = 32;
	hull2.clip_maxs[ 1 ] = 32;
	hull2.clip_maxs[ 2 ] = 64;

	for ( let i = 0; i < count; i ++ ) {

		const cn = new dclipnode_t();
		const base = i * SIZEOF_DCLIPNODE;

		cn.planenum = view.getInt32( base, true );
		cn.children[ 0 ] = view.getInt16( base + 4, true );
		cn.children[ 1 ] = view.getInt16( base + 6, true );

		out[ i ] = cn;

	}

}

// ============================================================================
// Mod_MakeHull0
//
// Duplicate the drawing hull structure as a clipping hull
// ============================================================================

function Mod_MakeHull0() {

	const hull = loadmodel.hulls[ 0 ];

	const _in = loadmodel.nodes;
	const count = loadmodel.numnodes;
	const out = new Array( count );

	hull.clipnodes = out;
	hull.firstclipnode = 0;
	hull.lastclipnode = count - 1;
	hull.planes = loadmodel.planes;

	for ( let i = 0; i < count; i ++ ) {

		const cn = new dclipnode_t();
		const node = _in[ i ];

		cn.planenum = loadmodel.planes.indexOf( node.plane );

		for ( let j = 0; j < 2; j ++ ) {

			const child = node.children[ j ];
			if ( child.contents < 0 )
				cn.children[ j ] = child.contents;
			else
				cn.children[ j ] = loadmodel.nodes.indexOf( child );

		}

		out[ i ] = cn;

	}

}

// ============================================================================
// Mod_LoadMarksurfaces
// ============================================================================

function Mod_LoadMarksurfaces( fileofs, filelen ) {

	if ( filelen % 2 )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / 2;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.marksurfaces = out;
	loadmodel.nummarksurfaces = count;

	for ( let i = 0; i < count; i ++ ) {

		const j = view.getUint16( i * 2, true );
		if ( j >= loadmodel.numsurfaces )
			Sys_Error( 'Mod_ParseMarksurfaces: bad surface number' );
		out[ i ] = loadmodel.surfaces[ j ];

	}

}

// ============================================================================
// Mod_LoadSubmodels
// ============================================================================

function Mod_LoadSubmodels( fileofs, filelen ) {

	if ( filelen % SIZEOF_DMODEL )
		Sys_Error( 'MOD_LoadBmodel: funny lump size in ' + loadmodel.name );

	const count = filelen / SIZEOF_DMODEL;
	const view = new DataView( mod_base.buffer, mod_base.byteOffset + fileofs, filelen );
	const out = new Array( count );

	loadmodel.submodels = out;
	loadmodel.numsubmodels = count;

	for ( let i = 0; i < count; i ++ ) {

		const sm = new dmodel_t();
		const base = i * SIZEOF_DMODEL;

		for ( let j = 0; j < 3; j ++ ) {

			// spread the mins / maxs by a pixel
			sm.mins[ j ] = view.getFloat32( base + j * 4, true ) - 1;
			sm.maxs[ j ] = view.getFloat32( base + 12 + j * 4, true ) + 1;
			sm.origin[ j ] = view.getFloat32( base + 24 + j * 4, true );

		}

		for ( let j = 0; j < MAX_MAP_HULLS; j ++ )
			sm.headnode[ j ] = view.getInt32( base + 36 + j * 4, true );

		sm.visleafs = view.getInt32( base + 52, true );
		sm.firstface = view.getInt32( base + 56, true );
		sm.numfaces = view.getInt32( base + 60, true );

		out[ i ] = sm;

	}

}

// ============================================================================
// RadiusFromBounds
// ============================================================================

export function RadiusFromBounds( mins, maxs ) {

	const corner = new Float32Array( 3 );

	for ( let i = 0; i < 3; i ++ )
		corner[ i ] = Math.abs( mins[ i ] ) > Math.abs( maxs[ i ] ) ? Math.abs( mins[ i ] ) : Math.abs( maxs[ i ] );

	return Length( corner );

}

// ============================================================================
// Mod_LoadBrushModel
// ============================================================================

function Mod_LoadBrushModel( mod, buffer ) {

	loadmodel.type = mod_brush;

	const bytes = new Uint8Array( buffer );
	const view = new DataView( buffer );

	const version = view.getInt32( 0, true );
	if ( version !== BSPVERSION )
		Sys_Error( 'Mod_LoadBrushModel: ' + mod.name + ' has wrong version number (' + version + ' should be ' + BSPVERSION + ')' );

	// swap all the lumps
	mod_base = bytes;

	// Read lump directory: version (4 bytes) + HEADER_LUMPS * 2 ints (fileofs, filelen)
	const lumps = [];
	for ( let i = 0; i < HEADER_LUMPS; i ++ ) {

		lumps[ i ] = {
			fileofs: view.getInt32( 4 + i * 8, true ),
			filelen: view.getInt32( 4 + i * 8 + 4, true )
		};

	}

	// load into heap (order matters! same as original C code)
	Mod_LoadVertexes( lumps[ LUMP_VERTEXES ].fileofs, lumps[ LUMP_VERTEXES ].filelen );
	Mod_LoadEdges( lumps[ LUMP_EDGES ].fileofs, lumps[ LUMP_EDGES ].filelen );
	Mod_LoadSurfedges( lumps[ LUMP_SURFEDGES ].fileofs, lumps[ LUMP_SURFEDGES ].filelen );
	Mod_LoadTextures( lumps[ LUMP_TEXTURES ].fileofs, lumps[ LUMP_TEXTURES ].filelen );
	Mod_LoadLighting( lumps[ LUMP_LIGHTING ].fileofs, lumps[ LUMP_LIGHTING ].filelen );
	Mod_LoadPlanes( lumps[ LUMP_PLANES ].fileofs, lumps[ LUMP_PLANES ].filelen );
	Mod_LoadTexinfo( lumps[ LUMP_TEXINFO ].fileofs, lumps[ LUMP_TEXINFO ].filelen );
	Mod_LoadFaces( lumps[ LUMP_FACES ].fileofs, lumps[ LUMP_FACES ].filelen );
	Mod_LoadMarksurfaces( lumps[ LUMP_MARKSURFACES ].fileofs, lumps[ LUMP_MARKSURFACES ].filelen );
	Mod_LoadVisibility( lumps[ LUMP_VISIBILITY ].fileofs, lumps[ LUMP_VISIBILITY ].filelen );
	Mod_LoadLeafs( lumps[ LUMP_LEAFS ].fileofs, lumps[ LUMP_LEAFS ].filelen );
	Mod_LoadNodes( lumps[ LUMP_NODES ].fileofs, lumps[ LUMP_NODES ].filelen );
	Mod_LoadClipnodes( lumps[ LUMP_CLIPNODES ].fileofs, lumps[ LUMP_CLIPNODES ].filelen );
	Mod_LoadEntities( lumps[ LUMP_ENTITIES ].fileofs, lumps[ LUMP_ENTITIES ].filelen );
	Mod_LoadSubmodels( lumps[ LUMP_MODELS ].fileofs, lumps[ LUMP_MODELS ].filelen );

	Mod_MakeHull0();

	mod.numframes = 2;		// regular and alternate animation

	//
	// set up the submodels (FIXME: this is confusing)
	//
	for ( let i = 0; i < mod.numsubmodels; i ++ ) {

		const bm = mod.submodels[ i ];

		mod.hulls[ 0 ].firstclipnode = bm.headnode[ 0 ];
		for ( let j = 1; j < MAX_MAP_HULLS; j ++ ) {

			mod.hulls[ j ].firstclipnode = bm.headnode[ j ];
			mod.hulls[ j ].lastclipnode = mod.numclipnodes - 1;

		}

		mod.firstmodelsurface = bm.firstface;
		mod.nummodelsurfaces = bm.numfaces;

		VectorCopy( bm.maxs, mod.maxs );
		VectorCopy( bm.mins, mod.mins );

		mod.radius = RadiusFromBounds( mod.mins, mod.maxs );

		mod.numleafs = bm.visleafs;

		if ( i < mod.numsubmodels - 1 ) {

			// duplicate the basic information
			const name = '*' + ( i + 1 );
			const nextmodel = Mod_FindName( name );

			// Copy all properties
			nextmodel.type = mod.type;
			nextmodel.numframes = mod.numframes;
			nextmodel.synctype = mod.synctype;
			nextmodel.flags = mod.flags;
			VectorCopy( mod.mins, nextmodel.mins );
			VectorCopy( mod.maxs, nextmodel.maxs );
			nextmodel.radius = mod.radius;
			nextmodel.clipbox = mod.clipbox;
			VectorCopy( mod.clipmins, nextmodel.clipmins );
			VectorCopy( mod.clipmaxs, nextmodel.clipmaxs );
			nextmodel.firstmodelsurface = mod.firstmodelsurface;
			nextmodel.nummodelsurfaces = mod.nummodelsurfaces;
			nextmodel.numsubmodels = mod.numsubmodels;
			nextmodel.submodels = mod.submodels;
			nextmodel.numplanes = mod.numplanes;
			nextmodel.planes = mod.planes;
			nextmodel.numleafs = mod.numleafs;
			nextmodel.leafs = mod.leafs;
			nextmodel.numvertexes = mod.numvertexes;
			nextmodel.vertexes = mod.vertexes;
			nextmodel.numedges = mod.numedges;
			nextmodel.edges = mod.edges;
			nextmodel.numnodes = mod.numnodes;
			nextmodel.nodes = mod.nodes;
			nextmodel.numtexinfo = mod.numtexinfo;
			nextmodel.texinfo = mod.texinfo;
			nextmodel.numsurfaces = mod.numsurfaces;
			nextmodel.surfaces = mod.surfaces;
			nextmodel.numsurfedges = mod.numsurfedges;
			nextmodel.surfedges = mod.surfedges;
			nextmodel.numclipnodes = mod.numclipnodes;
			nextmodel.clipnodes = mod.clipnodes;
			nextmodel.nummarksurfaces = mod.nummarksurfaces;
			nextmodel.marksurfaces = mod.marksurfaces;
			for ( let h = 0; h < MAX_MAP_HULLS; h ++ ) {

				nextmodel.hulls[ h ].clipnodes = mod.hulls[ h ].clipnodes;
				nextmodel.hulls[ h ].planes = mod.hulls[ h ].planes;
				nextmodel.hulls[ h ].firstclipnode = mod.hulls[ h ].firstclipnode;
				nextmodel.hulls[ h ].lastclipnode = mod.hulls[ h ].lastclipnode;
				VectorCopy( mod.hulls[ h ].clip_mins, nextmodel.hulls[ h ].clip_mins );
				VectorCopy( mod.hulls[ h ].clip_maxs, nextmodel.hulls[ h ].clip_maxs );

			}

			nextmodel.numtextures = mod.numtextures;
			nextmodel.textures = mod.textures;
			nextmodel.visdata = mod.visdata;
			nextmodel.lightdata = mod.lightdata;
			nextmodel.entities = mod.entities;
			nextmodel.needload = false;

			nextmodel.name = name;
			loadmodel = nextmodel;
			mod = nextmodel;

		}

	}

}

// ============================================================================
//
//                        ALIAS MODELS
//
// ============================================================================

// ============================================================================
// Mod_LoadAliasFrame
// ============================================================================

function Mod_LoadAliasFrame( buf, offset, frame ) {

	const view = new DataView( buf, offset );

	// daliasframe_t: bboxmin (4 bytes), bboxmax (4 bytes), name (16 bytes) = 24 bytes
	frame.bboxmin.v[ 0 ] = new Uint8Array( buf, offset )[ 0 ];
	frame.bboxmin.v[ 1 ] = new Uint8Array( buf, offset )[ 1 ];
	frame.bboxmin.v[ 2 ] = new Uint8Array( buf, offset )[ 2 ];
	frame.bboxmax.v[ 0 ] = new Uint8Array( buf, offset + 4 )[ 0 ];
	frame.bboxmax.v[ 1 ] = new Uint8Array( buf, offset + 4 )[ 1 ];
	frame.bboxmax.v[ 2 ] = new Uint8Array( buf, offset + 4 )[ 2 ];

	frame.name = readString( new Uint8Array( buf ), offset + 8, 16 );

	frame.firstpose = posenum;
	frame.numposes = 1;

	// trivertx_t data follows the header
	const SIZEOF_DALIASFRAME = 24; // bboxmin(4) + bboxmax(4) + name(16)
	const pinframe = offset + SIZEOF_DALIASFRAME;

	poseverts[ posenum ] = { buffer: buf, offset: pinframe };
	posenum ++;

	const SIZEOF_TRIVERTX = 4;		// v[3] + lightnormalindex
	return pinframe + pheader.numverts * SIZEOF_TRIVERTX;

}

// ============================================================================
// Mod_LoadAliasGroup
// ============================================================================

function Mod_LoadAliasGroup( buf, offset, frame ) {

	const view = new DataView( buf, offset );

	// daliasgroup_t: int numframes, trivertx_t bboxmin, trivertx_t bboxmax = 12 bytes
	const numframes = view.getInt32( 0, true );

	frame.firstpose = posenum;
	frame.numposes = numframes;

	const bytes = new Uint8Array( buf, offset );
	frame.bboxmin.v[ 0 ] = bytes[ 4 ];
	frame.bboxmin.v[ 1 ] = bytes[ 5 ];
	frame.bboxmin.v[ 2 ] = bytes[ 6 ];
	frame.bboxmax.v[ 0 ] = bytes[ 8 ];
	frame.bboxmax.v[ 1 ] = bytes[ 9 ];
	frame.bboxmax.v[ 2 ] = bytes[ 10 ];

	const SIZEOF_DALIASGROUP = 12;
	const SIZEOF_DALIASINTERVAL = 4;		// float interval

	// Read interval from first interval
	const intervalView = new DataView( buf, offset + SIZEOF_DALIASGROUP );
	frame.interval = intervalView.getFloat32( 0, true );

	// Skip past all intervals
	let ptemp = offset + SIZEOF_DALIASGROUP + numframes * SIZEOF_DALIASINTERVAL;

	const SIZEOF_DALIASFRAME = 24;
	const SIZEOF_TRIVERTX = 4;

	for ( let i = 0; i < numframes; i ++ ) {

		poseverts[ posenum ] = { buffer: buf, offset: ptemp + SIZEOF_DALIASFRAME };
		posenum ++;

		ptemp = ptemp + SIZEOF_DALIASFRAME + pheader.numverts * SIZEOF_TRIVERTX;

	}

	return ptemp;

}

// ============================================================================
// Mod_FloodFillSkin
//
// Fill background pixels so mipmapping doesn't have haloes - Ed
// ============================================================================

function Mod_FloodFillSkin( skin, skinwidth, skinheight ) {

	const fillcolor = skin[ 0 ];
	const FLOODFILL_FIFO_SIZE = 0x1000;
	const FLOODFILL_FIFO_MASK = FLOODFILL_FIFO_SIZE - 1;

	const fifo_x = new Int16Array( FLOODFILL_FIFO_SIZE );
	const fifo_y = new Int16Array( FLOODFILL_FIFO_SIZE );
	let inpt = 0, outpt = 0;

	let filledcolor = 0;
	// attempt to find opaque black (simplified; Quake uses d_8to24table)
	// For now just use 0

	if ( fillcolor === filledcolor || fillcolor === 255 )
		return;

	fifo_x[ inpt ] = 0;
	fifo_y[ inpt ] = 0;
	inpt = ( inpt + 1 ) & FLOODFILL_FIFO_MASK;

	while ( outpt !== inpt ) {

		const x = fifo_x[ outpt ];
		const y = fifo_y[ outpt ];
		let fdc = filledcolor;
		const posOfs = x + skinwidth * y;

		outpt = ( outpt + 1 ) & FLOODFILL_FIFO_MASK;

		// FLOODFILL_STEP macro equivalent for each direction
		if ( x > 0 ) {

			if ( skin[ posOfs - 1 ] === fillcolor ) {

				skin[ posOfs - 1 ] = 255;
				fifo_x[ inpt ] = x - 1;
				fifo_y[ inpt ] = y;
				inpt = ( inpt + 1 ) & FLOODFILL_FIFO_MASK;

			} else if ( skin[ posOfs - 1 ] !== 255 ) {

				fdc = skin[ posOfs - 1 ];

			}

		}

		if ( x < skinwidth - 1 ) {

			if ( skin[ posOfs + 1 ] === fillcolor ) {

				skin[ posOfs + 1 ] = 255;
				fifo_x[ inpt ] = x + 1;
				fifo_y[ inpt ] = y;
				inpt = ( inpt + 1 ) & FLOODFILL_FIFO_MASK;

			} else if ( skin[ posOfs + 1 ] !== 255 ) {

				fdc = skin[ posOfs + 1 ];

			}

		}

		if ( y > 0 ) {

			if ( skin[ posOfs - skinwidth ] === fillcolor ) {

				skin[ posOfs - skinwidth ] = 255;
				fifo_x[ inpt ] = x;
				fifo_y[ inpt ] = y - 1;
				inpt = ( inpt + 1 ) & FLOODFILL_FIFO_MASK;

			} else if ( skin[ posOfs - skinwidth ] !== 255 ) {

				fdc = skin[ posOfs - skinwidth ];

			}

		}

		if ( y < skinheight - 1 ) {

			if ( skin[ posOfs + skinwidth ] === fillcolor ) {

				skin[ posOfs + skinwidth ] = 255;
				fifo_x[ inpt ] = x;
				fifo_y[ inpt ] = y + 1;
				inpt = ( inpt + 1 ) & FLOODFILL_FIFO_MASK;

			} else if ( skin[ posOfs + skinwidth ] !== 255 ) {

				fdc = skin[ posOfs + skinwidth ];

			}

		}

		skin[ x + skinwidth * y ] = fdc;

	}

}

// ============================================================================
// Mod_LoadAllSkins
// ============================================================================

function Mod_LoadAllSkins( buf, numskins, offset ) {

	if ( numskins < 1 || numskins > MAX_SKINS )
		Sys_Error( 'Mod_LoadAliasModel: Invalid # of skins: ' + numskins );

	const s = pheader.skinwidth * pheader.skinheight;
	const SIZEOF_DALIASSKINTYPE = 4; // int type

	let pos = offset;

	for ( let i = 0; i < numskins; i ++ ) {

		const view = new DataView( buf, pos );
		const skintype = view.getInt32( 0, true );

		if ( skintype === ALIAS_SKIN_SINGLE ) {

			// Skin data starts after the type int
			const skinDataOfs = pos + SIZEOF_DALIASSKINTYPE;
			const skin = new Uint8Array( buf, skinDataOfs, s );
			Mod_FloodFillSkin( skin, pheader.skinwidth, pheader.skinheight );

			// Save 8 bit texels for player model remapping
			pheader.texels[ i ] = new Uint8Array( s );
			pheader.texels[ i ].set( skin );

			const name = loadmodel.name + '_' + i;
			pheader.gl_texturenum[ i ][ 0 ] =
			pheader.gl_texturenum[ i ][ 1 ] =
			pheader.gl_texturenum[ i ][ 2 ] =
			pheader.gl_texturenum[ i ][ 3 ] =
				GL_LoadTexture( name, pheader.skinwidth, pheader.skinheight, skin, true, false );

			pos = skinDataOfs + s;

		} else {

			// animating skin group
			pos += SIZEOF_DALIASSKINTYPE;
			const groupView = new DataView( buf, pos );
			const groupskins = groupView.getInt32( 0, true ); // daliasskingroup_t.numskins
			const SIZEOF_DALIASSKINGROUP = 4;
			const SIZEOF_DALIASSKININTERVAL = 4;

			pos += SIZEOF_DALIASSKINGROUP + groupskins * SIZEOF_DALIASSKININTERVAL;

			for ( let j = 0; j < groupskins; j ++ ) {

				const skin = new Uint8Array( buf, pos, s );
				Mod_FloodFillSkin( skin, pheader.skinwidth, pheader.skinheight );

				if ( j === 0 ) {

					pheader.texels[ i ] = new Uint8Array( s );
					pheader.texels[ i ].set( skin );

				}

				const name = loadmodel.name + '_' + i + '_' + j;
				pheader.gl_texturenum[ i ][ j & 3 ] =
					GL_LoadTexture( name, pheader.skinwidth, pheader.skinheight, skin, true, false );

				pos += s;

			}

			// fill remaining texture slots
			for ( let j = groupskins; j < 4; j ++ )
				pheader.gl_texturenum[ i ][ j & 3 ] = pheader.gl_texturenum[ i ][ j - groupskins ];

		}

	}

	return pos;

}

// ============================================================================
// Mod_LoadAliasModel
// ============================================================================

function Mod_LoadAliasModel( mod, buffer ) {

	const view = new DataView( buffer );
	const bytes = new Uint8Array( buffer );

	// mdl_t header
	const version = view.getInt32( 4, true );
	if ( version !== ALIAS_VERSION )
		Sys_Error( mod.name + ' has wrong version number (' + version + ' should be ' + ALIAS_VERSION + ')' );

	const numframes = view.getInt32( 68, true ); // offset of numframes in mdl_t

	// Allocate header
	pheader = new aliashdr_t();
	pheader.frames = [];

	for ( let i = 0; i < numframes; i ++ )
		pheader.frames[ i ] = new maliasframedesc_t();

	mod.flags = view.getInt32( 72, true );

	// Copy header data from mdl_t
	// mdl_t layout: ident(4), version(4), scale(12), scale_origin(12), boundingradius(4),
	// eyeposition(12), numskins(4), skinwidth(4), skinheight(4), numverts(4), numtris(4),
	// numframes(4), synctype(4), flags(4), size(4) = total 84 bytes
	pheader.boundingradius = view.getFloat32( 32, true );

	// mdl_t offsets:
	// int ident = 0
	// int version = 4
	// vec3_t scale = 8, 12, 16
	// vec3_t scale_origin = 20, 24, 28
	// float boundingradius = 32
	// vec3_t eyeposition = 36, 40, 44
	// int numskins = 48
	// int skinwidth = 52
	// int skinheight = 56
	// int numverts = 60
	// int numtris = 64
	// int numframes = 68
	// synctype_t synctype = 72
	// int flags = 76
	// float size = 80
	// total = 84

	pheader.numskins = view.getInt32( 48, true );
	pheader.skinwidth = view.getInt32( 52, true );
	pheader.skinheight = view.getInt32( 56, true );
	pheader.numverts = view.getInt32( 60, true );
	pheader.numtris = view.getInt32( 64, true );
	pheader.numframes = view.getInt32( 68, true );

	if ( pheader.skinheight > MAX_LBM_HEIGHT )
		Sys_Error( 'model ' + mod.name + ' has a skin taller than ' + MAX_LBM_HEIGHT );
	if ( pheader.numverts <= 0 )
		Sys_Error( 'model ' + mod.name + ' has no vertices' );
	if ( pheader.numverts > MAXALIASVERTS )
		Sys_Error( 'model ' + mod.name + ' has too many vertices' );
	if ( pheader.numtris <= 0 )
		Sys_Error( 'model ' + mod.name + ' has no triangles' );
	if ( pheader.numframes < 1 )
		Sys_Error( 'Mod_LoadAliasModel: Invalid # of frames: ' + pheader.numframes );

	pheader.size = view.getFloat32( 80, true ) * ALIAS_BASE_SIZE_RATIO;
	mod.synctype = view.getInt32( 72, true );
	mod.numframes = pheader.numframes;
	mod.flags = view.getInt32( 76, true );

	for ( let i = 0; i < 3; i ++ ) {

		pheader.scale[ i ] = view.getFloat32( 8 + i * 4, true );
		pheader.scale_origin[ i ] = view.getFloat32( 20 + i * 4, true );
		pheader.eyeposition[ i ] = view.getFloat32( 36 + i * 4, true );

	}

	pheader.boundingradius = view.getFloat32( 32, true );

	// Initialize frames array
	pheader.frames = [];
	for ( let i = 0; i < pheader.numframes; i ++ )
		pheader.frames[ i ] = new maliasframedesc_t();

	//
	// load the skins
	//
	const SIZEOF_MDL = 84;
	let pos = Mod_LoadAllSkins( buffer, pheader.numskins, SIZEOF_MDL );

	//
	// load base s and t vertices
	// stvert_t: int onseam, int s, int t = 12 bytes
	//
	const SIZEOF_STVERT = 12;
	for ( let i = 0; i < pheader.numverts; i ++ ) {

		const sv = new DataView( buffer, pos + i * SIZEOF_STVERT );
		stverts[ i ].onseam = sv.getInt32( 0, true );
		stverts[ i ].s = sv.getInt32( 4, true );
		stverts[ i ].t = sv.getInt32( 8, true );

	}

	pos += pheader.numverts * SIZEOF_STVERT;

	//
	// load triangle lists
	// dtriangle_t: int facesfront, int vertindex[3] = 16 bytes
	//
	const SIZEOF_DTRIANGLE = 16;
	for ( let i = 0; i < pheader.numtris; i ++ ) {

		const tv = new DataView( buffer, pos + i * SIZEOF_DTRIANGLE );
		triangles[ i ].facesfront = tv.getInt32( 0, true );
		for ( let j = 0; j < 3; j ++ )
			triangles[ i ].vertindex[ j ] = tv.getInt32( 4 + j * 4, true );

	}

	pos += pheader.numtris * SIZEOF_DTRIANGLE;

	//
	// load the frames
	//
	posenum = 0;
	const SIZEOF_DALIASFRAMETYPE = 4; // int type

	for ( let i = 0; i < pheader.numframes; i ++ ) {

		const ftView = new DataView( buffer, pos );
		const frametype = ftView.getInt32( 0, true );

		if ( frametype === ALIAS_SINGLE ) {

			pos = Mod_LoadAliasFrame( buffer, pos + SIZEOF_DALIASFRAMETYPE, pheader.frames[ i ] );

		} else {

			pos = Mod_LoadAliasGroup( buffer, pos + SIZEOF_DALIASFRAMETYPE, pheader.frames[ i ] );

		}

	}

	pheader.numposes = posenum;

	mod.type = mod_alias;

	// FIXME: do this right
	mod.mins[ 0 ] = mod.mins[ 1 ] = mod.mins[ 2 ] = - 16;
	mod.maxs[ 0 ] = mod.maxs[ 1 ] = mod.maxs[ 2 ] = 16;

	//
	// Decode poseverts from raw {buffer, offset} into arrays of trivertx_t objects
	// so that GL_MakeAliasModelDisplayLists can index them
	//
	const decodedPoseverts = [];
	for ( let i = 0; i < pheader.numposes; i ++ ) {

		const pv = poseverts[ i ];
		const verts = [];
		const data = new Uint8Array( pv.buffer );
		for ( let j = 0; j < pheader.numverts; j ++ ) {

			const off = pv.offset + j * 4; // trivertx_t = 4 bytes: v[3] + lightnormalindex
			verts.push( {
				v: [ data[ off ], data[ off + 1 ], data[ off + 2 ] ],
				lightnormalindex: data[ off + 3 ]
			} );

		}

		decodedPoseverts.push( verts );

	}

	// Wire up data needed by GL_MakeAliasModelDisplayLists
	pheader.triangles = triangles;
	pheader.stverts = stverts;
	pheader.poseverts = decodedPoseverts;

	//
	// build the draw lists
	//
	GL_MakeAliasModelDisplayLists( mod, pheader );

	//
	// move the complete, relocatable alias model to the cache
	//
	mod.cache.data = pheader;

}

// ============================================================================
//
//                        SPRITE MODELS
//
// ============================================================================

// ============================================================================
// Mod_LoadSpriteFrame
// ============================================================================

function Mod_LoadSpriteFrame( buf, offset, framenum ) {

	const view = new DataView( buf, offset );

	// dspriteframe_t: int origin[2], int width, int height = 16 bytes
	const width = view.getInt32( 8, true );
	const height = view.getInt32( 12, true );
	const size = width * height;

	const pspriteframe = new mspriteframe_t();

	pspriteframe.width = width;
	pspriteframe.height = height;

	const origin0 = view.getInt32( 0, true );
	const origin1 = view.getInt32( 4, true );

	pspriteframe.up = origin1;
	pspriteframe.down = origin1 - height;
	pspriteframe.left = origin0;
	pspriteframe.right = width + origin0;

	const SIZEOF_DSPRITEFRAME = 16;
	const name = loadmodel.name + '_' + framenum;
	const pixelData = new Uint8Array( buf, offset + SIZEOF_DSPRITEFRAME, size );
	pspriteframe.gl_texturenum = GL_LoadTexture( name, width, height, pixelData, true, true );

	return {
		frame: pspriteframe,
		nextOffset: offset + SIZEOF_DSPRITEFRAME + size
	};

}

// ============================================================================
// Mod_LoadSpriteGroup
// ============================================================================

function Mod_LoadSpriteGroup( buf, offset, framenum ) {

	const view = new DataView( buf, offset );

	// dspritegroup_t: int numframes = 4 bytes
	const numframes = view.getInt32( 0, true );

	const pspritegroup = new mspritegroup_t();
	pspritegroup.numframes = numframes;

	const SIZEOF_DSPRITEGROUP = 4;
	const SIZEOF_DSPRITEINTERVAL = 4;

	// Read intervals
	pspritegroup.intervals = new Float32Array( numframes );
	let intervalOfs = offset + SIZEOF_DSPRITEGROUP;

	for ( let i = 0; i < numframes; i ++ ) {

		const iv = new DataView( buf, intervalOfs );
		pspritegroup.intervals[ i ] = iv.getFloat32( 0, true );
		if ( pspritegroup.intervals[ i ] <= 0.0 )
			Sys_Error( 'Mod_LoadSpriteGroup: interval<=0' );
		intervalOfs += SIZEOF_DSPRITEINTERVAL;

	}

	// Load frames
	pspritegroup.frames = new Array( numframes );
	let ptemp = intervalOfs;

	for ( let i = 0; i < numframes; i ++ ) {

		const result = Mod_LoadSpriteFrame( buf, ptemp, framenum * 100 + i );
		pspritegroup.frames[ i ] = result.frame;
		ptemp = result.nextOffset;

	}

	return {
		frame: pspritegroup,
		nextOffset: ptemp
	};

}

// ============================================================================
// Mod_LoadSpriteModel
// ============================================================================

function Mod_LoadSpriteModel( mod, buffer ) {

	const view = new DataView( buffer );

	// dsprite_t: int ident, int version, int type, float boundingradius,
	//            int width, int height, int numframes, float beamlength, synctype_t synctype
	//            = 36 bytes
	const version = view.getInt32( 4, true );
	if ( version !== SPRITE_VERSION )
		Sys_Error( mod.name + ' has wrong version number (' + version + ' should be ' + SPRITE_VERSION + ')' );

	const numframes = view.getInt32( 24, true );

	const psprite = new msprite_t();
	mod.cache.data = psprite;

	psprite.type = view.getInt32( 8, true );
	psprite.maxwidth = view.getInt32( 16, true );
	psprite.maxheight = view.getInt32( 20, true );
	psprite.beamlength = view.getFloat32( 28, true );
	mod.synctype = view.getInt32( 32, true );
	psprite.numframes = numframes;

	mod.mins[ 0 ] = mod.mins[ 1 ] = - psprite.maxwidth / 2;
	mod.maxs[ 0 ] = mod.maxs[ 1 ] = psprite.maxwidth / 2;
	mod.mins[ 2 ] = - psprite.maxheight / 2;
	mod.maxs[ 2 ] = psprite.maxheight / 2;

	//
	// load the frames
	//
	if ( numframes < 1 )
		Sys_Error( 'Mod_LoadSpriteModel: Invalid # of frames: ' + numframes );

	mod.numframes = numframes;

	psprite.frames = new Array( numframes );

	const SIZEOF_DSPRITE = 36;
	const SIZEOF_DSPRITEFRAMETYPE = 4;
	let pos = SIZEOF_DSPRITE;

	for ( let i = 0; i < numframes; i ++ ) {

		const ftView = new DataView( buffer, pos );
		const frametype = ftView.getInt32( 0, true );

		const fdesc = new mspriteframedesc_t();
		fdesc.type = frametype;

		if ( frametype === SPR_SINGLE ) {

			const result = Mod_LoadSpriteFrame( buffer, pos + SIZEOF_DSPRITEFRAMETYPE, i );
			fdesc.frameptr = result.frame;
			pos = result.nextOffset;

		} else {

			const result = Mod_LoadSpriteGroup( buffer, pos + SIZEOF_DSPRITEFRAMETYPE, i );
			fdesc.frameptr = result.frame;
			pos = result.nextOffset;

		}

		psprite.frames[ i ] = fdesc;

	}

	mod.type = mod_sprite;

}

// ============================================================================
// Mod_Print
// ============================================================================

export function Mod_Print() {

	Con_Printf( 'Cached models:\n' );
	for ( let i = 0; i < mod_numknown; i ++ ) {

		const mod = mod_known[ i ];
		Con_Printf( '  ' + ( mod.cache.data ? '[cached]' : '[empty]' ) + ' : ' + mod.name + '\n' );

	}

}
