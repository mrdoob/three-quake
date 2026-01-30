// Ported from: WinQuake/gl_rlight.c -- dynamic lighting

import * as THREE from 'three';
import { DotProduct, VectorCopy, VectorSubtract, Length, M_PI } from './mathlib.js';
import { MAX_LIGHTSTYLES } from './quakedef.js';
import { MAXLIGHTMAPS, d_lightstylevalue, r_framecount,
	gl_flashblend, v_blend } from './glquake.js';
import { r_origin, vpn, vright, vup } from './render.js';
import { cl_dlights } from './client.js';
import { VID_GetWorldContainer } from './vid.js';

export const MAX_DLIGHTS = 32;

// Surface flags
export const SURF_DRAWTILED = 0x20;

// Pre-allocated scratch vectors for RecursiveLightPoint (indexed by recursion depth)
// BSP trees are typically 20-30 levels deep max
const _lightMidPool = [];
for ( let i = 0; i < 32; i ++ ) _lightMidPool[ i ] = new Float32Array( 3 );

export let r_dlightframecount = 0;

/*
==================
R_AnimateLight
==================
*/
export function R_AnimateLight( cl, cl_lightstyle ) {

	//
	// light animations
	// 'm' is normal light, 'a' is no light, 'z' is double bright
	//
	const i = ( cl.time * 10 ) | 0;
	for ( let j = 0; j < MAX_LIGHTSTYLES; j ++ ) {

		if ( ! cl_lightstyle[ j ] || ! cl_lightstyle[ j ].length ) {

			d_lightstylevalue[ j ] = 256;
			continue;

		}

		const k_index = i % cl_lightstyle[ j ].length;
		let k = cl_lightstyle[ j ].map.charCodeAt( k_index ) - 97; // 'a' = 97
		k = k * 22;
		d_lightstylevalue[ j ] = k;

	}

}

/*
=============================================================================

DYNAMIC LIGHTS BLEND RENDERING

=============================================================================
*/

export function AddLightBlend( r, g, b, a2 ) {

	let a;

	v_blend[ 3 ] = a = v_blend[ 3 ] + a2 * ( 1 - v_blend[ 3 ] );

	const a2f = a2 / a;

	v_blend[ 0 ] = v_blend[ 0 ] * ( 1 - a2f ) + r * a2f;
	v_blend[ 1 ] = v_blend[ 1 ] * ( 1 - a2f ) + g * a2f;
	v_blend[ 2 ] = v_blend[ 2 ] * ( 1 - a2f ) + b * a2f;

}

/*
=============
R_RenderDlight

Renders a dynamic light using Three.js PointLight.
=============
*/

// Reusable vector for distance check
const _dlightV = new Float32Array( 3 );

// Pool of PointLights for dynamic lights
const _dlightPool = [];

function _getDlight( index ) {

	if ( _dlightPool[ index ] != null ) return _dlightPool[ index ];

	const light = new THREE.PointLight( 0xffaa44, 1, 300, 1 ); // decay=1 for linear falloff
	_dlightPool[ index ] = light;
	return light;

}

export function R_RenderDlight( light, dlightIndex ) {

	const rad = light.radius * 0.35;

	VectorSubtract( light.origin, r_origin, _dlightV );
	if ( Length( _dlightV ) < rad ) {

		// view is inside the dlight - add screen blend
		AddLightBlend( 1, 0.5, 0, light.radius * 0.0003 );
		// Note: Still create the PointLight even when inside - it should
		// still illuminate surfaces (unlike the original corona which
		// would be invisible/behind the camera when inside)

	}

	const pointLight = _getDlight( dlightIndex );

	// Position the light in Quake coordinates (same as camera/geometry)
	pointLight.position.set( light.origin[ 0 ], light.origin[ 1 ], light.origin[ 2 ] );

	// Set intensity and distance based on Quake light radius
	// Original Quake uses linear falloff: contribution = (radius - distance)
	// Three.js default is inverse-square (decay=2), so use decay=1 for linear
	pointLight.intensity = light.radius * 4;
	pointLight.distance = light.radius * 2;
	pointLight.decay = 1; // Linear falloff like original Quake

	return pointLight;

}

/*
=============
R_RenderDlights

Updates PointLights for all dynamic lights. Lights stay in scene
and have their intensity updated each frame based on decaying radius.
=============
*/
export function R_RenderDlights( cl, scene ) {

	if ( gl_flashblend.value === 0 )
		return;

	r_dlightframecount = r_framecount + 1;

	for ( let i = 0; i < MAX_DLIGHTS; i ++ ) {

		const l = cl_dlights[ i ];
		const pooledLight = _dlightPool[ i ];

		// Check if this dlight is active
		const isActive = l != null && l.die >= cl.time && l.radius > 0;

		if ( isActive ) {

			// Active - update properties
			const pointLight = _getDlight( i );
			pointLight.position.set( l.origin[ 0 ], l.origin[ 1 ], l.origin[ 2 ] );
			pointLight.intensity = l.radius * 5;
			pointLight.decay = 1; // Linear falloff

			// Add to world container for VR coordinate system support, or scene if not available
			if ( pointLight.parent == null ) {

				const worldContainer = VID_GetWorldContainer();
				if ( worldContainer ) {

					worldContainer.add( pointLight );

				} else if ( scene != null ) {

					scene.add( pointLight );

				}

			}

		} else {

			// Inactive - remove from scene if it was there
			if ( pooledLight != null && pooledLight.parent != null ) {

				pooledLight.parent.remove( pooledLight );

			}

		}

	}

}

/*
=============================================================================

DYNAMIC LIGHTS

=============================================================================
*/

/*
=============
R_MarkLights
=============
*/
export function R_MarkLights( light, bit, node, surfaces ) {

	if ( node.contents < 0 )
		return;

	const splitplane = node.plane;
	const dist = DotProduct( light.origin, splitplane.normal ) - splitplane.dist;

	if ( dist > light.radius ) {

		R_MarkLights( light, bit, node.children[ 0 ], surfaces );
		return;

	}

	if ( dist < - light.radius ) {

		R_MarkLights( light, bit, node.children[ 1 ], surfaces );
		return;

	}

	// mark the polygons
	const surfStart = node.firstsurface;
	for ( let i = 0; i < node.numsurfaces; i ++ ) {

		const surf = surfaces[ surfStart + i ];
		if ( ! surf ) continue;

		if ( surf.dlightframe !== r_dlightframecount ) {

			surf.dlightbits = 0;
			surf.dlightframe = r_dlightframecount;

		}

		surf.dlightbits |= bit;

	}

	R_MarkLights( light, bit, node.children[ 0 ], surfaces );
	R_MarkLights( light, bit, node.children[ 1 ], surfaces );

}

/*
=============
R_PushDlights
=============
*/
export function R_PushDlights( cl ) {

	if ( gl_flashblend.value )
		return;

	r_dlightframecount = r_framecount + 1; // because the count hasn't
	//  advanced yet for this frame

	if ( ! cl.worldmodel || ! cl.worldmodel.nodes )
		return;

	for ( let i = 0; i < MAX_DLIGHTS; i ++ ) {

		const l = cl_dlights[ i ];
		if ( ! l ) continue;
		if ( l.die < cl.time || ! l.radius )
			continue;
		R_MarkLights( l, 1 << i, cl.worldmodel.nodes[ 0 ], cl.worldmodel.surfaces );

	}

}

/*
=============================================================================

LIGHT SAMPLING

=============================================================================
*/

export let lightplane = null;
export let lightspot = new Float32Array( 3 );

/*
=============
RecursiveLightPoint
=============
*/
export function RecursiveLightPoint( node, start, end, surfaces, depth = 0 ) {

	if ( ! node || node.contents < 0 )
		return - 1; // didn't hit anything

	// calculate mid point

	// FIXME: optimize for axial
	const plane = node.plane;
	if ( ! plane ) return - 1;
	const front = DotProduct( start, plane.normal ) - plane.dist;
	const back = DotProduct( end, plane.normal ) - plane.dist;
	const side = front < 0 ? 1 : 0;

	if ( ( back < 0 ) === ( front < 0 ) )
		return RecursiveLightPoint( node.children[ side ], start, end, surfaces, depth );

	const frac = front / ( front - back );
	// Use pre-allocated scratch vector from pool (indexed by recursion depth)
	const mid = _lightMidPool[ depth ];
	mid[ 0 ] = start[ 0 ] + ( end[ 0 ] - start[ 0 ] ) * frac;
	mid[ 1 ] = start[ 1 ] + ( end[ 1 ] - start[ 1 ] ) * frac;
	mid[ 2 ] = start[ 2 ] + ( end[ 2 ] - start[ 2 ] ) * frac;

	// go down front side
	let r = RecursiveLightPoint( node.children[ side ], start, mid, surfaces, depth + 1 );
	if ( r >= 0 )
		return r; // hit something

	if ( ( back < 0 ) === ( front < 0 ) )
		return - 1; // didn't hit anything

	// check for impact on this node
	VectorCopy( mid, lightspot );
	lightplane = plane;

	const surfStart = node.firstsurface;
	for ( let i = 0; i < node.numsurfaces; i ++ ) {

		const surf = surfaces[ surfStart + i ];
		if ( ! surf ) continue;

		if ( surf.flags & SURF_DRAWTILED )
			continue; // no lightmaps

		const tex = surf.texinfo;

		const s = DotProduct( mid, tex.vecs[ 0 ] ) + tex.vecs[ 0 ][ 3 ];
		const t = DotProduct( mid, tex.vecs[ 1 ] ) + tex.vecs[ 1 ][ 3 ];

		if ( s < surf.texturemins[ 0 ] || t < surf.texturemins[ 1 ] )
			continue;

		const ds = s - surf.texturemins[ 0 ];
		const dt = t - surf.texturemins[ 1 ];

		if ( ds > surf.extents[ 0 ] || dt > surf.extents[ 1 ] )
			continue;

		if ( ! surf.samples )
			return 0;

		const ds4 = ds >> 4;
		const dt4 = dt >> 4;

		const lightmap = surf.samples;
		r = 0;
		if ( lightmap ) {

			let lightmapOffset = ( surf.sampleOffset || 0 ) + dt4 * ( ( surf.extents[ 0 ] >> 4 ) + 1 ) + ds4;

			for ( let maps = 0; maps < MAXLIGHTMAPS && surf.styles[ maps ] !== 255; maps ++ ) {

				const scale = d_lightstylevalue[ surf.styles[ maps ] ];
				r += lightmap[ lightmapOffset ] * scale;
				lightmapOffset += ( ( surf.extents[ 0 ] >> 4 ) + 1 )
					* ( ( surf.extents[ 1 ] >> 4 ) + 1 );

			}

			r >>= 8;

		}

		return r;

	}

	// go down back side
	return RecursiveLightPoint( node.children[ side ? 0 : 1 ], mid, end, surfaces );

}

/*
=============
R_LightPoint
=============
*/
export function R_LightPoint( p, cl ) {

	if ( ! cl.worldmodel || ! cl.worldmodel.lightdata )
		return 255;

	const end = new Float32Array( 3 );
	end[ 0 ] = p[ 0 ];
	end[ 1 ] = p[ 1 ];
	end[ 2 ] = p[ 2 ] - 2048;

	let r = RecursiveLightPoint( cl.worldmodel.nodes[ 0 ], p, end, cl.worldmodel.surfaces );

	if ( r === - 1 )
		r = 0;

	return r;

}

/*
=============
R_AddDynamicLights

Add contribution of dynamic lights to a surface's lightmap.
In Three.js, this can be used to compute per-vertex lighting contributions
from dynamic lights for surfaces near them.
=============
*/
export function R_AddDynamicLights( surf, cl ) {

	if ( ! cl || ! cl.dlights )
		return;

	for ( let lnum = 0; lnum < MAX_DLIGHTS; lnum ++ ) {

		if ( ! ( surf.dlightbits & ( 1 << lnum ) ) )
			continue; // not lit by this light

		const dl = cl.dlights[ lnum ];
		if ( ! dl ) continue;

		const dist = DotProduct( dl.origin, surf.plane.normal ) - surf.plane.dist;
		const rad = dl.radius - Math.abs( dist );
		if ( rad < 0 )
			continue;

		// This light affects this surface
		// In a full Three.js implementation, you'd update the surface's
		// lightmap texture data here based on the light contribution

	}

}

/*
=============
dlight_t class
=============
*/
export class dlight_t {

	constructor() {

		this.origin = new Float32Array( 3 );
		this.radius = 0;
		this.die = 0; // stop lighting after this time
		this.decay = 0; // drop this each second
		this.minlight = 0; // don't add when contributing less
		this.key = 0;

	}

}
