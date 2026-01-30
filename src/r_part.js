// Ported from: WinQuake/r_part.c -- particle system

import * as THREE from 'three';
import { VectorCopy, VectorSubtract, VectorNormalize, VectorAdd, vec3_origin } from './mathlib.js';
import { d_8to24table, VID_GetWorldContainer } from './vid.js';
import { cl as client_cl } from './client.js';
import { gl_texturemode, GL_RegisterTexture } from './glquake.js';

const MAX_PARTICLES = 2048;

const ramp1 = [ 0x6f, 0x6d, 0x6b, 0x69, 0x67, 0x65, 0x63, 0x61 ];
const ramp2 = [ 0x6f, 0x6e, 0x6d, 0x6c, 0x6b, 0x6a, 0x68, 0x66 ];
const ramp3 = [ 0x6d, 0x6b, 6, 5, 4, 3 ];

// particle types
const pt_static = 0;
const pt_grav = 1;
const pt_slowgrav = 2;
const pt_fire = 3;
const pt_explode = 4;
const pt_explode2 = 5;
const pt_blob = 6;
const pt_blob2 = 7;

class particle_t {

	constructor() {

		this.org = new Float32Array( 3 );
		this.vel = new Float32Array( 3 );
		this.color = 0;
		this.ramp = 0;
		this.die = - 1;
		this.type = pt_static;

	}

}

// Particle pool — use array index as linked list via nextIndex
const particles = new Array( MAX_PARTICLES );
const particleNext = new Int32Array( MAX_PARTICLES ); // -1 = end of list

let activeList = - 1; // head index of active list
let freeList = - 1; // head index of free list

// External state
let _scene = null;
let _sv_gravity = 800; // default gravity

// THREE.js rendering objects
let pointsGeometry = null;
let pointsMaterial = null;
let pointsMesh = null;
let particleTexture = null;

const positionArray = new Float32Array( MAX_PARTICLES * 3 );
const colorArray = new Float32Array( MAX_PARTICLES * 3 );

let tracercount = 0;

/*
===============
R_InitParticleTexture

Matches gl_rmisc.c R_InitParticleTexture — 8x8 white dot with alpha diamond
===============
*/
function R_InitParticleTexture() {

	const dottexture = [
		[ 0, 1, 1, 0, 0, 0, 0, 0 ],
		[ 1, 1, 1, 1, 0, 0, 0, 0 ],
		[ 1, 1, 1, 1, 0, 0, 0, 0 ],
		[ 0, 1, 1, 0, 0, 0, 0, 0 ],
		[ 0, 0, 0, 0, 0, 0, 0, 0 ],
		[ 0, 0, 0, 0, 0, 0, 0, 0 ],
		[ 0, 0, 0, 0, 0, 0, 0, 0 ],
		[ 0, 0, 0, 0, 0, 0, 0, 0 ]
	];

	const data = new Uint8Array( 8 * 8 * 4 );
	for ( let x = 0; x < 8; x ++ ) {

		for ( let y = 0; y < 8; y ++ ) {

			const idx = ( y * 8 + x ) * 4;
			data[ idx ] = 255;
			data[ idx + 1 ] = 255;
			data[ idx + 2 ] = 255;
			data[ idx + 3 ] = dottexture[ x ][ y ] * 255;

		}

	}

	particleTexture = new THREE.DataTexture( data, 8, 8, THREE.RGBAFormat );
	// Use cvar to determine filter mode: 0 = nearest (pixelated), 1 = linear (smooth)
	const filter = gl_texturemode.value ? THREE.LinearFilter : THREE.NearestFilter;
	particleTexture.magFilter = filter;
	particleTexture.minFilter = filter;
	particleTexture.colorSpace = THREE.SRGBColorSpace;
	particleTexture.needsUpdate = true;

	// Register for filter updates when setting changes
	GL_RegisterTexture( particleTexture );

}

/*
===============
R_InitParticles
===============
*/
export function R_InitParticles() {

	for ( let i = 0; i < MAX_PARTICLES; i ++ ) {

		particles[ i ] = new particle_t();

	}

	R_ClearParticles();
	R_InitParticleTexture();

}

/*
===============
R_SetParticleExternals
===============
*/
export function R_SetParticleExternals( externals ) {

	if ( externals.scene ) _scene = externals.scene;
	if ( externals.sv_gravity !== undefined ) _sv_gravity = externals.sv_gravity;

}

/*
===============
R_ClearParticles
===============
*/
export function R_ClearParticles() {

	activeList = - 1;

	freeList = 0;
	for ( let i = 0; i < MAX_PARTICLES - 1; i ++ ) {

		particleNext[ i ] = i + 1;

	}

	particleNext[ MAX_PARTICLES - 1 ] = - 1;

}

function allocParticle() {

	if ( freeList === - 1 ) return null;

	const idx = freeList;
	freeList = particleNext[ idx ];

	particleNext[ idx ] = activeList;
	activeList = idx;

	const p = particles[ idx ];
	p.org[ 0 ] = 0; p.org[ 1 ] = 0; p.org[ 2 ] = 0;
	p.vel[ 0 ] = 0; p.vel[ 1 ] = 0; p.vel[ 2 ] = 0;
	p.color = 0;
	p.ramp = 0;
	p.die = - 1;
	p.type = pt_static;

	return p;

}

/*
===============
R_ParticleExplosion
===============
*/
export function R_ParticleExplosion( org ) {

	if ( ! client_cl ) return;

	for ( let i = 0; i < 1024; i ++ ) {

		const p = allocParticle();
		if ( ! p ) return;

		p.die = client_cl.time + 5;
		p.color = ramp1[ 0 ];
		p.ramp = Math.random() * 4 | 0;

		if ( i & 1 ) {

			p.type = pt_explode;
			for ( let j = 0; j < 3; j ++ ) {

				p.org[ j ] = org[ j ] + ( ( Math.random() * 32 | 0 ) - 16 );
				p.vel[ j ] = ( Math.random() * 512 | 0 ) - 256;

			}

		} else {

			p.type = pt_explode2;
			for ( let j = 0; j < 3; j ++ ) {

				p.org[ j ] = org[ j ] + ( ( Math.random() * 32 | 0 ) - 16 );
				p.vel[ j ] = ( Math.random() * 512 | 0 ) - 256;

			}

		}

	}

}

/*
===============
R_ParticleExplosion2
===============
*/
export function R_ParticleExplosion2( org, colorStart, colorLength ) {

	if ( ! client_cl ) return;
	let colorMod = 0;

	for ( let i = 0; i < 512; i ++ ) {

		const p = allocParticle();
		if ( ! p ) return;

		p.die = client_cl.time + 0.3;
		p.color = colorStart + ( colorMod % colorLength );
		colorMod ++;
		p.type = pt_blob;

		for ( let j = 0; j < 3; j ++ ) {

			p.org[ j ] = org[ j ] + ( ( Math.random() * 32 | 0 ) - 16 );
			p.vel[ j ] = ( Math.random() * 512 | 0 ) - 256;

		}

	}

}

/*
===============
R_BlobExplosion
===============
*/
export function R_BlobExplosion( org ) {

	if ( ! client_cl ) return;

	for ( let i = 0; i < 1024; i ++ ) {

		const p = allocParticle();
		if ( ! p ) return;

		p.die = client_cl.time + 1 + ( Math.random() * 8 | 0 ) * 0.05;

		if ( i & 1 ) {

			p.type = pt_blob;
			p.color = 66 + ( Math.random() * 6 | 0 );

		} else {

			p.type = pt_blob2;
			p.color = 150 + ( Math.random() * 6 | 0 );

		}

		for ( let j = 0; j < 3; j ++ ) {

			p.org[ j ] = org[ j ] + ( ( Math.random() * 32 | 0 ) - 16 );
			p.vel[ j ] = ( Math.random() * 512 | 0 ) - 256;

		}

	}

}

/*
===============
R_RunParticleEffect
===============
*/
export function R_RunParticleEffect( org, dir, color, count ) {

	if ( ! client_cl ) return;

	for ( let i = 0; i < count; i ++ ) {

		const p = allocParticle();
		if ( ! p ) return;

		if ( count === 1024 ) {

			// rocket explosion
			p.die = client_cl.time + 5;
			p.color = ramp1[ 0 ];
			p.ramp = Math.random() * 4 | 0;

			if ( i & 1 ) {

				p.type = pt_explode;
				for ( let j = 0; j < 3; j ++ ) {

					p.org[ j ] = org[ j ] + ( ( Math.random() * 32 | 0 ) - 16 );
					p.vel[ j ] = ( Math.random() * 512 | 0 ) - 256;

				}

			} else {

				p.type = pt_explode2;
				for ( let j = 0; j < 3; j ++ ) {

					p.org[ j ] = org[ j ] + ( ( Math.random() * 32 | 0 ) - 16 );
					p.vel[ j ] = ( Math.random() * 512 | 0 ) - 256;

				}

			}

		} else {

			p.die = client_cl.time + 0.1 * ( Math.random() * 5 | 0 );
			p.color = ( color & ~ 7 ) + ( Math.random() * 8 | 0 );
			p.type = pt_slowgrav;

			for ( let j = 0; j < 3; j ++ ) {

				p.org[ j ] = org[ j ] + ( ( Math.random() * 16 | 0 ) - 8 );
				p.vel[ j ] = dir[ j ] * 15;

			}

		}

	}

}

/*
===============
R_LavaSplash
===============
*/
export function R_LavaSplash( org ) {

	if ( ! client_cl ) return;
	const dir = new Float32Array( 3 );

	for ( let i = - 16; i < 16; i ++ ) {

		for ( let j = - 16; j < 16; j ++ ) {

			const p = allocParticle();
			if ( ! p ) return;

			p.die = client_cl.time + 2 + ( Math.random() * 32 | 0 ) * 0.02;
			p.color = 224 + ( Math.random() * 8 | 0 );
			p.type = pt_slowgrav;

			dir[ 0 ] = j * 8 + ( Math.random() * 8 | 0 );
			dir[ 1 ] = i * 8 + ( Math.random() * 8 | 0 );
			dir[ 2 ] = 256;

			p.org[ 0 ] = org[ 0 ] + dir[ 0 ];
			p.org[ 1 ] = org[ 1 ] + dir[ 1 ];
			p.org[ 2 ] = org[ 2 ] + ( Math.random() * 64 | 0 );

			VectorNormalize( dir );
			const vel = 50 + ( Math.random() * 64 | 0 );
			p.vel[ 0 ] = dir[ 0 ] * vel;
			p.vel[ 1 ] = dir[ 1 ] * vel;
			p.vel[ 2 ] = dir[ 2 ] * vel;

		}

	}

}

/*
===============
R_TeleportSplash
===============
*/
export function R_TeleportSplash( org ) {

	if ( ! client_cl ) return;
	const dir = new Float32Array( 3 );

	for ( let i = - 16; i < 16; i += 4 ) {

		for ( let j = - 16; j < 16; j += 4 ) {

			for ( let k = - 24; k < 32; k += 4 ) {

				const p = allocParticle();
				if ( ! p ) return;

				p.die = client_cl.time + 0.2 + ( Math.random() * 8 | 0 ) * 0.02;
				p.color = 7 + ( Math.random() * 8 | 0 );
				p.type = pt_slowgrav;

				dir[ 0 ] = j * 8;
				dir[ 1 ] = i * 8;
				dir[ 2 ] = k * 8;

				p.org[ 0 ] = org[ 0 ] + i + ( Math.random() * 4 | 0 );
				p.org[ 1 ] = org[ 1 ] + j + ( Math.random() * 4 | 0 );
				p.org[ 2 ] = org[ 2 ] + k + ( Math.random() * 4 | 0 );

				VectorNormalize( dir );
				const vel = 50 + ( Math.random() * 64 | 0 );
				p.vel[ 0 ] = dir[ 0 ] * vel;
				p.vel[ 1 ] = dir[ 1 ] * vel;
				p.vel[ 2 ] = dir[ 2 ] * vel;

			}

		}

	}

}

/*
===============
R_RocketTrail
===============
*/
export function R_RocketTrail( start, end, type ) {

	if ( ! client_cl ) return;

	const vec = new Float32Array( 3 );
	const s = new Float32Array( 3 );
	VectorCopy( start, s );
	VectorSubtract( end, s, vec );
	let len = VectorNormalize( vec );

	let dec;
	if ( type < 128 ) {

		dec = 3;

	} else {

		dec = 1;
		type -= 128;

	}

	while ( len > 0 ) {

		len -= dec;

		const p = allocParticle();
		if ( ! p ) return;

		p.vel[ 0 ] = 0; p.vel[ 1 ] = 0; p.vel[ 2 ] = 0;
		p.die = client_cl.time + 2;

		switch ( type ) {

			case 0: // rocket trail
				p.ramp = Math.random() * 4 | 0;
				p.color = ramp3[ Math.min( p.ramp | 0, ramp3.length - 1 ) ];
				p.type = pt_fire;
				for ( let j = 0; j < 3; j ++ )
					p.org[ j ] = s[ j ] + ( ( Math.random() * 6 | 0 ) - 3 );
				break;

			case 1: // smoke
				p.ramp = ( Math.random() * 4 | 0 ) + 2;
				p.color = ramp3[ Math.min( p.ramp | 0, ramp3.length - 1 ) ];
				p.type = pt_fire;
				for ( let j = 0; j < 3; j ++ )
					p.org[ j ] = s[ j ] + ( ( Math.random() * 6 | 0 ) - 3 );
				break;

			case 2: // blood
				p.type = pt_grav;
				p.color = 67 + ( Math.random() * 4 | 0 );
				for ( let j = 0; j < 3; j ++ )
					p.org[ j ] = s[ j ] + ( ( Math.random() * 6 | 0 ) - 3 );
				break;

			case 3: // tracer
			case 5:
				p.die = client_cl.time + 0.5;
				p.type = pt_static;
				if ( type === 3 )
					p.color = 52 + ( ( tracercount & 4 ) << 1 );
				else
					p.color = 230 + ( ( tracercount & 4 ) << 1 );
				tracercount ++;
				VectorCopy( s, p.org );
				if ( tracercount & 1 ) {

					p.vel[ 0 ] = 30 * vec[ 1 ];
					p.vel[ 1 ] = 30 * - vec[ 0 ];

				} else {

					p.vel[ 0 ] = 30 * - vec[ 1 ];
					p.vel[ 1 ] = 30 * vec[ 0 ];

				}

				break;

			case 4: // slight blood
				p.type = pt_grav;
				p.color = 67 + ( Math.random() * 4 | 0 );
				for ( let j = 0; j < 3; j ++ )
					p.org[ j ] = s[ j ] + ( ( Math.random() * 6 | 0 ) - 3 );
				len -= 3;
				break;

			case 6: // voor trail
				p.color = 9 * 16 + 8 + ( Math.random() * 4 | 0 );
				p.type = pt_static;
				p.die = client_cl.time + 0.3;
				for ( let j = 0; j < 3; j ++ )
					p.org[ j ] = s[ j ] + ( ( Math.random() * 16 | 0 ) - 8 );
				break;

		}

		s[ 0 ] += vec[ 0 ];
		s[ 1 ] += vec[ 1 ];
		s[ 2 ] += vec[ 2 ];

	}

}

/*
===============
R_EntityParticles
===============
*/
export function R_EntityParticles( ent ) {

	// Simplified entity particle halo — not critical for gameplay

}

/*
===============
R_DrawParticles
===============
*/
export function R_DrawParticles() {

	if ( ! client_cl || ! _scene ) return;

	// Use absolute frametime, not cl.time - cl.oldtime
	// cl.time can be modified by CL_LerpPoint which causes frametime to go <= 0
	let frametime = client_cl.time - client_cl.oldtime;
	if ( frametime <= 0 || frametime > 0.5 ) {

		// Fallback to a reasonable frametime for particle physics
		// but still process dead particle removal
		frametime = 0.016; // ~60fps default

	}

	const time3 = frametime * 15;
	const time2 = frametime * 10;
	const time1 = frametime * 5;
	const grav = frametime * _sv_gravity * 0.05;
	const dvel = 4 * frametime;

	// Remove dead particles from front of active list
	while ( activeList !== - 1 && particles[ activeList ].die < client_cl.time ) {

		const killIdx = activeList;
		activeList = particleNext[ killIdx ];
		particleNext[ killIdx ] = freeList;
		freeList = killIdx;

	}

	// Walk active list, remove dead and update physics
	let count = 0;
	let prevIdx = - 1;
	let idx = activeList;

	while ( idx !== - 1 ) {

		const nextIdx = particleNext[ idx ];

		// Remove dead particles in the middle of the list
		if ( particles[ idx ].die < client_cl.time ) {

			if ( prevIdx !== - 1 ) {

				particleNext[ prevIdx ] = nextIdx;

			} else {

				activeList = nextIdx;

			}

			particleNext[ idx ] = freeList;
			freeList = idx;
			idx = nextIdx;
			continue;

		}

		const p = particles[ idx ];

		// Store position for rendering (raw Quake coordinates — camera uses them too)
		positionArray[ count * 3 ] = p.org[ 0 ];
		positionArray[ count * 3 + 1 ] = p.org[ 1 ];
		positionArray[ count * 3 + 2 ] = p.org[ 2 ];

		// Convert palette color to RGB
		const rgba = d_8to24table[ p.color & 0xff ];
		colorArray[ count * 3 ] = ( rgba & 0xff ) / 255;
		colorArray[ count * 3 + 1 ] = ( ( rgba >> 8 ) & 0xff ) / 255;
		colorArray[ count * 3 + 2 ] = ( ( rgba >> 16 ) & 0xff ) / 255;

		count ++;

		// Update physics
		p.org[ 0 ] += p.vel[ 0 ] * frametime;
		p.org[ 1 ] += p.vel[ 1 ] * frametime;
		p.org[ 2 ] += p.vel[ 2 ] * frametime;

		switch ( p.type ) {

			case pt_static:
				break;

			case pt_fire:
				p.ramp += time1;
				if ( p.ramp >= 6 )
					p.die = - 1;
				else
					p.color = ramp3[ Math.min( p.ramp | 0, ramp3.length - 1 ) ];
				p.vel[ 2 ] += grav;
				break;

			case pt_explode:
				p.ramp += time2;
				if ( p.ramp >= 8 )
					p.die = - 1;
				else
					p.color = ramp1[ Math.min( p.ramp | 0, ramp1.length - 1 ) ];
				for ( let i = 0; i < 3; i ++ )
					p.vel[ i ] += p.vel[ i ] * dvel;
				p.vel[ 2 ] -= grav;
				break;

			case pt_explode2:
				p.ramp += time3;
				if ( p.ramp >= 8 )
					p.die = - 1;
				else
					p.color = ramp2[ Math.min( p.ramp | 0, ramp2.length - 1 ) ];
				for ( let i = 0; i < 3; i ++ )
					p.vel[ i ] -= p.vel[ i ] * frametime;
				p.vel[ 2 ] -= grav;
				break;

			case pt_blob:
				for ( let i = 0; i < 3; i ++ )
					p.vel[ i ] += p.vel[ i ] * dvel;
				p.vel[ 2 ] -= grav;
				break;

			case pt_blob2:
				for ( let i = 0; i < 2; i ++ )
					p.vel[ i ] -= p.vel[ i ] * dvel;
				p.vel[ 2 ] -= grav;
				break;

			case pt_grav:
				p.vel[ 2 ] -= grav;
				break;

			case pt_slowgrav:
				p.vel[ 2 ] -= grav;
				break;

		}

		prevIdx = idx;
		idx = nextIdx;

	}

	// Render particles as THREE.Points
	if ( count === 0 ) {

		if ( pointsMesh && pointsMesh.parent ) {

			_scene.remove( pointsMesh );

		}

		return;

	}

	if ( ! pointsGeometry ) {

		pointsGeometry = new THREE.BufferGeometry();
		pointsGeometry.setAttribute( 'position', new THREE.BufferAttribute( positionArray, 3 ) );
		pointsGeometry.setAttribute( 'color', new THREE.BufferAttribute( colorArray, 3 ) );

		pointsMaterial = new THREE.PointsMaterial( {
			size: 3, // Original Quake uses 1.5 world unit triangle (spans 1.5 in up + right)
			sizeAttenuation: true,
			vertexColors: true,
			depthWrite: false,
			transparent: true,
			map: particleTexture
		} );

		pointsMesh = new THREE.Points( pointsGeometry, pointsMaterial );
		pointsMesh.frustumCulled = false;

	}

	pointsGeometry.attributes.position.needsUpdate = true;
	pointsGeometry.attributes.color.needsUpdate = true;
	pointsGeometry.setDrawRange( 0, count );

	if ( ! pointsMesh.parent ) {

		// Add to world container for VR coordinate system support
		const worldContainer = VID_GetWorldContainer();
		if ( worldContainer ) {

			worldContainer.add( pointsMesh );

		} else {

			_scene.add( pointsMesh );

		}

	}

}
