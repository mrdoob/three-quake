// Ported from: QuakeWorld/client/pmove.c and pmovetst.c
// Shared player movement physics for client-side prediction
// This code runs identically on both client and server

import { vec3_origin, DotProduct, VectorCopy, VectorAdd, VectorSubtract,
	VectorMA, VectorScale, VectorNormalize, Length, AngleVectors, CrossProduct } from './mathlib.js';
import { CONTENTS_EMPTY, CONTENTS_SOLID, CONTENTS_WATER, CONTENTS_SLIME } from './bspfile.js';

// Movement constants
const STEPSIZE = 18;
const BUTTON_JUMP = 2;
const STOP_EPSILON = 0.1;
const MAX_CLIP_PLANES = 5;
const DIST_EPSILON = 0.03125; // 1/32 epsilon for floating point

// Player bounds
export const player_mins = new Float32Array( [ -16, -16, -24 ] );
export const player_maxs = new Float32Array( [ 16, 16, 32 ] );

// Cached buffers to avoid per-call allocations (Golden Rule #4)
const _pm_flymove_original_velocity = new Float32Array( 3 );
const _pm_flymove_primal_velocity = new Float32Array( 3 );
const _pm_flymove_end = new Float32Array( 3 );
const _pm_flymove_dir = new Float32Array( 3 );
const _pm_flymove_planes = [];
for ( let i = 0; i < MAX_CLIP_PLANES; i++ )
	_pm_flymove_planes[ i ] = new Float32Array( 3 );

// Note: PM_RecursiveHullCheck's `mid` cannot be cached — it's recursive
const _pm_testpos_mins = new Float32Array( 3 );
const _pm_testpos_maxs = new Float32Array( 3 );
const _pm_testpos_test = new Float32Array( 3 );
const _pm_move_mins = new Float32Array( 3 );
const _pm_move_maxs = new Float32Array( 3 );
const _pm_move_offset = new Float32Array( 3 );
const _pm_move_start_l = new Float32Array( 3 );
const _pm_move_end_l = new Float32Array( 3 );
const _pm_friction_start = new Float32Array( 3 );
const _pm_friction_stop = new Float32Array( 3 );
const _pm_watermove_wishvel = new Float32Array( 3 );
const _pm_watermove_wishdir = new Float32Array( 3 );
const _pm_watermove_dest = new Float32Array( 3 );
const _pm_watermove_start = new Float32Array( 3 );
const _pm_groundmove_dest = new Float32Array( 3 );
const _pm_groundmove_original = new Float32Array( 3 );
const _pm_groundmove_originalvel = new Float32Array( 3 );
const _pm_groundmove_down = new Float32Array( 3 );
const _pm_groundmove_downvel = new Float32Array( 3 );
const _pm_groundmove_up = new Float32Array( 3 );
const _pm_airmove_wishvel = new Float32Array( 3 );
const _pm_airmove_wishdir = new Float32Array( 3 );
const _pm_catpos_point = new Float32Array( 3 );
const _pm_waterjump_flatforward = new Float32Array( 3 );
const _pm_waterjump_spot = new Float32Array( 3 );
const _pm_nudge_base = new Float32Array( 3 );
const _pm_spectator_wishvel = new Float32Array( 3 );
const _pm_spectator_wishdir = new Float32Array( 3 );

// Movement variables (sent from server, used for physics)
export const movevars = {
	gravity: 800,
	stopspeed: 100,
	maxspeed: 320,
	spectatormaxspeed: 500,
	accelerate: 10,
	airaccelerate: 0.7,
	wateraccelerate: 10,
	friction: 4,
	waterfriction: 1,
	entgravity: 1.0
};

// Trace result structure
export class pmtrace_t {
	constructor() {
		this.allsolid = false;
		this.startsolid = false;
		this.inopen = false;
		this.inwater = false;
		this.fraction = 1;
		this.endpos = new Float32Array( 3 );
		this.plane = {
			normal: new Float32Array( 3 ),
			dist: 0
		};
		this.ent = -1;
	}
}

// Cached pmtrace_t buffers (must be after class definition)
const _pm_move_total = new pmtrace_t();
const _pm_move_trace = new pmtrace_t();

// Physics entity (world + other players/entities to collide with)
export class physent_t {
	constructor() {
		this.origin = new Float32Array( 3 );
		this.model = null; // BSP model for collision
		this.mins = new Float32Array( 3 );
		this.maxs = new Float32Array( 3 );
		this.info = 0;
	}
}

// Main player move state
export const pmove = {
	sequence: 0,

	// Player state
	origin: new Float32Array( 3 ),
	angles: new Float32Array( 3 ),
	velocity: new Float32Array( 3 ),
	oldbuttons: 0,
	waterjumptime: 0,
	dead: false,
	spectator: false,

	// World state - physics entities to collide with
	numphysent: 0,
	physents: [], // Array of physent_t, [0] is world

	// Input command
	cmd: {
		msec: 0,
		angles: new Float32Array( 3 ),
		forwardmove: 0,
		sidemove: 0,
		upmove: 0,
		buttons: 0
	},

	// Results
	numtouch: 0,
	touchindex: []
};

// Initialize physents array
for ( let i = 0; i < 32; i++ ) {
	pmove.physents.push( new physent_t() );
	pmove.touchindex.push( 0 );
}

// Module-level state
let onground = -1; // -1 = in air, >= 0 = entity index we're standing on
let waterlevel = 0; // 0 = not in water, 1 = feet, 2 = waist, 3 = eyes
let watertype = CONTENTS_EMPTY;
let frametime = 0;

const forward = new Float32Array( 3 );
const right = new Float32Array( 3 );
const up = new Float32Array( 3 );

// Export state accessors
export function PM_GetOnGround() { return onground; }
export function PM_GetWaterLevel() { return waterlevel; }
export function PM_GetWaterType() { return watertype; }

// Box hull for non-BSP collision (other players)
const box_hull = {
	clipnodes: [],
	planes: [],
	firstclipnode: 0,
	lastclipnode: 5
};

for ( let i = 0; i < 6; i++ ) {
	box_hull.clipnodes.push( { planenum: i, children: [ 0, 0 ] } );
	box_hull.planes.push( { type: i >> 1, normal: new Float32Array( 3 ), dist: 0 } );
	box_hull.planes[ i ].normal[ i >> 1 ] = 1;
}

/*
===================
PM_InitBoxHull

Set up the planes and clipnodes so that the six floats of a bounding box
can just be stored out and get a proper hull_t structure.
===================
*/
export function PM_InitBoxHull() {
	for ( let i = 0; i < 6; i++ ) {
		box_hull.clipnodes[ i ].planenum = i;

		const side = i & 1;

		box_hull.clipnodes[ i ].children[ side ] = CONTENTS_EMPTY;
		if ( i !== 5 )
			box_hull.clipnodes[ i ].children[ side ^ 1 ] = i + 1;
		else
			box_hull.clipnodes[ i ].children[ side ^ 1 ] = CONTENTS_SOLID;

		box_hull.planes[ i ].type = i >> 1;
		box_hull.planes[ i ].normal.fill( 0 );
		box_hull.planes[ i ].normal[ i >> 1 ] = 1;
	}
}

/*
===================
PM_HullForBox

To keep everything totally uniform, bounding boxes are turned into small
BSP trees instead of being compared directly.
===================
*/
function PM_HullForBox( mins, maxs ) {
	box_hull.planes[ 0 ].dist = maxs[ 0 ];
	box_hull.planes[ 1 ].dist = mins[ 0 ];
	box_hull.planes[ 2 ].dist = maxs[ 1 ];
	box_hull.planes[ 3 ].dist = mins[ 1 ];
	box_hull.planes[ 4 ].dist = maxs[ 2 ];
	box_hull.planes[ 5 ].dist = mins[ 2 ];

	return box_hull;
}

/*
==================
PM_HullPointContents
==================
*/
export function PM_HullPointContents( hull, num, p ) {
	while ( num >= 0 ) {
		if ( num < hull.firstclipnode || num > hull.lastclipnode ) {
			console.error( 'PM_HullPointContents: bad node number' );
			return CONTENTS_SOLID;
		}

		const node = hull.clipnodes[ num ];
		const plane = hull.planes[ node.planenum ];

		let d;
		if ( plane.type < 3 )
			d = p[ plane.type ] - plane.dist;
		else
			d = DotProduct( plane.normal, p ) - plane.dist;

		if ( d < 0 )
			num = node.children[ 1 ];
		else
			num = node.children[ 0 ];
	}

	return num;
}

/*
==================
PM_PointContents
==================
*/
export function PM_PointContents( p ) {
	if ( pmove.numphysent === 0 || pmove.physents[ 0 ].model == null )
		return CONTENTS_EMPTY;

	const hull = pmove.physents[ 0 ].model.hulls[ 0 ];
	return PM_HullPointContents( hull, hull.firstclipnode, p );
}

/*
==================
PM_RecursiveHullCheck
==================
*/
function PM_RecursiveHullCheck( hull, num, p1f, p2f, p1, p2, trace ) {
	// check for empty
	if ( num < 0 ) {
		if ( num !== CONTENTS_SOLID ) {
			trace.allsolid = false;
			if ( num === CONTENTS_EMPTY )
				trace.inopen = true;
			else
				trace.inwater = true;
		} else {
			trace.startsolid = true;
		}
		return true; // empty
	}

	if ( num < hull.firstclipnode || num > hull.lastclipnode ) {
		console.error( 'PM_RecursiveHullCheck: bad node number' );
		return true;
	}

	// find the point distances
	const node = hull.clipnodes[ num ];
	const plane = hull.planes[ node.planenum ];

	let t1, t2;
	if ( plane.type < 3 ) {
		t1 = p1[ plane.type ] - plane.dist;
		t2 = p2[ plane.type ] - plane.dist;
	} else {
		t1 = DotProduct( plane.normal, p1 ) - plane.dist;
		t2 = DotProduct( plane.normal, p2 ) - plane.dist;
	}

	if ( t1 >= 0 && t2 >= 0 )
		return PM_RecursiveHullCheck( hull, node.children[ 0 ], p1f, p2f, p1, p2, trace );
	if ( t1 < 0 && t2 < 0 )
		return PM_RecursiveHullCheck( hull, node.children[ 1 ], p1f, p2f, p1, p2, trace );

	// put the crosspoint DIST_EPSILON pixels on the near side
	let frac;
	if ( t1 < 0 )
		frac = ( t1 + DIST_EPSILON ) / ( t1 - t2 );
	else
		frac = ( t1 - DIST_EPSILON ) / ( t1 - t2 );

	if ( frac < 0 ) frac = 0;
	if ( frac > 1 ) frac = 1;

	let midf = p1f + ( p2f - p1f ) * frac;
	const mid = new Float32Array( 3 ); // must allocate: recursive function needs separate buffer per call
	for ( let i = 0; i < 3; i++ )
		mid[ i ] = p1[ i ] + frac * ( p2[ i ] - p1[ i ] );

	const side = ( t1 < 0 ) ? 1 : 0;

	// move up to the node
	if ( ! PM_RecursiveHullCheck( hull, node.children[ side ], p1f, midf, p1, mid, trace ) )
		return false;

	if ( PM_HullPointContents( hull, node.children[ side ^ 1 ], mid ) !== CONTENTS_SOLID )
		// go past the node
		return PM_RecursiveHullCheck( hull, node.children[ side ^ 1 ], midf, p2f, mid, p2, trace );

	if ( trace.allsolid )
		return false; // never got out of the solid area

	// the other side of the node is solid, this is the impact point
	if ( side === 0 ) {
		VectorCopy( plane.normal, trace.plane.normal );
		trace.plane.dist = plane.dist;
	} else {
		VectorSubtract( vec3_origin, plane.normal, trace.plane.normal );
		trace.plane.dist = -plane.dist;
	}

	while ( PM_HullPointContents( hull, hull.firstclipnode, mid ) === CONTENTS_SOLID ) {
		// shouldn't really happen, but does occasionally
		frac -= 0.1;
		if ( frac < 0 ) {
			trace.fraction = midf;
			VectorCopy( mid, trace.endpos );
			return false;
		}
		midf = p1f + ( p2f - p1f ) * frac;
		for ( let i = 0; i < 3; i++ )
			mid[ i ] = p1[ i ] + frac * ( p2[ i ] - p1[ i ] );
	}

	trace.fraction = midf;
	VectorCopy( mid, trace.endpos );

	return false;
}

/*
================
PM_TestPlayerPosition

Returns false if the given player position is not valid (in solid)
================
*/
export function PM_TestPlayerPosition( pos ) {
	for ( let i = 0; i < pmove.numphysent; i++ ) {
		const pe = pmove.physents[ i ];

		// get the clipping hull
		let hull;
		if ( pe.model != null ) {
			hull = pe.model.hulls[ 1 ]; // hull 1 is player-sized
		} else {
			VectorSubtract( pe.mins, player_maxs, _pm_testpos_mins );
			VectorSubtract( pe.maxs, player_mins, _pm_testpos_maxs );
			hull = PM_HullForBox( _pm_testpos_mins, _pm_testpos_maxs );
		}

		VectorSubtract( pos, pe.origin, _pm_testpos_test );

		if ( PM_HullPointContents( hull, hull.firstclipnode, _pm_testpos_test ) === CONTENTS_SOLID )
			return false;
	}

	return true;
}

/*
================
PM_PlayerMove

Trace player from start to end, returns trace result
================
*/
export function PM_PlayerMove( start, end ) {
	const total = _pm_move_total;
	total.allsolid = false;
	total.startsolid = false;
	total.inopen = false;
	total.inwater = false;
	total.fraction = 1;
	total.ent = -1;
	total.plane.dist = 0;
	total.plane.normal[ 0 ] = 0;
	total.plane.normal[ 1 ] = 0;
	total.plane.normal[ 2 ] = 0;
	VectorCopy( end, total.endpos );

	for ( let i = 0; i < pmove.numphysent; i++ ) {
		const pe = pmove.physents[ i ];

		// get the clipping hull
		let hull;
		if ( pe.model != null ) {
			hull = pe.model.hulls[ 1 ];
		} else {
			VectorSubtract( pe.mins, player_maxs, _pm_move_mins );
			VectorSubtract( pe.maxs, player_mins, _pm_move_maxs );
			hull = PM_HullForBox( _pm_move_mins, _pm_move_maxs );
		}

		const offset = _pm_move_offset;
		VectorCopy( pe.origin, offset );

		const start_l = _pm_move_start_l;
		const end_l = _pm_move_end_l;
		VectorSubtract( start, offset, start_l );
		VectorSubtract( end, offset, end_l );

		// fill in a default trace
		const trace = _pm_move_trace;
		trace.allsolid = true;
		trace.startsolid = false;
		trace.inopen = false;
		trace.inwater = false;
		trace.fraction = 1;
		trace.ent = -1;
		trace.plane.dist = 0;
		trace.plane.normal[ 0 ] = 0;
		trace.plane.normal[ 1 ] = 0;
		trace.plane.normal[ 2 ] = 0;
		VectorCopy( end, trace.endpos );

		// trace a line through the apropriate clipping hull
		PM_RecursiveHullCheck( hull, hull.firstclipnode, 0, 1, start_l, end_l, trace );

		if ( trace.allsolid )
			trace.startsolid = true;
		if ( trace.startsolid )
			trace.fraction = 0;

		// did we clip the move?
		if ( trace.fraction < total.fraction ) {
			// fix trace up by the offset
			VectorAdd( trace.endpos, offset, trace.endpos );
			total.allsolid = trace.allsolid;
			total.startsolid = trace.startsolid;
			total.inopen = trace.inopen;
			total.inwater = trace.inwater;
			total.fraction = trace.fraction;
			VectorCopy( trace.endpos, total.endpos );
			VectorCopy( trace.plane.normal, total.plane.normal );
			total.plane.dist = trace.plane.dist;
			total.ent = i;
		}
	}

	return total;
}

/*
==================
PM_ClipVelocity

Slide off of the impacting object
returns the blocked flags (1 = floor, 2 = step / wall)
==================
*/
function PM_ClipVelocity( inv, normal, out, overbounce ) {
	let blocked = 0;
	if ( normal[ 2 ] > 0 )
		blocked |= 1; // floor
	if ( normal[ 2 ] === 0 )
		blocked |= 2; // step

	const backoff = DotProduct( inv, normal ) * overbounce;

	for ( let i = 0; i < 3; i++ ) {
		const change = normal[ i ] * backoff;
		out[ i ] = inv[ i ] - change;
		if ( out[ i ] > -STOP_EPSILON && out[ i ] < STOP_EPSILON )
			out[ i ] = 0;
	}

	return blocked;
}

/*
============
PM_FlyMove

The basic solid body movement clip that slides along multiple planes
============
*/
function PM_FlyMove() {
	const numbumps = 4;
	let blocked = 0;

	// Use cached buffers instead of allocating per-call
	const original_velocity = _pm_flymove_original_velocity;
	const primal_velocity = _pm_flymove_primal_velocity;
	VectorCopy( pmove.velocity, original_velocity );
	VectorCopy( pmove.velocity, primal_velocity );

	const planes = _pm_flymove_planes;
	let numplanes = 0;

	let time_left = frametime;

	for ( let bumpcount = 0; bumpcount < numbumps; bumpcount++ ) {
		const end = _pm_flymove_end;
		for ( let i = 0; i < 3; i++ )
			end[ i ] = pmove.origin[ i ] + time_left * pmove.velocity[ i ];

		const trace = PM_PlayerMove( pmove.origin, end );

		if ( trace.startsolid || trace.allsolid ) {
			// entity is trapped in another solid
			pmove.velocity.fill( 0 );
			return 3;
		}

		if ( trace.fraction > 0 ) {
			// actually covered some distance
			VectorCopy( trace.endpos, pmove.origin );
			numplanes = 0;
		}

		if ( trace.fraction === 1 )
			break; // moved the entire distance

		// save entity for contact
		if ( pmove.numtouch < pmove.touchindex.length ) {
			pmove.touchindex[ pmove.numtouch ] = trace.ent;
			pmove.numtouch++;
		}

		if ( trace.plane.normal[ 2 ] > 0.7 )
			blocked |= 1; // floor
		if ( trace.plane.normal[ 2 ] === 0 )
			blocked |= 2; // step

		time_left -= time_left * trace.fraction;

		// clipped to another plane
		if ( numplanes >= MAX_CLIP_PLANES ) {
			// this shouldn't really happen
			pmove.velocity.fill( 0 );
			break;
		}

		VectorCopy( trace.plane.normal, planes[ numplanes ] );
		numplanes++;

		// modify original_velocity so it parallels all of the clip planes
		let i;
		for ( i = 0; i < numplanes; i++ ) {
			PM_ClipVelocity( original_velocity, planes[ i ], pmove.velocity, 1 );
			let j;
			for ( j = 0; j < numplanes; j++ ) {
				if ( j !== i ) {
					if ( DotProduct( pmove.velocity, planes[ j ] ) < 0 )
						break; // not ok
				}
			}
			if ( j === numplanes )
				break;
		}

		if ( i !== numplanes ) {
			// go along this plane
		} else {
			// go along the crease
			if ( numplanes !== 2 ) {
				pmove.velocity.fill( 0 );
				break;
			}
			const dir = _pm_flymove_dir;
			CrossProduct( planes[ 0 ], planes[ 1 ], dir );
			const d = DotProduct( dir, pmove.velocity );
			VectorScale( dir, d, pmove.velocity );
		}

		// if original velocity is against the original velocity, stop dead
		// to avoid tiny oscillations in sloping corners
		if ( DotProduct( pmove.velocity, primal_velocity ) <= 0 ) {
			pmove.velocity.fill( 0 );
			break;
		}
	}

	if ( pmove.waterjumptime > 0 ) {
		VectorCopy( primal_velocity, pmove.velocity );
	}

	return blocked;
}

/*
==================
PM_Friction

Handles both ground friction and water friction
==================
*/
function PM_Friction() {
	if ( pmove.waterjumptime > 0 )
		return;

	const vel = pmove.velocity;

	const speed = Math.sqrt( vel[ 0 ] * vel[ 0 ] + vel[ 1 ] * vel[ 1 ] + vel[ 2 ] * vel[ 2 ] );
	if ( speed < 1 ) {
		vel[ 0 ] = 0;
		vel[ 1 ] = 0;
		return;
	}

	let friction = movevars.friction;

	// if the leading edge is over a dropoff, increase friction
	if ( onground !== -1 ) {
		const start = _pm_friction_start;
		const stop = _pm_friction_stop;
		start[ 0 ] = stop[ 0 ] = pmove.origin[ 0 ] + vel[ 0 ] / speed * 16;
		start[ 1 ] = stop[ 1 ] = pmove.origin[ 1 ] + vel[ 1 ] / speed * 16;
		start[ 2 ] = pmove.origin[ 2 ] + player_mins[ 2 ];
		stop[ 2 ] = start[ 2 ] - 34;

		const trace = PM_PlayerMove( start, stop );

		if ( trace.fraction === 1 ) {
			friction *= 2;
		}
	}

	let drop = 0;

	if ( waterlevel >= 2 ) {
		// apply water friction
		drop += speed * movevars.waterfriction * waterlevel * frametime;
	} else if ( onground !== -1 ) {
		// apply ground friction
		const control = speed < movevars.stopspeed ? movevars.stopspeed : speed;
		drop += control * friction * frametime;
	}

	// scale the velocity
	let newspeed = speed - drop;
	if ( newspeed < 0 )
		newspeed = 0;
	newspeed /= speed;

	vel[ 0 ] = vel[ 0 ] * newspeed;
	vel[ 1 ] = vel[ 1 ] * newspeed;
	vel[ 2 ] = vel[ 2 ] * newspeed;
}

/*
==============
PM_Accelerate
==============
*/
function PM_Accelerate( wishdir, wishspeed, accel ) {
	if ( pmove.dead )
		return;
	if ( pmove.waterjumptime > 0 )
		return;

	const currentspeed = DotProduct( pmove.velocity, wishdir );
	const addspeed = wishspeed - currentspeed;
	if ( addspeed <= 0 )
		return;

	let accelspeed = accel * frametime * wishspeed;
	if ( accelspeed > addspeed )
		accelspeed = addspeed;

	for ( let i = 0; i < 3; i++ )
		pmove.velocity[ i ] += accelspeed * wishdir[ i ];
}

/*
==============
PM_AirAccelerate
==============
*/
function PM_AirAccelerate( wishdir, wishspeed, accel ) {
	if ( pmove.dead )
		return;
	if ( pmove.waterjumptime > 0 )
		return;

	let wishspd = wishspeed;
	if ( wishspd > 30 )
		wishspd = 30;

	const currentspeed = DotProduct( pmove.velocity, wishdir );
	const addspeed = wishspd - currentspeed;
	if ( addspeed <= 0 )
		return;

	let accelspeed = accel * wishspeed * frametime;
	if ( accelspeed > addspeed )
		accelspeed = addspeed;

	for ( let i = 0; i < 3; i++ )
		pmove.velocity[ i ] += accelspeed * wishdir[ i ];
}

/*
===================
PM_WaterMove
===================
*/
function PM_WaterMove() {
	const wishvel = _pm_watermove_wishvel;

	// user intentions
	for ( let i = 0; i < 3; i++ )
		wishvel[ i ] = forward[ i ] * pmove.cmd.forwardmove + right[ i ] * pmove.cmd.sidemove;

	if ( pmove.cmd.forwardmove === 0 && pmove.cmd.sidemove === 0 && pmove.cmd.upmove === 0 )
		wishvel[ 2 ] -= 60; // drift towards bottom
	else
		wishvel[ 2 ] += pmove.cmd.upmove;

	const wishdir = _pm_watermove_wishdir;
	VectorCopy( wishvel, wishdir );
	let wishspeed = VectorNormalize( wishdir );

	if ( wishspeed > movevars.maxspeed ) {
		VectorScale( wishvel, movevars.maxspeed / wishspeed, wishvel );
		wishspeed = movevars.maxspeed;
	}
	wishspeed *= 0.7;

	// water acceleration
	PM_Accelerate( wishdir, wishspeed, movevars.wateraccelerate );

	// assume it is a stair or a slope, so press down from stepheight above
	const dest = _pm_watermove_dest;
	VectorMA( pmove.origin, frametime, pmove.velocity, dest );
	const start = _pm_watermove_start;
	VectorCopy( dest, start );
	start[ 2 ] += STEPSIZE + 1;

	const trace = PM_PlayerMove( start, dest );
	if ( ! trace.startsolid && ! trace.allsolid ) {
		// walked up the step
		VectorCopy( trace.endpos, pmove.origin );
		return;
	}

	PM_FlyMove();
}

/*
===================
PM_GroundMove

Player is on ground, with no upwards velocity
===================
*/
function PM_GroundMove() {
	pmove.velocity[ 2 ] = 0;
	if ( pmove.velocity[ 0 ] === 0 && pmove.velocity[ 1 ] === 0 && pmove.velocity[ 2 ] === 0 )
		return;

	// first try just moving to the destination
	const dest = _pm_groundmove_dest;
	dest[ 0 ] = pmove.origin[ 0 ] + pmove.velocity[ 0 ] * frametime;
	dest[ 1 ] = pmove.origin[ 1 ] + pmove.velocity[ 1 ] * frametime;
	dest[ 2 ] = pmove.origin[ 2 ];

	// first try moving directly to the next spot
	let trace = PM_PlayerMove( pmove.origin, dest );
	if ( trace.fraction === 1 ) {
		VectorCopy( trace.endpos, pmove.origin );
		return;
	}

	// try sliding forward both on ground and up 16 pixels
	// take the move that goes farthest
	const original = _pm_groundmove_original;
	const originalvel = _pm_groundmove_originalvel;
	VectorCopy( pmove.origin, original );
	VectorCopy( pmove.velocity, originalvel );

	// slide move
	PM_FlyMove();

	const down = _pm_groundmove_down;
	const downvel = _pm_groundmove_downvel;
	VectorCopy( pmove.origin, down );
	VectorCopy( pmove.velocity, downvel );

	VectorCopy( original, pmove.origin );
	VectorCopy( originalvel, pmove.velocity );

	// move up a stair height
	VectorCopy( pmove.origin, dest );
	dest[ 2 ] += STEPSIZE;
	trace = PM_PlayerMove( pmove.origin, dest );
	if ( ! trace.startsolid && ! trace.allsolid ) {
		VectorCopy( trace.endpos, pmove.origin );
	}

	// slide move
	PM_FlyMove();

	// press down the stepheight
	VectorCopy( pmove.origin, dest );
	dest[ 2 ] -= STEPSIZE;
	trace = PM_PlayerMove( pmove.origin, dest );
	if ( trace.plane.normal[ 2 ] < 0.7 ) {
		// use down move
		VectorCopy( down, pmove.origin );
		VectorCopy( downvel, pmove.velocity );
		return;
	}

	if ( ! trace.startsolid && ! trace.allsolid ) {
		VectorCopy( trace.endpos, pmove.origin );
	}

	const upMove = _pm_groundmove_up;
	VectorCopy( pmove.origin, upMove );

	// decide which one went farther
	const downdist = ( down[ 0 ] - original[ 0 ] ) * ( down[ 0 ] - original[ 0 ] )
		+ ( down[ 1 ] - original[ 1 ] ) * ( down[ 1 ] - original[ 1 ] );
	const updist = ( upMove[ 0 ] - original[ 0 ] ) * ( upMove[ 0 ] - original[ 0 ] )
		+ ( upMove[ 1 ] - original[ 1 ] ) * ( upMove[ 1 ] - original[ 1 ] );

	if ( downdist > updist ) {
		VectorCopy( down, pmove.origin );
		VectorCopy( downvel, pmove.velocity );
	} else {
		// copy z value from slide move
		pmove.velocity[ 2 ] = downvel[ 2 ];
	}
}

/*
===================
PM_AirMove
===================
*/
function PM_AirMove() {
	const fmove = pmove.cmd.forwardmove;
	const smove = pmove.cmd.sidemove;

	forward[ 2 ] = 0;
	right[ 2 ] = 0;
	VectorNormalize( forward );
	VectorNormalize( right );

	const wishvel = _pm_airmove_wishvel;
	for ( let i = 0; i < 2; i++ )
		wishvel[ i ] = forward[ i ] * fmove + right[ i ] * smove;
	wishvel[ 2 ] = 0;

	const wishdir = _pm_airmove_wishdir;
	VectorCopy( wishvel, wishdir );
	let wishspeed = VectorNormalize( wishdir );

	// clamp to server defined max speed
	if ( wishspeed > movevars.maxspeed ) {
		VectorScale( wishvel, movevars.maxspeed / wishspeed, wishvel );
		wishspeed = movevars.maxspeed;
	}

	if ( onground !== -1 ) {
		pmove.velocity[ 2 ] = 0;
		PM_Accelerate( wishdir, wishspeed, movevars.accelerate );
		pmove.velocity[ 2 ] -= movevars.entgravity * movevars.gravity * frametime;
		PM_GroundMove();
	} else {
		// not on ground, so little effect on velocity
		PM_AirAccelerate( wishdir, wishspeed, movevars.accelerate );

		// add gravity
		pmove.velocity[ 2 ] -= movevars.entgravity * movevars.gravity * frametime;

		PM_FlyMove();
	}
}

/*
=============
PM_CatagorizePosition
=============
*/
function PM_CatagorizePosition() {
	const point = _pm_catpos_point;

	// if the player hull point one unit down is solid, the player is on ground

	// see if standing on something solid
	point[ 0 ] = pmove.origin[ 0 ];
	point[ 1 ] = pmove.origin[ 1 ];
	point[ 2 ] = pmove.origin[ 2 ] - 1;

	if ( pmove.velocity[ 2 ] > 180 ) {
		onground = -1;
	} else {
		const tr = PM_PlayerMove( pmove.origin, point );
		if ( tr.plane.normal[ 2 ] < 0.7 )
			onground = -1; // too steep
		else
			onground = tr.ent;

		if ( onground !== -1 ) {
			pmove.waterjumptime = 0;
			if ( ! tr.startsolid && ! tr.allsolid )
				VectorCopy( tr.endpos, pmove.origin );
		}

		// standing on an entity other than the world
		if ( tr.ent > 0 ) {
			if ( pmove.numtouch < pmove.touchindex.length ) {
				pmove.touchindex[ pmove.numtouch ] = tr.ent;
				pmove.numtouch++;
			}
		}
	}

	// get waterlevel
	waterlevel = 0;
	watertype = CONTENTS_EMPTY;

	point[ 2 ] = pmove.origin[ 2 ] + player_mins[ 2 ] + 1;
	let cont = PM_PointContents( point );

	if ( cont <= CONTENTS_WATER ) {
		watertype = cont;
		waterlevel = 1;
		point[ 2 ] = pmove.origin[ 2 ] + ( player_mins[ 2 ] + player_maxs[ 2 ] ) * 0.5;
		cont = PM_PointContents( point );
		if ( cont <= CONTENTS_WATER ) {
			waterlevel = 2;
			point[ 2 ] = pmove.origin[ 2 ] + 22;
			cont = PM_PointContents( point );
			if ( cont <= CONTENTS_WATER )
				waterlevel = 3;
		}
	}
}

/*
=============
JumpButton
=============
*/
function JumpButton() {
	if ( pmove.dead ) {
		pmove.oldbuttons |= BUTTON_JUMP; // don't jump again until released
		return;
	}

	if ( pmove.waterjumptime > 0 ) {
		pmove.waterjumptime -= frametime;
		if ( pmove.waterjumptime < 0 )
			pmove.waterjumptime = 0;
		return;
	}

	if ( waterlevel >= 2 ) {
		// swimming, not jumping
		onground = -1;

		if ( watertype === CONTENTS_WATER )
			pmove.velocity[ 2 ] = 100;
		else if ( watertype === CONTENTS_SLIME )
			pmove.velocity[ 2 ] = 80;
		else
			pmove.velocity[ 2 ] = 50;
		return;
	}

	if ( onground === -1 )
		return; // in air, so no effect

	if ( pmove.oldbuttons & BUTTON_JUMP )
		return; // don't pogo stick

	onground = -1;
	pmove.velocity[ 2 ] += 270;

	pmove.oldbuttons |= BUTTON_JUMP; // don't jump again until released
}

/*
=============
CheckWaterJump
=============
*/
function CheckWaterJump() {
	if ( pmove.waterjumptime > 0 )
		return;

	// don't hop out if we just jumped in
	if ( pmove.velocity[ 2 ] < -180 )
		return;

	// see if near an edge
	const flatforward = _pm_waterjump_flatforward;
	flatforward[ 0 ] = forward[ 0 ];
	flatforward[ 1 ] = forward[ 1 ];
	flatforward[ 2 ] = 0;
	VectorNormalize( flatforward );

	const spot = _pm_waterjump_spot;
	VectorMA( pmove.origin, 24, flatforward, spot );
	spot[ 2 ] += 8;
	let cont = PM_PointContents( spot );
	if ( cont !== CONTENTS_SOLID )
		return;

	spot[ 2 ] += 24;
	cont = PM_PointContents( spot );
	if ( cont !== CONTENTS_EMPTY )
		return;

	// jump out of water
	VectorScale( flatforward, 50, pmove.velocity );
	pmove.velocity[ 2 ] = 310;
	pmove.waterjumptime = 2; // safety net
	pmove.oldbuttons |= BUTTON_JUMP; // don't jump again until released
}

/*
=================
NudgePosition

If pmove.origin is in a solid position,
try nudging slightly on all axis to
allow for the cut precision of the net coordinates
=================
*/
function NudgePosition() {
	const base = _pm_nudge_base;
	VectorCopy( pmove.origin, base );

	for ( let i = 0; i < 3; i++ )
		pmove.origin[ i ] = Math.floor( pmove.origin[ i ] * 8 ) * 0.125;

	const sign = [ 0, -1, 1 ];

	for ( let z = 0; z <= 2; z++ ) {
		for ( let x = 0; x <= 2; x++ ) {
			for ( let y = 0; y <= 2; y++ ) {
				pmove.origin[ 0 ] = base[ 0 ] + ( sign[ x ] * 1.0 / 8 );
				pmove.origin[ 1 ] = base[ 1 ] + ( sign[ y ] * 1.0 / 8 );
				pmove.origin[ 2 ] = base[ 2 ] + ( sign[ z ] * 1.0 / 8 );
				if ( PM_TestPlayerPosition( pmove.origin ) )
					return;
			}
		}
	}

	VectorCopy( base, pmove.origin );
}

/*
=============
SpectatorMove
=============
*/
function SpectatorMove() {
	// friction
	let speed = Length( pmove.velocity );
	if ( speed < 1 ) {
		pmove.velocity.fill( 0 );
	} else {
		const friction = movevars.friction * 1.5; // extra friction
		const control = speed < movevars.stopspeed ? movevars.stopspeed : speed;
		const drop = control * friction * frametime;

		// scale the velocity
		let newspeed = speed - drop;
		if ( newspeed < 0 )
			newspeed = 0;
		newspeed /= speed;

		VectorScale( pmove.velocity, newspeed, pmove.velocity );
	}

	// accelerate
	const fmove = pmove.cmd.forwardmove;
	const smove = pmove.cmd.sidemove;

	VectorNormalize( forward );
	VectorNormalize( right );

	const wishvel = _pm_spectator_wishvel;
	for ( let i = 0; i < 3; i++ )
		wishvel[ i ] = forward[ i ] * fmove + right[ i ] * smove;
	wishvel[ 2 ] += pmove.cmd.upmove;

	const wishdir = _pm_spectator_wishdir;
	VectorCopy( wishvel, wishdir );
	let wishspeed = VectorNormalize( wishdir );

	// clamp to server defined max speed
	if ( wishspeed > movevars.spectatormaxspeed ) {
		VectorScale( wishvel, movevars.spectatormaxspeed / wishspeed, wishvel );
		wishspeed = movevars.spectatormaxspeed;
	}

	const currentspeed = DotProduct( pmove.velocity, wishdir );
	const addspeed = wishspeed - currentspeed;
	if ( addspeed <= 0 )
		return;

	let accelspeed = movevars.accelerate * frametime * wishspeed;
	if ( accelspeed > addspeed )
		accelspeed = addspeed;

	for ( let i = 0; i < 3; i++ )
		pmove.velocity[ i ] += accelspeed * wishdir[ i ];

	// move
	VectorMA( pmove.origin, frametime, pmove.velocity, pmove.origin );
}

/*
=============
PlayerMove

Returns with origin, angles, and velocity modified in place.

Numtouch and touchindex[] will be set if any of the physents
were contacted during the move.
=============
*/
export function PlayerMove() {
	frametime = pmove.cmd.msec * 0.001;
	pmove.numtouch = 0;

	AngleVectors( pmove.angles, forward, right, up );

	if ( pmove.spectator ) {
		SpectatorMove();
		return;
	}

	NudgePosition();

	// take angles directly from command
	VectorCopy( pmove.cmd.angles, pmove.angles );

	// set onground, watertype, and waterlevel
	PM_CatagorizePosition();

	if ( waterlevel === 2 )
		CheckWaterJump();

	if ( pmove.velocity[ 2 ] < 0 )
		pmove.waterjumptime = 0;

	if ( pmove.cmd.buttons & BUTTON_JUMP )
		JumpButton();
	else
		pmove.oldbuttons &= ~BUTTON_JUMP;

	PM_Friction();

	if ( waterlevel >= 2 )
		PM_WaterMove();
	else
		PM_AirMove();

	// set onground, watertype, and waterlevel for final spot
	PM_CatagorizePosition();
}

/*
==============
Pmove_Init
==============
*/
export function Pmove_Init() {
	PM_InitBoxHull();
}
