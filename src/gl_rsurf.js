// Ported from: WinQuake/gl_rsurf.c -- surface-related refresh code

import * as THREE from 'three';
import { Sys_Error } from './sys.js';
import { Con_Printf, Con_DPrintf, COM_CheckParm } from './common.js';
import { vid } from './vid.js';

function createQuakeLightmapMaterial( diffuseMap, lightmapTex ) {

	lightmapTex.channel = 1; // Use uv1 for lightmap coordinates

	// Use MeshLambertMaterial so surfaces respond to Three.js PointLights
	// for dynamic lighting effects (explosions, muzzle flashes, etc.)
	return new THREE.MeshLambertMaterial( {
		map: diffuseMap,
		lightMap: lightmapTex,
		lightMapIntensity: 2
	} );

}
import { cl, cl_dlights } from './client.js';
import {
	r_refdef, r_origin, vpn, vright, vup
} from './render.js';
import {
	BACKFACE_EPSILON, VERTEXSIZE, PLANE_X, PLANE_Y, PLANE_Z,
	SURF_PLANEBACK, SURF_DRAWSKY, SURF_DRAWTURB, SURF_UNDERWATER,
	SURF_DRAWTILED, MAXLIGHTMAPS,
	modelorg, r_entorigin, currententity,
	r_visframecount, r_framecount, frustum,
	c_brush_polys, c_alias_polys,
	currenttexture, mirror, mirrortexturenum, mirror_plane,
	d_lightstylevalue, r_world_matrix,
	r_norefresh, r_drawentities, r_drawworld, r_fullbright,
	r_lightmap, r_dynamic, r_wateralpha, r_mirroralpha, r_novis,
	gl_texsort, gl_flashblend, gl_keeptjunctions,
	R_CullBox, scene, gldepthmin, gldepthmax,
	r_viewleaf, r_oldviewleaf,
	inc_r_visframecount, set_r_framecount,
	inc_c_brush_polys, set_currenttexture,
	set_r_oldviewleaf, set_mirror, set_mirror_plane
} from './gl_rmain.js';
import { VID_GetWorldContainer } from './vid.js';
import {
	DotProduct, VectorCopy, VectorSubtract, VectorAdd, VectorNormalize,
	AngleVectors, Length
} from './mathlib.js';
import { Mod_LeafPVS, solidskytexture, alphaskytexture } from './gl_model.js';
import { realtime } from './host.js';

//============================================================================
// Constants
//============================================================================

export const BLOCK_WIDTH = 128;
export const BLOCK_HEIGHT = 128;
export const MAX_LIGHTMAPS = 64;

const GL_LUMINANCE = 0x1909;
const GL_ALPHA = 0x1906;
const GL_INTENSITY = 0x8049;
const GL_RGBA = 0x1908;
const GL_RGBA4 = 0;

//============================================================================
// Module-level state
//============================================================================

export let skytexturenum = - 1; // index in cl.loadmodel, not gl texture object
export function set_skytexturenum( v ) { skytexturenum = v; }

let lightmap_bytes = 1; // 1, 2, or 4
let lightmap_textures = 0;

const blocklights = new Uint32Array( 18 * 18 );

let active_lightmaps = 0;

// glRect_t equivalent
class glRect_t {

	constructor() {

		this.l = 0;
		this.t = 0;
		this.w = 0;
		this.h = 0;

	}

}

const lightmap_polys = new Array( MAX_LIGHTMAPS ).fill( null );
const lightmap_modified = new Array( MAX_LIGHTMAPS ).fill( false );
const lightmap_rectchange = [];
for ( let i = 0; i < MAX_LIGHTMAPS; i ++ ) {

	lightmap_rectchange.push( new glRect_t() );

}

// allocated[texnum][column] = height used so far
const allocated = [];
for ( let i = 0; i < MAX_LIGHTMAPS; i ++ ) {

	allocated.push( new Int32Array( BLOCK_WIDTH ) );

}

// the lightmap texture data needs to be kept in main memory
// so texsubimage can update properly
const lightmaps = new Uint8Array( 4 * MAX_LIGHTMAPS * BLOCK_WIDTH * BLOCK_HEIGHT );

// For gl_texsort 0
let skychain = null; // msurface_t
let waterchain = null; // msurface_t

// Turbulent surface sin table for water/sky warping
const TURBSCALE = ( 256.0 / ( 2 * Math.PI ) );
const turbsin = new Float32Array( [
	0, 0.19633, 0.392541, 0.588517, 0.784137, 0.979285, 1.17384, 1.3677,
	1.56072, 1.75281, 1.94384, 2.1337, 2.32228, 2.50945, 2.69512, 2.87916,
	3.06147, 3.24193, 3.42044, 3.59689, 3.77117, 3.94319, 4.11282, 4.27998,
	4.44456, 4.60647, 4.76559, 4.92185, 5.07515, 5.22538, 5.37247, 5.51632,
	5.65685, 5.79398, 5.92761, 6.05767, 6.18408, 6.30677, 6.42566, 6.54068,
	6.65176, 6.75883, 6.86183, 6.9607, 7.05537, 7.14579, 7.23191, 7.31368,
	7.39104, 7.46394, 7.53235, 7.59623, 7.65552, 7.71021, 7.76025, 7.80562,
	7.84628, 7.88222, 7.91341, 7.93984, 7.96148, 7.97832, 7.99036, 7.99759,
	8, 7.99759, 7.99036, 7.97832, 7.96148, 7.93984, 7.91341, 7.88222,
	7.84628, 7.80562, 7.76025, 7.71021, 7.65552, 7.59623, 7.53235, 7.46394,
	7.39104, 7.31368, 7.23191, 7.14579, 7.05537, 6.9607, 6.86183, 6.75883,
	6.65176, 6.54068, 6.42566, 6.30677, 6.18408, 6.05767, 5.92761, 5.79398,
	5.65685, 5.51632, 5.37247, 5.22538, 5.07515, 4.92185, 4.76559, 4.60647,
	4.44456, 4.27998, 4.11282, 3.94319, 3.77117, 3.59689, 3.42044, 3.24193,
	3.06147, 2.87916, 2.69512, 2.50945, 2.32228, 2.1337, 1.94384, 1.75281,
	1.56072, 1.3677, 1.17384, 0.979285, 0.784137, 0.588517, 0.392541, 0.19633,
	0, -0.19633, -0.392541, -0.588517, -0.784137, -0.979285, -1.17384, -1.3677,
	-1.56072, -1.75281, -1.94384, -2.1337, -2.32228, -2.50945, -2.69512, -2.87916,
	-3.06147, -3.24193, -3.42044, -3.59689, -3.77117, -3.94319, -4.11282, -4.27998,
	-4.44456, -4.60647, -4.76559, -4.92185, -5.07515, -5.22538, -5.37247, -5.51632,
	-5.65685, -5.79398, -5.92761, -6.05767, -6.18408, -6.30677, -6.42566, -6.54068,
	-6.65176, -6.75883, -6.86183, -6.9607, -7.05537, -7.14579, -7.23191, -7.31368,
	-7.39104, -7.46394, -7.53235, -7.59623, -7.65552, -7.71021, -7.76025, -7.80562,
	-7.84628, -7.88222, -7.91341, -7.93984, -7.96148, -7.97832, -7.99036, -7.99759,
	-8, -7.99759, -7.99036, -7.97832, -7.96148, -7.93984, -7.91341, -7.88222,
	-7.84628, -7.80562, -7.76025, -7.71021, -7.65552, -7.59623, -7.53235, -7.46394,
	-7.39104, -7.31368, -7.23191, -7.14579, -7.05537, -6.9607, -6.86183, -6.75883,
	-6.65176, -6.54068, -6.42566, -6.30677, -6.18408, -6.05767, -5.92761, -5.79398,
	-5.65685, -5.51632, -5.37247, -5.22538, -5.07515, -4.92185, -4.76559, -4.60647,
	-4.44456, -4.27998, -4.11282, -3.94319, -3.77117, -3.59689, -3.42044, -3.24193,
	-3.06147, -2.87916, -2.69512, -2.50945, -2.32228, -2.1337, -1.94384, -1.75281,
	-1.56072, -1.3677, -1.17384, -0.979285, -0.784137, -0.588517, -0.392541, -0.19633,
] );

export let gl_lightmap_format = GL_LUMINANCE;
export let gl_solid_format = 3;
export let gl_alpha_format = 4;

// multitexture state (not used in Three.js path, kept for algorithm fidelity)
let mtexenabled = false;
export let gl_mtexable = false;

// external references
let r_pcurrentvertbase = null;
let currentmodel = null;
let nColinElim = 0;

// Three.js geometry cache for BSP surfaces
let worldGroup = null; // THREE.Group for world BSP
let worldMeshesBuilt = false; // true after R_BuildWorldMeshes has run

// PVS visibility using BatchedMesh for efficient rendering
// instanceVisInfo: Array<{batch: BatchedMesh, instanceId: number, leaves: leaf[]}>
// Each instance tracks all leaves that contain its surface - visible if ANY leaf is visible
const instanceVisInfo = [];

// All BatchedMesh objects for the world (one per texture/lightmap combo)
const worldBatchedMeshes = [];

// Pre-allocated scratch arrays to avoid per-frame allocations
const _cullBoxMaxs = new Float32Array( 3 ); // for R_CullBox in R_RecursiveWorldNode

// Water/sky mesh tracking: Set-based approach to add/remove from scene
// without creating/disposing meshes every frame
let _waterMeshesInScene = new Set();
let _waterMeshesThisFrame = new Set();

// Water/sky material caches: texture -> material (avoid per-frame material creation)
const _waterMaterialCache = new Map();

// Brush entity rendering support
// currentRenderGroup is the THREE.Group that surface renderers add meshes to.
// Defaults to worldGroup, but temporarily swapped to a brush entity group
// during R_DrawBrushModel (equivalent of glPushMatrix/glPopMatrix).
let currentRenderGroup = null;
let brushEntityGroups = []; // per-frame brush entity groups to dispose next frame

// Material cache for brush entities - keyed by "diffuseId_lightmapId"
// Materials are reused across frames to avoid shader recompilation
const _brushMaterialCache = new Map();

// Track all brush entity groups for disposal on map change
const _allBrushEntityGroups = new Set();

// Pre-allocated scratch arrays for R_DrawBrushModel (avoid per-call allocations)
const _brushMins = new Float32Array( 3 );
const _brushMaxs = new Float32Array( 3 );
const _brushTemp = new Float32Array( 3 );
const _brushForward = new Float32Array( 3 );
const _brushRight = new Float32Array( 3 );
const _brushUp = new Float32Array( 3 );
const _brushPlaneNormal = new Float32Array( 3 );

/*
================
_getWaterMaterial

Returns a cached material for water/turb surfaces. Keyed by texture object.
================
*/
function _getWaterMaterial( t, opacity ) {

	// Use texture + opacity bucket as key
	const opKey = opacity < 1.0 ? 0 : 1;
	const key = ( t && t.gl_texture ) ? t.gl_texture : null;
	const cacheKey = key ? key.id * 2 + opKey : opKey;

	let material = _waterMaterialCache.get( cacheKey );
	if ( ! material ) {

		material = new THREE.MeshBasicMaterial( {
			map: ( t && t.gl_texture ) ? t.gl_texture : null,
			color: ( t && t.gl_texture ) ? 0xffffff : 0x406080,
			transparent: true,
			opacity: opacity,
			side: THREE.DoubleSide
		} );
		_waterMaterialCache.set( cacheKey, material );

	}

	return material;

}

/*
================
_getWaterMesh

Returns a cached Mesh for a water/turb surface. Cached on the surface object.
================
*/
function _getWaterMesh( s, geometry, material, renderGroup ) {

	let mesh = s._waterMesh;
	if ( ! mesh ) {

		mesh = new THREE.Mesh( geometry, material );
		s._waterMesh = mesh;

	} else {

		if ( mesh.geometry !== geometry ) mesh.geometry = geometry;
		if ( mesh.material !== material ) mesh.material = material;

	}

	// Ensure mesh is in the correct parent group
	if ( mesh.parent !== renderGroup ) {

		if ( mesh.parent ) mesh.parent.remove( mesh );
		renderGroup.add( mesh );

	}

	_waterMeshesThisFrame.add( mesh );
	_waterMeshesInScene.add( mesh );

	return mesh;

}

//============================================================================
// R_TextureAnimation
//
// Returns the proper texture for a given time and base texture
//============================================================================

export function R_TextureAnimation( base ) {

	let reletive;
	let count;

	if ( currententity && currententity.frame ) {

		if ( base.alternate_anims )
			base = base.alternate_anims;

	}

	if ( base.anim_total === 0 )
		return base;

	// cl.time needs to be connected
	const time = cl != null ? cl.time : 0;
	reletive = ( ( time * 10 ) | 0 ) % base.anim_total;

	count = 0;
	while ( base.anim_min > reletive || base.anim_max <= reletive ) {

		base = base.anim_next;
		if ( base == null )
			Sys_Error( 'R_TextureAnimation: broken cycle' );
		if ( ++ count > 100 )
			Sys_Error( 'R_TextureAnimation: infinite cycle' );

	}

	return base;

}

//============================================================================
// DrawGLPoly
//
// Draws a polygon. In Three.js, we build BufferGeometry from the glpoly_t
// vertex data and add it to the scene.
//============================================================================

export function DrawGLPoly( p, planeNormal ) {

	if ( ! p || p.numverts < 3 ) return;

	// Build triangle fan from polygon vertices
	// glpoly_t stores verts as flat array: [x,y,z,s,t,ls,lt] per vertex
	const numverts = p.numverts;
	const verts = p.verts;
	const numTriangles = numverts - 2;

	const positions = new Float32Array( numTriangles * 3 * 3 );
	const normals = new Float32Array( numTriangles * 3 * 3 );
	const uvs = new Float32Array( numTriangles * 3 * 2 );
	const lmUvs = new Float32Array( numTriangles * 3 * 2 );

	// Use plane normal for flat shading (BSP surfaces are planar)
	const nx = planeNormal ? planeNormal[ 0 ] : 0;
	const ny = planeNormal ? planeNormal[ 1 ] : 0;
	const nz = planeNormal ? planeNormal[ 2 ] : 1;

	for ( let i = 0; i < numTriangles; i ++ ) {

		// triangle fan: vertex 0, i+2, i+1 (reversed winding for Three.js CCW front faces)
		const i0 = 0;
		const i1 = i + 2;
		const i2 = i + 1;

		// position (x, y, z)
		positions[ i * 9 + 0 ] = verts[ i0 * VERTEXSIZE + 0 ];
		positions[ i * 9 + 1 ] = verts[ i0 * VERTEXSIZE + 1 ];
		positions[ i * 9 + 2 ] = verts[ i0 * VERTEXSIZE + 2 ];

		positions[ i * 9 + 3 ] = verts[ i1 * VERTEXSIZE + 0 ];
		positions[ i * 9 + 4 ] = verts[ i1 * VERTEXSIZE + 1 ];
		positions[ i * 9 + 5 ] = verts[ i1 * VERTEXSIZE + 2 ];

		positions[ i * 9 + 6 ] = verts[ i2 * VERTEXSIZE + 0 ];
		positions[ i * 9 + 7 ] = verts[ i2 * VERTEXSIZE + 1 ];
		positions[ i * 9 + 8 ] = verts[ i2 * VERTEXSIZE + 2 ];

		// normals (same for all vertices - flat shading)
		normals[ i * 9 + 0 ] = nx;
		normals[ i * 9 + 1 ] = ny;
		normals[ i * 9 + 2 ] = nz;

		normals[ i * 9 + 3 ] = nx;
		normals[ i * 9 + 4 ] = ny;
		normals[ i * 9 + 5 ] = nz;

		normals[ i * 9 + 6 ] = nx;
		normals[ i * 9 + 7 ] = ny;
		normals[ i * 9 + 8 ] = nz;

		// texture UVs (s, t) at offsets 3, 4
		uvs[ i * 6 + 0 ] = verts[ i0 * VERTEXSIZE + 3 ];
		uvs[ i * 6 + 1 ] = verts[ i0 * VERTEXSIZE + 4 ];

		uvs[ i * 6 + 2 ] = verts[ i1 * VERTEXSIZE + 3 ];
		uvs[ i * 6 + 3 ] = verts[ i1 * VERTEXSIZE + 4 ];

		uvs[ i * 6 + 4 ] = verts[ i2 * VERTEXSIZE + 3 ];
		uvs[ i * 6 + 5 ] = verts[ i2 * VERTEXSIZE + 4 ];

		// lightmap UVs (ls, lt) at offsets 5, 6
		lmUvs[ i * 6 + 0 ] = verts[ i0 * VERTEXSIZE + 5 ];
		lmUvs[ i * 6 + 1 ] = verts[ i0 * VERTEXSIZE + 6 ];

		lmUvs[ i * 6 + 2 ] = verts[ i1 * VERTEXSIZE + 5 ];
		lmUvs[ i * 6 + 3 ] = verts[ i1 * VERTEXSIZE + 6 ];

		lmUvs[ i * 6 + 4 ] = verts[ i2 * VERTEXSIZE + 5 ];
		lmUvs[ i * 6 + 5 ] = verts[ i2 * VERTEXSIZE + 6 ];

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	geometry.setAttribute( 'uv1', new THREE.BufferAttribute( lmUvs, 2 ) );

	return geometry;

}

//============================================================================
// DrawGLWaterPoly
//
// Warp the vertex coordinates for water surfaces
//============================================================================

export function DrawGLWaterPoly( p ) {

	if ( ! p || p.numverts < 3 ) return null;

	const numverts = p.numverts;
	const verts = p.verts;
	const numTriangles = numverts - 2;
	const realtime = cl ? cl.time : 0;

	const positions = new Float32Array( numTriangles * 3 * 3 );
	const uvs = new Float32Array( numTriangles * 3 * 2 );

	// precompute warped positions
	const warped = new Float32Array( numverts * 3 );
	for ( let i = 0; i < numverts; i ++ ) {

		const vi = i * VERTEXSIZE;
		const x = verts[ vi + 0 ];
		const y = verts[ vi + 1 ];
		const z = verts[ vi + 2 ];

		warped[ i * 3 + 0 ] = x + 8 * Math.sin( y * 0.05 + realtime ) * Math.sin( z * 0.05 + realtime );
		warped[ i * 3 + 1 ] = y + 8 * Math.sin( x * 0.05 + realtime ) * Math.sin( z * 0.05 + realtime );
		warped[ i * 3 + 2 ] = z;

	}

	for ( let i = 0; i < numTriangles; i ++ ) {

		const i0 = 0;
		const i1 = i + 1;
		const i2 = i + 2;

		positions[ i * 9 + 0 ] = warped[ i0 * 3 + 0 ];
		positions[ i * 9 + 1 ] = warped[ i0 * 3 + 1 ];
		positions[ i * 9 + 2 ] = warped[ i0 * 3 + 2 ];

		positions[ i * 9 + 3 ] = warped[ i1 * 3 + 0 ];
		positions[ i * 9 + 4 ] = warped[ i1 * 3 + 1 ];
		positions[ i * 9 + 5 ] = warped[ i1 * 3 + 2 ];

		positions[ i * 9 + 6 ] = warped[ i2 * 3 + 0 ];
		positions[ i * 9 + 7 ] = warped[ i2 * 3 + 1 ];
		positions[ i * 9 + 8 ] = warped[ i2 * 3 + 2 ];

		uvs[ i * 6 + 0 ] = verts[ i0 * VERTEXSIZE + 3 ];
		uvs[ i * 6 + 1 ] = verts[ i0 * VERTEXSIZE + 4 ];

		uvs[ i * 6 + 2 ] = verts[ i1 * VERTEXSIZE + 3 ];
		uvs[ i * 6 + 3 ] = verts[ i1 * VERTEXSIZE + 4 ];

		uvs[ i * 6 + 4 ] = verts[ i2 * VERTEXSIZE + 3 ];
		uvs[ i * 6 + 5 ] = verts[ i2 * VERTEXSIZE + 4 ];

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	geometry.computeVertexNormals();

	return geometry;

}

//============================================================================
// EmitWaterPolysQuake
//
// Builds water geometry with warped UVs in Quake coordinate space.
// Unlike gl_warp.js version, keeps coordinates in Quake space to match
// the world geometry and camera setup.
//============================================================================

function EmitWaterPolysQuake( fa, realtime ) {

	// Use cached geometry on the surface to avoid per-frame allocation.
	// Positions are static; only UVs change each frame due to turbulence.
	let cached = fa._waterGeoCache;

	if ( ! cached ) {

		// First time: build positions, UVs, indices and cache them
		const posArr = [];
		const uvArr = [];
		const idxArr = [];
		let vertexCount = 0;

		for ( let p = fa.polys; p; p = p.next ) {

			const startVert = vertexCount;
			const numverts = p.numverts;

			for ( let i = 0; i < numverts; i ++ ) {

				let vx, vy, vz, os, ot;

				if ( p.verts instanceof Float32Array ) {

					const vi = i * VERTEXSIZE;
					vx = p.verts[ vi + 0 ];
					vy = p.verts[ vi + 1 ];
					vz = p.verts[ vi + 2 ];
					os = p.verts[ vi + 3 ];
					ot = p.verts[ vi + 4 ];

				} else {

					const v = p.verts[ i ];
					vx = v[ 0 ];
					vy = v[ 1 ];
					vz = v[ 2 ];
					os = v[ 3 ];
					ot = v[ 4 ];

				}

				posArr.push( vx, vy, vz );
				uvArr.push( os, ot ); // store original s/t for turbulence calc
				vertexCount ++;

			}

			for ( let i = 2; i < numverts; i ++ ) {

				idxArr.push( startVert, startVert + i - 1, startVert + i );

			}

		}

		if ( posArr.length === 0 )
			return null;

		const positions = new Float32Array( posArr );
		const uvs = new Float32Array( uvArr );
		const turbUvs = new Float32Array( uvArr.length );

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'uv', new THREE.BufferAttribute( turbUvs, 2 ) );
		geometry.setIndex( idxArr );
		geometry.computeVertexNormals();

		cached = { geometry, origUvs: uvs, turbUvs, vertexCount };
		fa._waterGeoCache = cached;

	}

	// Update turbulent UVs each frame
	const origUvs = cached.origUvs;
	const turbUvs = cached.turbUvs;
	const count = cached.vertexCount;

	for ( let i = 0; i < count; i ++ ) {

		const os = origUvs[ i * 2 ];
		const ot = origUvs[ i * 2 + 1 ];

		let s = os + turbsin[ ( ( ot * 0.125 + realtime ) * TURBSCALE | 0 ) & 255 ];
		s *= ( 1.0 / 64 );

		let t = ot + turbsin[ ( ( os * 0.125 + realtime ) * TURBSCALE | 0 ) & 255 ];
		t *= ( 1.0 / 64 );

		turbUvs[ i * 2 ] = s;
		turbUvs[ i * 2 + 1 ] = t;

	}

	cached.geometry.attributes.uv.needsUpdate = true;

	return cached.geometry;

}

//============================================================================
// EmitSkyPolysQuake
//
// Builds sky geometry in Quake coordinate space.
// layer: 0 = solid layer, 1 = alpha layer
//============================================================================

function EmitSkyPolysQuake( fa, speedscale, layer ) {

	// Sky positions are static per surface; UVs depend on camera origin and speedscale.
	// Cache the geometry and positions; update UVs in place each frame.

	// We use two caches per surface: _skyGeoCache (solid layer) and _skyGeoCache2 (alpha layer)
	const cacheKey = layer === 1 ? '_skyGeoCache2' : '_skyGeoCache';
	let cached = fa[ cacheKey ];

	if ( ! cached ) {

		// First time: build positions and indices
		const posArr = [];
		const idxArr = [];
		let vertexCount = 0;

		for ( let p = fa.polys; p; p = p.next ) {

			const startVert = vertexCount;
			const numverts = p.numverts;

			for ( let i = 0; i < numverts; i ++ ) {

				let vx, vy, vz;

				if ( p.verts instanceof Float32Array ) {

					const vi = i * VERTEXSIZE;
					vx = p.verts[ vi + 0 ];
					vy = p.verts[ vi + 1 ];
					vz = p.verts[ vi + 2 ];

				} else {

					const v = p.verts[ i ];
					vx = v[ 0 ];
					vy = v[ 1 ];
					vz = v[ 2 ];

				}

				posArr.push( vx, vy, vz );
				vertexCount ++;

			}

			for ( let i = 2; i < numverts; i ++ ) {

				idxArr.push( startVert, startVert + i - 1, startVert + i );

			}

		}

		if ( posArr.length === 0 )
			return null;

		const positions = new Float32Array( posArr );
		const uvs = new Float32Array( vertexCount * 2 );

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
		geometry.setIndex( idxArr );

		cached = { geometry, positions, uvs, vertexCount };
		fa[ cacheKey ] = cached;

	}

	// Update UVs based on current camera origin and speedscale
	const pos = cached.positions;
	const uvs = cached.uvs;
	const count = cached.vertexCount;

	for ( let i = 0; i < count; i ++ ) {

		const vx = pos[ i * 3 ];
		const vy = pos[ i * 3 + 1 ];
		const vz = pos[ i * 3 + 2 ];

		let dx = vx - r_origin[ 0 ];
		let dy = vy - r_origin[ 1 ];
		let dz = ( vz - r_origin[ 2 ] ) * 3; // flatten the sphere

		let length = Math.sqrt( dx * dx + dy * dy + dz * dz );
		length = 6 * 63 / length;

		uvs[ i * 2 ] = ( speedscale + dx * length ) * ( 1.0 / 128 );
		uvs[ i * 2 + 1 ] = ( speedscale + dy * length ) * ( 1.0 / 128 );

	}

	cached.geometry.attributes.uv.needsUpdate = true;

	return cached.geometry;

}

//============================================================================
// R_DrawSequentialPoly
//
// Systems that have fast state and texture changes can just do everything
// as it passes with no need to sort
//============================================================================

export function R_DrawSequentialPoly( s ) {

	//
	// normal lightmaped poly
	//
	if ( ! ( s.flags & ( SURF_DRAWSKY | SURF_DRAWTURB | SURF_UNDERWATER ) ) ) {

		R_RenderDynamicLightmaps( s );
		return;

	}

	//
	// subdivided water surface warp
	//
	if ( s.flags & SURF_DRAWTURB ) {

		const renderGroup = currentRenderGroup || worldGroup;
		if ( s.polys && renderGroup ) {

			const realtime = cl ? cl.time : 0;
			const geometry = EmitWaterPolysQuake( s, realtime );
			if ( geometry ) {

				const t = R_TextureAnimation( s.texinfo.texture );
				const material = _getWaterMaterial( t, 0.7 );
				_getWaterMesh( s, geometry, material, renderGroup );

			}

		}

		return;

	}

	//
	// subdivided sky warp
	//
	if ( s.flags & SURF_DRAWSKY ) {

		// Sky rendering -- skip for now (needs sky texture setup)
		return;

	}

	//
	// underwater warped with lightmap
	//
	R_RenderDynamicLightmaps( s );

}

//============================================================================
// R_RenderBrushPoly
//============================================================================

export function R_RenderBrushPoly( fa ) {

	let t;
	let maps;

	inc_c_brush_polys();

	if ( fa.flags & SURF_DRAWSKY ) {

		// warp texture, no lightmaps
		// EmitBothSkyLayers(fa) -- TODO
		return;

	}

	t = R_TextureAnimation( fa.texinfo.texture );

	if ( fa.flags & SURF_DRAWTURB ) {

		const renderGroup = currentRenderGroup || worldGroup;
		if ( fa.polys && renderGroup ) {

			const realtime = cl ? cl.time : 0;
			const geometry = EmitWaterPolysQuake( fa, realtime );
			if ( geometry ) {

				const material = _getWaterMaterial( t, 0.7 );
				_getWaterMesh( fa, geometry, material, renderGroup );

			}

		}

		return;

	}

	// add the poly to the proper lightmap chain
	if ( fa.polys ) {

		fa.polys.chain = lightmap_polys[ fa.lightmaptexturenum ];
		lightmap_polys[ fa.lightmaptexturenum ] = fa.polys;

	}

	// check for lightmap modification
	for ( maps = 0; maps < MAXLIGHTMAPS && fa.styles[ maps ] !== 255; maps ++ ) {

		if ( d_lightstylevalue[ fa.styles[ maps ] ] !== fa.cached_light[ maps ] ) {

			// dynamic -- need to rebuild lightmap
			if ( r_dynamic.value ) {

				lightmap_modified[ fa.lightmaptexturenum ] = true;
				const theRect = lightmap_rectchange[ fa.lightmaptexturenum ];
				if ( fa.light_t < theRect.t ) {

					if ( theRect.h )
						theRect.h += theRect.t - fa.light_t;
					theRect.t = fa.light_t;

				}

				if ( fa.light_s < theRect.l ) {

					if ( theRect.w )
						theRect.w += theRect.l - fa.light_s;
					theRect.l = fa.light_s;

				}

				const smax = ( fa.extents[ 0 ] >> 4 ) + 1;
				const tmax = ( fa.extents[ 1 ] >> 4 ) + 1;
				if ( ( theRect.w + theRect.l ) < ( fa.light_s + smax ) )
					theRect.w = ( fa.light_s - theRect.l ) + smax;
				if ( ( theRect.h + theRect.t ) < ( fa.light_t + tmax ) )
					theRect.h = ( fa.light_t - theRect.t ) + tmax;

				const baseOffset = fa.lightmaptexturenum * lightmap_bytes * BLOCK_WIDTH * BLOCK_HEIGHT;
				const offset = baseOffset + fa.light_t * BLOCK_WIDTH * lightmap_bytes + fa.light_s * lightmap_bytes;
				R_BuildLightMap( fa, lightmaps, offset, BLOCK_WIDTH * lightmap_bytes );

			}

			break;

		}

	}

	// Also check if dynamic this frame or dynamic previously
	if ( fa.dlightframe === r_framecount || fa.cached_dlight ) {

		if ( r_dynamic.value ) {

			lightmap_modified[ fa.lightmaptexturenum ] = true;
			const theRect = lightmap_rectchange[ fa.lightmaptexturenum ];
			if ( fa.light_t < theRect.t ) {

				if ( theRect.h )
					theRect.h += theRect.t - fa.light_t;
				theRect.t = fa.light_t;

			}

			if ( fa.light_s < theRect.l ) {

				if ( theRect.w )
					theRect.w += theRect.l - fa.light_s;
				theRect.l = fa.light_s;

			}

			const smax = ( fa.extents[ 0 ] >> 4 ) + 1;
			const tmax = ( fa.extents[ 1 ] >> 4 ) + 1;
			if ( ( theRect.w + theRect.l ) < ( fa.light_s + smax ) )
				theRect.w = ( fa.light_s - theRect.l ) + smax;
			if ( ( theRect.h + theRect.t ) < ( fa.light_t + tmax ) )
				theRect.h = ( fa.light_t - theRect.t ) + tmax;

			const baseOffset = fa.lightmaptexturenum * lightmap_bytes * BLOCK_WIDTH * BLOCK_HEIGHT;
			const offset = baseOffset + fa.light_t * BLOCK_WIDTH * lightmap_bytes + fa.light_s * lightmap_bytes;
			R_BuildLightMap( fa, lightmaps, offset, BLOCK_WIDTH * lightmap_bytes );

		}

	}

}

//============================================================================
// R_RenderDynamicLightmaps (multitexture path)
//============================================================================

export function R_RenderDynamicLightmaps( fa ) {

	let maps;

	inc_c_brush_polys();

	if ( fa.flags & ( SURF_DRAWSKY | SURF_DRAWTURB ) )
		return;

	if ( fa.polys ) {

		fa.polys.chain = lightmap_polys[ fa.lightmaptexturenum ];
		lightmap_polys[ fa.lightmaptexturenum ] = fa.polys;

	}

	// check for lightmap modification
	for ( maps = 0; maps < MAXLIGHTMAPS && fa.styles[ maps ] !== 255; maps ++ ) {

		if ( d_lightstylevalue[ fa.styles[ maps ] ] !== fa.cached_light[ maps ] ) {

			if ( r_dynamic.value ) {

				lightmap_modified[ fa.lightmaptexturenum ] = true;
				const theRect = lightmap_rectchange[ fa.lightmaptexturenum ];
				if ( fa.light_t < theRect.t ) {

					if ( theRect.h )
						theRect.h += theRect.t - fa.light_t;
					theRect.t = fa.light_t;

				}

				if ( fa.light_s < theRect.l ) {

					if ( theRect.w )
						theRect.w += theRect.l - fa.light_s;
					theRect.l = fa.light_s;

				}

				const smax = ( fa.extents[ 0 ] >> 4 ) + 1;
				const tmax = ( fa.extents[ 1 ] >> 4 ) + 1;
				if ( ( theRect.w + theRect.l ) < ( fa.light_s + smax ) )
					theRect.w = ( fa.light_s - theRect.l ) + smax;
				if ( ( theRect.h + theRect.t ) < ( fa.light_t + tmax ) )
					theRect.h = ( fa.light_t - theRect.t ) + tmax;

				const baseOffset = fa.lightmaptexturenum * lightmap_bytes * BLOCK_WIDTH * BLOCK_HEIGHT;
				const offset = baseOffset + fa.light_t * BLOCK_WIDTH * lightmap_bytes + fa.light_s * lightmap_bytes;
				R_BuildLightMap( fa, lightmaps, offset, BLOCK_WIDTH * lightmap_bytes );

			}

			break;

		}

	}

	if ( fa.dlightframe === r_framecount || fa.cached_dlight ) {

		if ( r_dynamic.value ) {

			lightmap_modified[ fa.lightmaptexturenum ] = true;
			const theRect = lightmap_rectchange[ fa.lightmaptexturenum ];
			if ( fa.light_t < theRect.t ) {

				if ( theRect.h )
					theRect.h += theRect.t - fa.light_t;
				theRect.t = fa.light_t;

			}

			if ( fa.light_s < theRect.l ) {

				if ( theRect.w )
					theRect.w += theRect.l - fa.light_s;
				theRect.l = fa.light_s;

			}

			const smax = ( fa.extents[ 0 ] >> 4 ) + 1;
			const tmax = ( fa.extents[ 1 ] >> 4 ) + 1;
			if ( ( theRect.w + theRect.l ) < ( fa.light_s + smax ) )
				theRect.w = ( fa.light_s - theRect.l ) + smax;
			if ( ( theRect.h + theRect.t ) < ( fa.light_t + tmax ) )
				theRect.h = ( fa.light_t - theRect.t ) + tmax;

			const baseOffset = fa.lightmaptexturenum * lightmap_bytes * BLOCK_WIDTH * BLOCK_HEIGHT;
			const offset = baseOffset + fa.light_t * BLOCK_WIDTH * lightmap_bytes + fa.light_s * lightmap_bytes;
			R_BuildLightMap( fa, lightmaps, offset, BLOCK_WIDTH * lightmap_bytes );

		}

	}

}

//============================================================================
// R_AddDynamicLights
//============================================================================

export function R_AddDynamicLights( surf ) {

	if ( ! cl_dlights ) return;

	const smax = ( surf.extents[ 0 ] >> 4 ) + 1;
	const tmax = ( surf.extents[ 1 ] >> 4 ) + 1;
	const tex = surf.texinfo;

	for ( let lnum = 0; lnum < 32 /* MAX_DLIGHTS */; lnum ++ ) {

		if ( ! ( surf.dlightbits & ( 1 << lnum ) ) )
			continue; // not lit by this light

		const dl = cl_dlights[ lnum ];
		let rad = dl.radius;
		let dist = DotProduct( dl.origin, surf.plane.normal ) - surf.plane.dist;
		rad -= Math.abs( dist );
		let minlight = dl.minlight;
		if ( rad < minlight )
			continue;
		minlight = rad - minlight;

		const impact = new Float32Array( 3 );
		for ( let i = 0; i < 3; i ++ ) {

			impact[ i ] = dl.origin[ i ] - surf.plane.normal[ i ] * dist;

		}

		const local = new Float32Array( 2 );
		local[ 0 ] = DotProduct( impact, tex.vecs[ 0 ] ) + tex.vecs[ 0 ][ 3 ];
		local[ 1 ] = DotProduct( impact, tex.vecs[ 1 ] ) + tex.vecs[ 1 ][ 3 ];

		local[ 0 ] -= surf.texturemins[ 0 ];
		local[ 1 ] -= surf.texturemins[ 1 ];

		for ( let t = 0; t < tmax; t ++ ) {

			let td = local[ 1 ] - t * 16;
			if ( td < 0 ) td = - td;

			for ( let s = 0; s < smax; s ++ ) {

				let sd = local[ 0 ] - s * 16;
				if ( sd < 0 ) sd = - sd;

				if ( sd > td )
					dist = sd + ( td >> 1 );
				else
					dist = td + ( sd >> 1 );

				if ( dist < minlight )
					blocklights[ t * smax + s ] += ( ( rad - dist ) * 256 ) | 0;

			}

		}

	}

}

//============================================================================
// R_BuildLightMap
//
// Combine and scale multiple lightmaps into the 8.8 format in blocklights
//============================================================================

export function R_BuildLightMap( surf, dest, destOffset, stride ) {

	const smax = ( surf.extents[ 0 ] >> 4 ) + 1;
	const tmax = ( surf.extents[ 1 ] >> 4 ) + 1;
	const size = smax * tmax;
	let lightmap = surf.samples;
	let lightmapOffset = surf.sampleOffset || 0;

	surf.cached_dlight = ( surf.dlightframe === r_framecount );

	// set to full bright if no light data
	if ( r_fullbright.value || ! lightmap ) {

		for ( let i = 0; i < size; i ++ )
			blocklights[ i ] = 255 * 256;

	} else {

		// clear to no light
		for ( let i = 0; i < size; i ++ )
			blocklights[ i ] = 0;

		// add all the lightmaps
		if ( lightmap ) {

			for ( let maps = 0; maps < MAXLIGHTMAPS && surf.styles[ maps ] !== 255; maps ++ ) {

				const scale = d_lightstylevalue[ surf.styles[ maps ] ];
				surf.cached_light[ maps ] = scale; // 8.8 fraction
				for ( let i = 0; i < size; i ++ )
					blocklights[ i ] += lightmap[ lightmapOffset + i ] * scale;
				lightmapOffset += size; // skip to next lightmap

			}

		}

		// add all the dynamic lights
		if ( surf.dlightframe === r_framecount )
			R_AddDynamicLights( surf );

	}

	// bound, invert, and shift
	// store as luminance (single byte per texel)
	stride -= smax;
	let bl = 0; // index into blocklights
	let di = destOffset;

	for ( let i = 0; i < tmax; i ++, di += stride ) {

		for ( let j = 0; j < smax; j ++ ) {

			let t = blocklights[ bl ++ ];
			t >>= 7;
			if ( t > 255 ) t = 255;
			dest[ di ] = 255 - t;
			di ++;

		}

	}

}

//============================================================================
// R_DrawBrushModel
//============================================================================

// Euler object reused for brush entity rotation (avoid per-frame allocation)
const _brushEuler = new THREE.Euler( 0, 0, 0, 'ZYX' );

export function R_DrawBrushModel( e ) {

	// Use pre-allocated scratch arrays to avoid per-call allocations
	const mins = _brushMins;
	const maxs = _brushMaxs;
	let rotated;

	const clmodel = e.model;
	if ( ! clmodel ) return;

	if ( e.angles[ 0 ] || e.angles[ 1 ] || e.angles[ 2 ] ) {

		rotated = true;
		for ( let i = 0; i < 3; i ++ ) {

			mins[ i ] = e.origin[ i ] - clmodel.radius;
			maxs[ i ] = e.origin[ i ] + clmodel.radius;

		}

	} else {

		rotated = false;
		VectorAdd( e.origin, clmodel.mins, mins );
		VectorAdd( e.origin, clmodel.maxs, maxs );

	}

	if ( R_CullBox( mins, maxs ) )
		return;

	// Check if we have a cached brush group for this entity
	// Invalidate cache if entity.frame changed (for texture animation, e.g. buttons)
	let brushGroup = e._brushGroup;
	if ( brushGroup && e._brushGroupFrame !== e.frame ) {

		// Frame changed - dispose old group and rebuild
		_allBrushEntityGroups.delete( brushGroup );
		if ( brushGroup.parent ) brushGroup.parent.remove( brushGroup );
		for ( const child of brushGroup.children ) {

			if ( child.geometry ) child.geometry.dispose();
			// Don't dispose materials - they're cached in _brushMaterialCache

		}
		brushGroup = null;
		e._brushGroup = null;

	}

	if ( ! brushGroup ) {

		// First time drawing this entity - build and cache the group
		brushGroup = new THREE.Group();

		// Build meshes for all non-sky/water surfaces
		if ( clmodel.surfaces && clmodel.nummodelsurfaces ) {

			const startSurf = clmodel.firstmodelsurface;
			for ( let i = 0; i < clmodel.nummodelsurfaces; i ++ ) {

				const psurf = clmodel.surfaces[ startSurf + i ];
				if ( ! psurf ) continue;
				if ( psurf.flags & ( SURF_DRAWSKY | SURF_DRAWTURB ) ) continue;
				if ( ! psurf.polys ) continue;

				// Get plane normal, flip if SURF_PLANEBACK
				let planeNormal = null;
				if ( psurf.plane ) {

					const pn = psurf.plane.normal;
					if ( psurf.flags & SURF_PLANEBACK ) {

						// Create a new array for the cached geometry (not scratch)
						planeNormal = new Float32Array( [ - pn[ 0 ], - pn[ 1 ], - pn[ 2 ] ] );

					} else {

						planeNormal = pn;

					}

				}

				const geom = DrawGLPoly( psurf.polys, planeNormal );
				if ( ! geom ) continue;

				const t = R_TextureAnimation( psurf.texinfo.texture );
				const diffuse = ( t && t.gl_texture ) ? t.gl_texture : null;
				const lmTex = lightmapTextures[ psurf.lightmaptexturenum ];

				// Use cached material to avoid shader recompilation
				const diffuseId = diffuse ? diffuse.id : 0;
				const lmId = lmTex ? lmTex.id : 0;
				const matKey = `${diffuseId}_${lmId}`;
				let material = _brushMaterialCache.get( matKey );
				if ( ! material ) {

					material = ( diffuse && lmTex )
						? createQuakeLightmapMaterial( diffuse, lmTex )
						: new THREE.MeshBasicMaterial( { map: diffuse } );
					_brushMaterialCache.set( matKey, material );

				}

				const mesh = new THREE.Mesh( geom, material );
				brushGroup.add( mesh );

			}

		}

		// Cache on entity and track for disposal on map change
		e._brushGroup = brushGroup;
		e._brushGroupFrame = e.frame; // Track frame for texture animation invalidation
		_allBrushEntityGroups.add( brushGroup );

	}

	// Update transform (position/rotation may change each frame for doors, etc.)
	brushGroup.position.set( e.origin[ 0 ], e.origin[ 1 ], e.origin[ 2 ] );

	if ( rotated ) {

		// "stupid quake bug" — negate pitch before R_RotateForEntity
		const pitch = - e.angles[ 0 ];
		const yaw = e.angles[ 1 ];
		const roll = e.angles[ 2 ];

		_brushEuler.set(
			roll * ( Math.PI / 180 ),
			- pitch * ( Math.PI / 180 ),
			yaw * ( Math.PI / 180 )
		);
		brushGroup.quaternion.setFromEuler( _brushEuler );

	} else {

		brushGroup.quaternion.identity();

	}

	// Add to world container for VR coordinate system support
	const worldContainer = VID_GetWorldContainer();
	if ( worldContainer && ! brushGroup.parent ) {

		worldContainer.add( brushGroup );

	} else if ( scene && ! brushGroup.parent ) {

		scene.add( brushGroup );

	}

	brushEntityGroups.push( brushGroup );

}

//============================================================================
// R_RecursiveWorldNode
//============================================================================

export function R_RecursiveWorldNode( node ) {

	if ( ! node ) return;

	if ( node.contents === - 2 ) // CONTENTS_SOLID
		return;

	if ( node.visframe !== r_visframecount )
		return;

	// Use pre-allocated scratch array for maxs to avoid per-call allocation
	_cullBoxMaxs[ 0 ] = node.minmaxs[ 3 ];
	_cullBoxMaxs[ 1 ] = node.minmaxs[ 4 ];
	_cullBoxMaxs[ 2 ] = node.minmaxs[ 5 ];
	if ( R_CullBox( node.minmaxs, _cullBoxMaxs ) )
		return;

	// if a leaf node, draw stuff
	if ( node.contents < 0 ) {

		const pleaf = node; // mleaf_t is a subtype of mnode_t

		if ( pleaf.firstmarksurface && pleaf.nummarksurfaces ) {

			for ( let c = 0; c < pleaf.nummarksurfaces; c ++ ) {

				pleaf.firstmarksurface[ c ].visframe = r_framecount;

			}

		}

		// deal with model fragments in this leaf
		// if (pleaf.efrags) R_StoreEfrags(&pleaf.efrags);

		return;

	}

	// node is just a decision point, so go down the appropriate sides

	// find which side of the node we are on
	const plane = node.plane;
	let dot;

	switch ( plane.type ) {

		case PLANE_X:
			dot = modelorg[ 0 ] - plane.dist;
			break;
		case PLANE_Y:
			dot = modelorg[ 1 ] - plane.dist;
			break;
		case PLANE_Z:
			dot = modelorg[ 2 ] - plane.dist;
			break;
		default:
			dot = DotProduct( modelorg, plane.normal ) - plane.dist;
			break;

	}

	const side = dot >= 0 ? 0 : 1;

	// recurse down the children, front side first
	R_RecursiveWorldNode( node.children[ side ] );

	// draw stuff
	const c = node.numsurfaces;

	if ( c ) {

		const cl_ref = cl;
		const worldmodel = cl_ref ? cl_ref.worldmodel : null;

		if ( worldmodel && worldmodel.surfaces ) {

			// Only render surfaces within the world model's surface range.
			// Submodel surfaces (triggers, doors, etc.) share the global
			// surfaces array but must not be drawn during world traversal.
			const worldSurfEnd = worldmodel.firstmodelsurface + worldmodel.nummodelsurfaces;

			for ( let ci = 0; ci < c; ci ++ ) {

				const surfIdx = node.firstsurface + ci;
				if ( surfIdx < worldmodel.firstmodelsurface || surfIdx >= worldSurfEnd )
					continue;

				const surf = worldmodel.surfaces[ surfIdx ];
				if ( ! surf ) continue;

				if ( surf.visframe !== r_framecount )
					continue;

				// don't backface underwater surfaces, because they warp
				if ( ! ( surf.flags & SURF_UNDERWATER ) &&
					( ( dot < 0 ) ^ ! ! ( surf.flags & SURF_PLANEBACK ) ) )
					continue; // wrong side

				// if sorting by texture, just store it out
				if ( gl_texsort.value ) {

					if ( ! mirror ||
						surf.texinfo.texture !== worldmodel.textures[ mirrortexturenum ] ) {

						surf.texturechain = surf.texinfo.texture.texturechain;
						surf.texinfo.texture.texturechain = surf;

					}

				} else if ( surf.flags & SURF_DRAWSKY ) {

					surf.texturechain = skychain;
					skychain = surf;

				} else if ( surf.flags & SURF_DRAWTURB ) {

					surf.texturechain = waterchain;
					waterchain = surf;

				} else {

					R_DrawSequentialPoly( surf );

				}

			}

		}

	}

	// recurse down the back side
	R_RecursiveWorldNode( node.children[ side ? 0 : 1 ] );

}

//============================================================================
// R_DrawWorld
//============================================================================

export function R_DrawWorld() {

	const cl_ref = cl;
	if ( ! cl_ref || ! cl_ref.worldmodel ) return;

	VectorCopy( r_refdef.vieworg, modelorg );

	set_currenttexture( - 1 );

	// clear lightmap polys
	for ( let i = 0; i < MAX_LIGHTMAPS; i ++ )
		lightmap_polys[ i ] = null;

	// create world group if needed
	if ( ! worldGroup ) {

		worldGroup = new THREE.Group();
		worldGroup.name = 'quake_world';
		// Add to world container for VR coordinate system support
		const worldContainer = VID_GetWorldContainer();
		if ( worldContainer ) {

			worldContainer.add( worldGroup );

		} else if ( scene ) {

			scene.add( worldGroup );

		}

	}

	// Begin new water/sky frame: clear "this frame" set
	_waterMeshesThisFrame = new Set();

	// Remove brush entity groups from scene (don't dispose - they're cached on entities)
	for ( let i = 0; i < brushEntityGroups.length; i ++ ) {

		const group = brushEntityGroups[ i ];
		if ( group.parent ) group.parent.remove( group );

	}

	brushEntityGroups.length = 0;

	// Set currentRenderGroup to worldGroup for world surface rendering
	currentRenderGroup = worldGroup;

	R_RecursiveWorldNode( cl_ref.worldmodel.nodes[ 0 ] );

	// Update mesh visibility based on PVS (leaf visframe set by R_MarkLeaves)
	R_UpdateWorldVisibility();

	DrawTextureChains();

	R_BlendLightmaps();

}

/*
================
R_CleanupWaterMeshes

Remove water/sky meshes that were in the scene last frame but not rendered
this frame. Called from R_RenderView after all water rendering is done.
================
*/
export function R_CleanupWaterMeshes() {

	for ( const mesh of _waterMeshesInScene ) {

		if ( ! _waterMeshesThisFrame.has( mesh ) ) {

			if ( mesh.parent ) mesh.parent.remove( mesh );
			_waterMeshesInScene.delete( mesh );

		}

	}

}

//============================================================================
// DrawTextureChains
//============================================================================

export function DrawTextureChains() {

	const cl_ref = cl;
	if ( ! cl_ref || ! cl_ref.worldmodel ) return;

	if ( ! gl_texsort.value ) {

		if ( skychain ) {

			R_DrawSkyChain( skychain );
			skychain = null;

		}

		return;

	}

	const worldmodel = cl_ref.worldmodel;
	for ( let i = 0; i < worldmodel.numtextures; i ++ ) {

		const t = worldmodel.textures[ i ];
		if ( ! t ) continue;

		let s = t.texturechain;
		if ( ! s ) continue;

		if ( i === skytexturenum ) {

			R_DrawSkyChain( s );

		} else if ( i === mirrortexturenum && r_mirroralpha.value !== 1.0 ) {

			R_MirrorChain( s );
			continue;

		} else {

			if ( ( s.flags & SURF_DRAWTURB ) && r_wateralpha.value !== 1.0 )
				continue; // draw translucent water later

			for ( ; s; s = s.texturechain )
				R_RenderBrushPoly( s );

		}

		t.texturechain = null;

	}

}

//============================================================================
// R_BlendLightmaps
//============================================================================

export function R_BlendLightmaps() {

	if ( r_fullbright.value )
		return;
	if ( ! gl_texsort.value )
		return;

	// In Three.js, lightmaps are applied as texture maps on materials
	// rather than blended separately. This function handles the
	// lightmap texture updates.

	for ( let i = 0; i < MAX_LIGHTMAPS; i ++ ) {

		const p = lightmap_polys[ i ];
		if ( ! p ) continue;

		if ( lightmap_modified[ i ] ) {

			lightmap_modified[ i ] = false;
			const theRect = lightmap_rectchange[ i ];

			// Upload changed lightmap data to the THREE.DataTexture
			const tex = lightmapTextures[ i ];
			if ( tex && tex.image && tex.image.data ) {

				const srcOffset = i * BLOCK_WIDTH * BLOCK_HEIGHT * lightmap_bytes;
				const dstData = tex.image.data;
				const pixelCount = BLOCK_WIDTH * BLOCK_HEIGHT;

				for ( let p = 0; p < pixelCount; p ++ ) {

					const val = 255 - lightmaps[ srcOffset + p ];
					dstData[ p * 4 ] = val;
					dstData[ p * 4 + 1 ] = val;
					dstData[ p * 4 + 2 ] = val;
					dstData[ p * 4 + 3 ] = 255;

				}

				tex.needsUpdate = true;

			}

			theRect.l = BLOCK_WIDTH;
			theRect.t = BLOCK_HEIGHT;
			theRect.h = 0;
			theRect.w = 0;

		}

		// Lightmap polys are blended via material in Three.js path
		// No need for explicit GL blend state

	}

}

//============================================================================
// R_DrawWaterSurfaces
//============================================================================

export function R_DrawWaterSurfaces() {

	const cl_ref = cl;

	if ( r_wateralpha.value === 1.0 && gl_texsort.value )
		return;

	if ( ! gl_texsort.value ) {

		if ( ! waterchain )
			return;

		for ( let s = waterchain; s; s = s.texturechain ) {

			if ( s.polys && worldGroup ) {

				const realtime = cl ? cl.time : 0;
				const geometry = EmitWaterPolysQuake( s, realtime );
				if ( geometry ) {

					const wt = R_TextureAnimation( s.texinfo.texture );
					const material = _getWaterMaterial( wt, r_wateralpha.value );
					_getWaterMesh( s, geometry, material, worldGroup );

				}

			}

		}

		waterchain = null;

	} else {

		if ( ! cl_ref || ! cl_ref.worldmodel ) return;

		for ( let i = 0; i < cl_ref.worldmodel.numtextures; i ++ ) {

			const t = cl_ref.worldmodel.textures[ i ];
			if ( ! t ) continue;

			let s = t.texturechain;
			if ( ! s ) continue;

			if ( ! ( s.flags & SURF_DRAWTURB ) )
				continue;

			for ( ; s; s = s.texturechain ) {

				if ( s.polys && worldGroup ) {

					const realtime = cl ? cl.time : 0;
					const geometry = EmitWaterPolysQuake( s, realtime );
					if ( geometry ) {

						const wt = R_TextureAnimation( s.texinfo.texture );
						const material = _getWaterMaterial( wt, r_wateralpha.value );
						_getWaterMesh( s, geometry, material, worldGroup );

					}

				}

			}

			t.texturechain = null;

		}

	}

}

//============================================================================
// R_MarkLeaves
//============================================================================

export function R_MarkLeaves() {

	const cl_ref = cl;
	if ( ! cl_ref || ! cl_ref.worldmodel ) return;

	if ( r_oldviewleaf === r_viewleaf && ! r_novis.value )
		return;

	if ( mirror )
		return;

	inc_r_visframecount();
	set_r_oldviewleaf( r_viewleaf );

	let vis;
	if ( r_novis.value || r_viewleaf == null ) {

		// mark everything visible (also when r_viewleaf is null - player outside map)
		const numBytes = ( cl_ref.worldmodel.numleafs + 7 ) >> 3;
		vis = new Uint8Array( numBytes );
		vis.fill( 0xff );

	} else {

		vis = Mod_LeafPVS( r_viewleaf, cl_ref.worldmodel );

	}

	if ( ! vis ) return;

	for ( let i = 0; i < cl_ref.worldmodel.numleafs; i ++ ) {

		if ( vis[ i >> 3 ] & ( 1 << ( i & 7 ) ) ) {

			let node = cl_ref.worldmodel.leafs[ i + 1 ];
			if ( ! node ) continue;

			while ( node ) {

				if ( node.visframe === r_visframecount )
					break;
				node.visframe = r_visframecount;
				node = node.parent;

			}

		}

	}

}

//============================================================================
// R_MirrorChain
//============================================================================

function R_MirrorChain( s ) {

	if ( mirror )
		return;

	set_mirror( true );
	set_mirror_plane( s.plane );

}

//============================================================================
// R_DrawSkyChain
//============================================================================

let solidSkyMaterial = null;
let alphaSkyMaterial = null;

function R_DrawSkyChain( s ) {

	if ( ! worldGroup ) return;

	// Create or update sky materials from the sky textures
	if ( solidskytexture && ! solidSkyMaterial ) {

		solidSkyMaterial = new THREE.MeshBasicMaterial( {
			map: solidskytexture,
			side: THREE.DoubleSide
		} );

	}

	if ( alphaskytexture && ! alphaSkyMaterial ) {

		alphaSkyMaterial = new THREE.MeshBasicMaterial( {
			map: alphaskytexture,
			side: THREE.DoubleSide,
			transparent: true,
			alphaTest: 0.05
		} );

	}

	// Fallback if sky textures not loaded
	if ( ! solidSkyMaterial ) {

		solidSkyMaterial = new THREE.MeshBasicMaterial( {
			color: 0x3366aa,
			side: THREE.DoubleSide
		} );

	}

	// Solid sky layer (background, speed = realtime*8)
	let solidSpeed = realtime * 8;
	solidSpeed -= ( solidSpeed | 0 ) & ~127;

	for ( let fa = s; fa; fa = fa.texturechain ) {

		if ( ! fa.polys ) continue;

		const geometry = EmitSkyPolysQuake( fa, solidSpeed, 0 );
		if ( geometry ) {

			// Cache sky mesh on surface, keyed by layer
			let mesh = fa._skyMesh;
			if ( ! mesh ) {

				mesh = new THREE.Mesh( geometry, solidSkyMaterial );
				fa._skyMesh = mesh;

			} else {

				if ( mesh.geometry !== geometry ) mesh.geometry = geometry;
				mesh.material = solidSkyMaterial;

			}

			if ( mesh.parent !== worldGroup ) {

				if ( mesh.parent ) mesh.parent.remove( mesh );
				worldGroup.add( mesh );

			}

			_waterMeshesThisFrame.add( mesh );
			_waterMeshesInScene.add( mesh );

		}

	}

	// Alpha sky layer (overlay, speed = realtime*16)
	if ( alphaSkyMaterial ) {

		let alphaSpeed = realtime * 16;
		alphaSpeed -= ( alphaSpeed | 0 ) & ~127;

		for ( let fa = s; fa; fa = fa.texturechain ) {

			if ( ! fa.polys ) continue;

			const geometry = EmitSkyPolysQuake( fa, alphaSpeed, 1 );
			if ( geometry ) {

				let mesh = fa._skyMesh2;
				if ( ! mesh ) {

					mesh = new THREE.Mesh( geometry, alphaSkyMaterial );
					fa._skyMesh2 = mesh;

				} else {

					if ( mesh.geometry !== geometry ) mesh.geometry = geometry;
					mesh.material = alphaSkyMaterial;

				}

				if ( mesh.parent !== worldGroup ) {

					if ( mesh.parent ) mesh.parent.remove( mesh );
					worldGroup.add( mesh );

				}

				_waterMeshesThisFrame.add( mesh );
				_waterMeshesInScene.add( mesh );

			}

		}

	}

}

//============================================================================
// AllocBlock
//
// Returns a texture number and the position inside it
//============================================================================

export function AllocBlock( w, h, outX, outY ) {

	for ( let texnum = 0; texnum < MAX_LIGHTMAPS; texnum ++ ) {

		let best = BLOCK_HEIGHT;

		for ( let i = 0; i < BLOCK_WIDTH - w; i ++ ) {

			let best2 = 0;
			let j;

			for ( j = 0; j < w; j ++ ) {

				if ( allocated[ texnum ][ i + j ] >= best )
					break;
				if ( allocated[ texnum ][ i + j ] > best2 )
					best2 = allocated[ texnum ][ i + j ];

			}

			if ( j === w ) {

				// this is a valid spot
				outX.value = i;
				outY.value = best = best2;

			}

		}

		if ( best + h > BLOCK_HEIGHT )
			continue;

		for ( let i = 0; i < w; i ++ )
			allocated[ texnum ][ outX.value + i ] = best + h;

		return texnum;

	}

	Sys_Error( 'AllocBlock: full' );

}

//============================================================================
// BuildSurfaceDisplayList
//
// Reconstructs polygon from BSP edges and computes texture coordinates.
// In Three.js, we build BufferGeometry instead of glpoly_t display lists.
//============================================================================

export function BuildSurfaceDisplayList( fa ) {

	if ( ! currentmodel ) return;

	const pedges = currentmodel.edges;
	const lnumverts = fa.numedges;

	// create glpoly_t equivalent
	const poly = {
		next: fa.polys,
		flags: fa.flags,
		numverts: lnumverts,
		verts: new Float32Array( lnumverts * VERTEXSIZE ),
		chain: null
	};

	fa.polys = poly;

	for ( let i = 0; i < lnumverts; i ++ ) {

		const lindex = currentmodel.surfedges[ fa.firstedge + i ];
		let vec;

		if ( lindex > 0 ) {

			const r_pedge = pedges[ lindex ];
			vec = r_pcurrentvertbase[ r_pedge.v[ 0 ] ].position;

		} else {

			const r_pedge = pedges[ - lindex ];
			vec = r_pcurrentvertbase[ r_pedge.v[ 1 ] ].position;

		}

		// texture coordinates
		let s = DotProduct( vec, fa.texinfo.vecs[ 0 ] ) + fa.texinfo.vecs[ 0 ][ 3 ];
		s /= fa.texinfo.texture.width;

		let t = DotProduct( vec, fa.texinfo.vecs[ 1 ] ) + fa.texinfo.vecs[ 1 ][ 3 ];
		t /= fa.texinfo.texture.height;

		const vi = i * VERTEXSIZE;
		poly.verts[ vi + 0 ] = vec[ 0 ];
		poly.verts[ vi + 1 ] = vec[ 1 ];
		poly.verts[ vi + 2 ] = vec[ 2 ];
		poly.verts[ vi + 3 ] = s;
		poly.verts[ vi + 4 ] = t;

		// lightmap texture coordinates
		s = DotProduct( vec, fa.texinfo.vecs[ 0 ] ) + fa.texinfo.vecs[ 0 ][ 3 ];
		s -= fa.texturemins[ 0 ];
		s += fa.light_s * 16;
		s += 8;
		s /= BLOCK_WIDTH * 16;

		t = DotProduct( vec, fa.texinfo.vecs[ 1 ] ) + fa.texinfo.vecs[ 1 ][ 3 ];
		t -= fa.texturemins[ 1 ];
		t += fa.light_t * 16;
		t += 8;
		t /= BLOCK_HEIGHT * 16;

		poly.verts[ vi + 5 ] = s;
		poly.verts[ vi + 6 ] = t;

	}

	// remove co-linear points
	if ( ! gl_keeptjunctions.value && ! ( fa.flags & SURF_UNDERWATER ) ) {

		let numverts = poly.numverts;
		for ( let i = 0; i < numverts; i ++ ) {

			const prevIdx = ( ( i + numverts - 1 ) % numverts ) * VERTEXSIZE;
			const thisIdx = i * VERTEXSIZE;
			const nextIdx = ( ( i + 1 ) % numverts ) * VERTEXSIZE;

			const v1 = new Float32Array( 3 );
			const v2 = new Float32Array( 3 );

			v1[ 0 ] = poly.verts[ thisIdx + 0 ] - poly.verts[ prevIdx + 0 ];
			v1[ 1 ] = poly.verts[ thisIdx + 1 ] - poly.verts[ prevIdx + 1 ];
			v1[ 2 ] = poly.verts[ thisIdx + 2 ] - poly.verts[ prevIdx + 2 ];
			VectorNormalize( v1 );

			v2[ 0 ] = poly.verts[ nextIdx + 0 ] - poly.verts[ prevIdx + 0 ];
			v2[ 1 ] = poly.verts[ nextIdx + 1 ] - poly.verts[ prevIdx + 1 ];
			v2[ 2 ] = poly.verts[ nextIdx + 2 ] - poly.verts[ prevIdx + 2 ];
			VectorNormalize( v2 );

			const COLINEAR_EPSILON = 0.001;
			if ( ( Math.abs( v1[ 0 ] - v2[ 0 ] ) <= COLINEAR_EPSILON ) &&
				( Math.abs( v1[ 1 ] - v2[ 1 ] ) <= COLINEAR_EPSILON ) &&
				( Math.abs( v1[ 2 ] - v2[ 2 ] ) <= COLINEAR_EPSILON ) ) {

				// remove this vertex by shifting subsequent vertices
				for ( let j = i + 1; j < numverts; j ++ ) {

					for ( let k = 0; k < VERTEXSIZE; k ++ )
						poly.verts[ ( j - 1 ) * VERTEXSIZE + k ] = poly.verts[ j * VERTEXSIZE + k ];

				}

				numverts --;
				nColinElim ++;
				i --;

			}

		}

		poly.numverts = numverts;

	}

}

//============================================================================
// GL_CreateSurfaceLightmap
//============================================================================

export function GL_CreateSurfaceLightmap( surf ) {

	if ( surf.flags & ( SURF_DRAWSKY | SURF_DRAWTURB ) )
		return;

	const smax = ( surf.extents[ 0 ] >> 4 ) + 1;
	const tmax = ( surf.extents[ 1 ] >> 4 ) + 1;

	const outX = { value: 0 };
	const outY = { value: 0 };
	surf.lightmaptexturenum = AllocBlock( smax, tmax, outX, outY );
	surf.light_s = outX.value;
	surf.light_t = outY.value;

	const baseOffset = surf.lightmaptexturenum * lightmap_bytes * BLOCK_WIDTH * BLOCK_HEIGHT;
	const offset = baseOffset + ( surf.light_t * BLOCK_WIDTH + surf.light_s ) * lightmap_bytes;
	R_BuildLightMap( surf, lightmaps, offset, BLOCK_WIDTH * lightmap_bytes );

}

//============================================================================
// GL_BuildLightmaps
//
// Builds the lightmap texture with all the surfaces from all brush models.
// In Three.js, we create THREE.DataTexture objects for each lightmap atlas.
//============================================================================

export const lightmapTextures = []; // THREE.DataTexture array

//============================================================================
// concatFloat32Arrays
//
// Concatenate an array of Float32Array into a single Float32Array.
//============================================================================

function concatFloat32Arrays( arrays ) {

	let totalLen = 0;
	for ( const a of arrays ) totalLen += a.length;
	const result = new Float32Array( totalLen );
	let offset = 0;
	for ( const a of arrays ) {

		result.set( a, offset );
		offset += a.length;

	}

	return result;

}

//============================================================================
// R_BuildWorldMeshes
//
// Builds world geometry using BatchedMesh for efficient PVS culling.
// One BatchedMesh per (texture, lightmap) combo, with each leaf's geometry
// added as a separate instance. Visibility is toggled via setVisibleAt().
//============================================================================

function R_BuildWorldMeshes() {

	const cl_ref = cl;
	if ( ! cl_ref || ! cl_ref.worldmodel ) return;

	if ( ! worldGroup ) {

		worldGroup = new THREE.Group();
		worldGroup.name = 'quake_world';
		// Add to world container for VR coordinate system support
		const worldContainer = VID_GetWorldContainer();
		if ( worldContainer ) {

			worldContainer.add( worldGroup );

		} else if ( scene ) {

			scene.add( worldGroup );

		}

	}

	const worldmodel = cl_ref.worldmodel;

	// Clear previous batch data
	instanceVisInfo.length = 0;
	worldBatchedMeshes.length = 0;

	// Build a mapping from surface to ALL leaves that contain it.
	// A surface is visible if ANY of its containing leaves is visible (PVS).
	const surfaceToLeaves = new Map();

	for ( let leafIdx = 1; leafIdx <= worldmodel.numleafs; leafIdx ++ ) {

		const leaf = worldmodel.leafs[ leafIdx ];
		if ( ! leaf ) continue;
		if ( leaf.contents === - 2 ) continue; // CONTENTS_SOLID

		if ( leaf.firstmarksurface && leaf.nummarksurfaces > 0 ) {

			for ( let j = 0; j < leaf.nummarksurfaces; j ++ ) {

				const surf = leaf.firstmarksurface[ j ];
				if ( ! surf ) continue;

				if ( ! surfaceToLeaves.has( surf ) ) {

					surfaceToLeaves.set( surf, [] );

				}

				surfaceToLeaves.get( surf ).push( leaf );

			}

		}

	}

	// First pass: collect geometry data per (texture, lightmap)
	// Each surface stores its geometry and ALL leaves that contain it
	// Structure: batchGroups: Map<texKey, { texture, lmNum, totalVerts, totalGeoms, surfaceData: Array<{geom, leaves}> }>
	const batchGroups = new Map();

	const surfStart = worldmodel.firstmodelsurface || 0;
	const surfEnd = surfStart + ( worldmodel.nummodelsurfaces || worldmodel.numsurfaces );

	for ( let k = surfStart; k < surfEnd; k ++ ) {

		const surf = worldmodel.surfaces[ k ];
		if ( ! surf ) continue;
		if ( surf.flags & ( SURF_DRAWSKY | SURF_DRAWTURB ) ) continue;
		if ( ! surf.polys ) continue;
		if ( ! surf.texinfo || ! surf.texinfo.texture ) continue;

		const t = surf.texinfo.texture;
		if ( ! t.gl_texture ) continue;

		// Get all leaves that contain this surface
		const leaves = surfaceToLeaves.get( surf );
		if ( ! leaves || leaves.length === 0 ) continue;

		// Get plane normal, flip if SURF_PLANEBACK (surface faces opposite of plane)
		let planeNormal = null;
		if ( surf.plane ) {

			const pn = surf.plane.normal;
			if ( surf.flags & SURF_PLANEBACK ) {

				planeNormal = new Float32Array( [ - pn[ 0 ], - pn[ 1 ], - pn[ 2 ] ] );

			} else {

				planeNormal = pn;

			}

		}

		const geom = DrawGLPoly( surf.polys, planeNormal );
		if ( ! geom ) continue;

		const lmNum = surf.lightmaptexturenum;
		const texKey = ( t._buildId || ( t._buildId = Math.random() ) ) + '_' + lmNum;

		if ( ! batchGroups.has( texKey ) ) {

			batchGroups.set( texKey, {
				texture: t,
				lmNum: lmNum,
				totalVerts: 0,
				totalGeoms: 0,
				surfaceData: []
			} );

		}

		const group = batchGroups.get( texKey );
		const vertCount = geom.getAttribute( 'position' ).count;

		group.totalVerts += vertCount;
		group.totalGeoms ++;
		group.surfaceData.push( { geom: geom, leaves: leaves } );

	}

	// Identity matrix for all geometries (already in world space)
	const identityMatrix = new THREE.Matrix4();

	// Second pass: create BatchedMesh for each (texture, lightmap) group
	for ( const [ texKey, group ] of batchGroups ) {

		const t = group.texture;
		const animTex = R_TextureAnimation( t );
		const diffuse = ( animTex && animTex.gl_texture ) ? animTex.gl_texture : t.gl_texture;
		const lmTex = lightmapTextures[ group.lmNum ];
		const material = lmTex
			? createQuakeLightmapMaterial( diffuse, lmTex )
			: new THREE.MeshBasicMaterial( { map: diffuse } );

		// Create BatchedMesh with capacity for all geometries in this group
		const batchedMesh = new THREE.BatchedMesh(
			group.totalGeoms,
			group.totalVerts,
			0, // no indices (non-indexed geometry)
			material
		);

		// Name for debugging (texture name + lightmap number)
		const texName = t.name || '';
		batchedMesh.name = `world_${texName}_lm${group.lmNum}`;

		// Add each surface's geometry to the batch
		for ( const surfData of group.surfaceData ) {

			// Add geometry, then create an instance of it
			const geoId = batchedMesh.addGeometry( surfData.geom );
			const instanceId = batchedMesh.addInstance( geoId );
			batchedMesh.setMatrixAt( instanceId, identityMatrix );

			// Store instance with ALL its leaves for visibility updates
			// Surface is visible if ANY of its leaves is visible
			instanceVisInfo.push( {
				batch: batchedMesh,
				instanceId: instanceId,
				leaves: surfData.leaves
			} );

			// Dispose the temporary geometry (data copied to batch)
			surfData.geom.dispose();

		}

		worldGroup.add( batchedMesh );
		worldBatchedMeshes.push( batchedMesh );

	}

	worldMeshesBuilt = true;

}

//============================================================================
// R_UpdateWorldVisibility
//
// Called each frame after R_MarkLeaves. Uses BatchedMesh.setVisibleAt() to
// toggle visibility. A surface is visible if ANY of its containing leaves
// is in the PVS (has visframe === r_visframecount).
//============================================================================

function R_UpdateWorldVisibility() {

	for ( let i = 0; i < instanceVisInfo.length; i ++ ) {

		const info = instanceVisInfo[ i ];
		const leaves = info.leaves;

		// Surface is visible if ANY of its leaves is visible
		let visible = false;
		for ( let j = 0; j < leaves.length; j ++ ) {

			if ( leaves[ j ].visframe === r_visframecount ) {

				visible = true;
				break;

			}

		}

		info.batch.setVisibleAt( info.instanceId, visible );

	}

}

export function GL_BuildLightmaps() {

	const cl_ref = cl;
	if ( ! cl_ref ) return;

	// Dispose old BatchedMesh objects
	for ( const batchedMesh of worldBatchedMeshes ) {

		if ( batchedMesh.parent ) batchedMesh.parent.remove( batchedMesh );
		batchedMesh.dispose();
		if ( batchedMesh.material ) batchedMesh.material.dispose();

	}

	worldBatchedMeshes.length = 0;

	// Dispose any other children in worldGroup (water/sky meshes added dynamically)
	if ( worldGroup ) {

		while ( worldGroup.children.length > 0 ) {

			const child = worldGroup.children[ 0 ];
			worldGroup.remove( child );
			if ( child.geometry ) child.geometry.dispose();
			if ( child.material ) child.material.dispose();

		}

	}

	worldMeshesBuilt = false;

	// Clear PVS instance visibility info
	instanceVisInfo.length = 0;

	// Clear water/sky mesh caches
	for ( const mesh of _waterMeshesInScene ) {

		if ( mesh.parent ) mesh.parent.remove( mesh );

	}

	_waterMeshesInScene = new Set();
	_waterMeshesThisFrame = new Set();
	_waterMaterialCache.clear();

	// Clear brush entity material cache (dispose old materials first)
	for ( const mat of _brushMaterialCache.values() ) mat.dispose();
	_brushMaterialCache.clear();

	// Dispose all cached brush entity groups (geometry disposal)
	for ( const group of _allBrushEntityGroups ) {

		if ( group.parent ) group.parent.remove( group );
		for ( const child of group.children ) {

			if ( child.geometry ) child.geometry.dispose();

		}

	}

	_allBrushEntityGroups.clear();

	// Reset sky materials so they pick up new sky textures
	if ( solidSkyMaterial ) { solidSkyMaterial.dispose(); solidSkyMaterial = null; }
	if ( alphaSkyMaterial ) { alphaSkyMaterial.dispose(); alphaSkyMaterial = null; }

	// clear allocation
	for ( let i = 0; i < MAX_LIGHTMAPS; i ++ )
		allocated[ i ].fill( 0 );

	set_r_framecount( 1 ); // no dlightcache

	// set lightmap format -- use luminance (1 byte per texel)
	gl_lightmap_format = GL_LUMINANCE;
	lightmap_bytes = 1;

	// build lightmaps for all brush models
	const MAX_MODELS = 256;
	for ( let j = 1; j < MAX_MODELS; j ++ ) {

		const m = cl_ref.model_precache ? cl_ref.model_precache[ j ] : null;
		if ( ! m ) break;
		if ( m.name && m.name.charAt( 0 ) === '*' )
			continue;

		r_pcurrentvertbase = m.vertexes;
		currentmodel = m;

		if ( m.surfaces ) {

			// Iterate ALL surfaces (m->numsurfaces), not just the world model's
			// own range. The world model's surfaces array includes submodel
			// surfaces (doors, platforms, buttons) which also need polys built.
			// This matches the original C: for (i=0; i<m->numsurfaces; i++)
			for ( let i = 0; i < m.numsurfaces; i ++ ) {

				GL_CreateSurfaceLightmap( m.surfaces[ i ] );

				if ( m.surfaces[ i ].flags & SURF_DRAWTURB )
					continue;
				if ( m.surfaces[ i ].flags & SURF_DRAWSKY )
					continue;

				BuildSurfaceDisplayList( m.surfaces[ i ] );

			}

		}

	}

	// upload all lightmaps that were filled as Three.js DataTextures
	for ( let i = 0; i < MAX_LIGHTMAPS; i ++ ) {

		if ( ! allocated[ i ][ 0 ] )
			break; // no more used

		lightmap_modified[ i ] = false;
		lightmap_rectchange[ i ].l = BLOCK_WIDTH;
		lightmap_rectchange[ i ].t = BLOCK_HEIGHT;
		lightmap_rectchange[ i ].w = 0;
		lightmap_rectchange[ i ].h = 0;

		// Create Three.js DataTexture from lightmap data
		// R_BuildLightMap stores 255-brightness (Quake subtractive format).
		// Three.js lightMap is multiplicative, so invert to get brightness.
		// Use RGBA format — LuminanceFormat is not supported in WebGL 2.
		const offset = i * BLOCK_WIDTH * BLOCK_HEIGHT * lightmap_bytes;
		const pixelCount = BLOCK_WIDTH * BLOCK_HEIGHT;
		const data = new Uint8Array( pixelCount * 4 );
		for ( let p = 0; p < pixelCount; p ++ ) {

			const val = 255 - lightmaps[ offset + p ];
			data[ p * 4 ] = val;
			data[ p * 4 + 1 ] = val;
			data[ p * 4 + 2 ] = val;
			data[ p * 4 + 3 ] = 255;

		}

		const texture = new THREE.DataTexture(
			data,
			BLOCK_WIDTH,
			BLOCK_HEIGHT,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.flipY = false;
		texture.needsUpdate = true;

		lightmapTextures[ i ] = texture;

	}

	// Build cached meshes for all world surfaces (after lightmap textures are ready)
	R_BuildWorldMeshes();

}

//============================================================================
// Stub for external dependency
//============================================================================

// Mod_LeafPVS: imported from gl_model.js at top of file

// cl is imported from client.js at the top of this file
