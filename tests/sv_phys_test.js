import { edict_t } from '../src/progs.js';
import {
	SV_AddGravity,
	SV_SetCallbacks,
	SV_SetFrametime,
	host_frametime,
	sv_gravity
} from '../src/sv_phys.js';

function assertNear( actual, expected, epsilon, message ) {

	if ( Number.isFinite( actual ) !== true || Math.abs( actual - expected ) > epsilon )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'SV_AddGravity reads a custom gravity field', () => {

	const gravityFieldOffset = 105;
	const entity = new edict_t( 1, gravityFieldOffset + 1 );
	const oldFrametime = host_frametime;
	const oldGravityValue = sv_gravity.value;
	let fieldExists = true;
	let requestedField = null;

	SV_SetCallbacks( {
		GetEdictFieldValue: ( ent, field ) => {

			requestedField = field;
			if ( fieldExists !== true )
				return null;
			return { accessor: ent._fieldAccessor, ofs: gravityFieldOffset };

		}
	} );

	try {

		sv_gravity.value = 800;
		SV_SetFrametime( 0.01 );

		entity._fieldAccessor.setFloat( gravityFieldOffset, 0.5 );
		entity.v.velocity[ 2 ] = 0;
		SV_AddGravity( entity );
		assertNear( entity.v.velocity[ 2 ], - 4, 0.00001, 'half gravity velocity' );

		entity._fieldAccessor.setFloat( gravityFieldOffset, 0 );
		entity.v.velocity[ 2 ] = 0;
		SV_AddGravity( entity );
		assertNear( entity.v.velocity[ 2 ], - 8, 0.00001, 'zero field default velocity' );

		fieldExists = false;
		entity.v.velocity[ 2 ] = 0;
		SV_AddGravity( entity );
		assertNear( entity.v.velocity[ 2 ], - 8, 0.00001, 'missing field default velocity' );

		if ( requestedField !== 'gravity' )
			throw new Error( `expected gravity lookup, got ${requestedField}` );

	} finally {

		SV_SetFrametime( oldFrametime );
		sv_gravity.value = oldGravityValue;

	}

} );
