import { CONTENTS_EMPTY, CONTENTS_SOLID } from '../src/bspfile.js';
import { pmove, PM_HullPointContents, PM_PlayerMove } from '../src/pmove.js';

function assertNear( actual, expected, epsilon, message ) {

	if ( Number.isFinite( actual ) !== true || Math.abs( actual - expected ) > epsilon )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'PM_PlayerMove keeps backed-up fraction aligned with endpos', () => {

	// The root divides on X. Each child then collides at a slightly different
	// Y plane, forcing the recursive trace to back its impact point out of solid.
	const hull = {
		firstclipnode: 0,
		lastclipnode: 2,
		clipnodes: [
			{ planenum: 0, children: new Int16Array( [ 1, 2 ] ) },
			{ planenum: 1, children: new Int16Array( [ CONTENTS_EMPTY, CONTENTS_SOLID ] ) },
			{ planenum: 2, children: new Int16Array( [ CONTENTS_EMPTY, CONTENTS_SOLID ] ) },
		],
		planes: [
			{
				type: 0,
				dist: 0,
				normal: new Float32Array( [ 1, 0, 0 ] ),
			},
			{
				type: 1,
				dist: Math.fround( - 9.3 ),
				normal: new Float32Array( [ 0, 1, 0 ] ),
			},
			{
				type: 1,
				dist: Math.fround( - 9.43125 ),
				normal: new Float32Array( [ 0, 1, 0 ] ),
			},
		],
	};

	const pe = pmove.physents[ 0 ];
	const oldNumPhysent = pmove.numphysent;
	const oldModel = pe.model;
	const oldOrigin = pe.origin.slice();

	try {

		pmove.numphysent = 1;
		pe.origin.fill( 0 );
		pe.model = { hulls: [ null, hull ] };

		const start = new Float32Array( [ 1, 10, 0 ] );
		const end = new Float32Array( [ - 0.01, - 10, 0 ] );
		const trace = PM_PlayerMove( start, end );

		if ( trace.startsolid === true || trace.allsolid === true )
			throw new Error( 'expected an ordinary empty-to-solid trace' );

		assertNear(
			trace.fraction,
			0.9618316608252936,
			0.000001,
			'backed-up fraction'
		);

		for ( let i = 0; i < 3; i ++ ) {

			const implied = start[ i ] + trace.fraction * ( end[ i ] - start[ i ] );
			assertNear(
				trace.endpos[ i ],
				implied,
				0.000001,
				`fraction/endpos axis ${i}`
			);

		}

		if ( PM_HullPointContents( hull, hull.firstclipnode, trace.endpos ) !== CONTENTS_EMPTY )
			throw new Error( 'backed-up end position remained solid' );

	} finally {

		pmove.numphysent = oldNumPhysent;
		pe.model = oldModel;
		pe.origin.set( oldOrigin );

	}

} );
