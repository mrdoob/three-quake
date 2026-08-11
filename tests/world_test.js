import { CONTENTS_EMPTY, CONTENTS_SOLID } from '../src/bspfile.js';
import { SV_RecursiveHullCheck, trace_t } from '../src/world.js';

function assertNear( actual, expected, epsilon, message ) {

	if ( Number.isFinite( actual ) !== true || Math.abs( actual - expected ) > epsilon )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'SV_RecursiveHullCheck supports hulls deeper than the scratch pool', () => {

	const nodeCount = 64;
	const planes = [];
	const clipnodes = [];

	for ( let i = 0; i < nodeCount; i ++ ) {

		planes.push( {
			type: 0,
			dist: 90 - i,
			normal: new Float32Array( [ 1, 0, 0 ] )
		} );
		clipnodes.push( {
			planenum: i,
			children: new Int16Array( [ CONTENTS_EMPTY, i === nodeCount - 1 ? CONTENTS_SOLID : i + 1 ] )
		} );

	}

	const hull = {
		firstclipnode: 0,
		lastclipnode: nodeCount - 1,
		clipnodes: clipnodes,
		planes: planes
	};
	const start = new Float32Array( [ 100, 0, 0 ] );
	const end = new Float32Array( [ - 100, 0, 0 ] );
	const trace = new trace_t();
	trace.fraction = 1;
	trace.allsolid = true;
	trace.endpos.set( end );

	const clear = SV_RecursiveHullCheck(
		hull,
		hull.firstclipnode,
		0,
		1,
		start,
		end,
		trace
	);

	if ( clear !== false )
		throw new Error( 'expected the trace to hit the final solid leaf' );
	if ( trace.allsolid !== false )
		throw new Error( 'expected the trace to pass through empty space' );
	if ( trace.inopen !== true || trace.startsolid !== false )
		throw new Error( 'expected an open-to-solid trace' );
	assertNear( trace.endpos[ 0 ], 27.03125, 0.00001, 'impact position' );
	assertNear( trace.fraction, 0.36484375, 0.00001, 'impact fraction' );
	assertNear( trace.plane.normal[ 0 ], 1, 0.00001, 'impact plane normal' );
	assertNear( trace.plane.dist, 27, 0.00001, 'impact plane distance' );

} );
