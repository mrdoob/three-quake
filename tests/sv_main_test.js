import { sv as progs_sv, PR_SetSV, edict_t } from '../src/progs.js';
import { svc_sound } from '../src/protocol.js';
import { sv } from '../src/server.js';
import { SV_StartSound } from '../src/sv_main.js';

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'SV_StartSound encodes the source edict index', () => {

	const oldProgsSV = progs_sv;
	const oldNumEdicts = sv.num_edicts;
	const oldMaxEdicts = sv.max_edicts;
	const oldSound1 = sv.sound_precache[ 1 ];
	const oldSound2 = sv.sound_precache[ 2 ];
	const oldDatagramData = sv.datagram.data;
	const oldDatagramMaxsize = sv.datagram.maxsize;
	const oldDatagramCursize = sv.datagram.cursize;
	const oldDatagramAllowoverflow = sv.datagram.allowoverflow;
	const oldDatagramOverflowed = sv.datagram.overflowed;

	try {

		PR_SetSV( sv );
		sv.num_edicts = 8;
		sv.max_edicts = 600;
		sv.sound_precache[ 1 ] = 'test/entity.wav';
		sv.sound_precache[ 2 ] = null;
		sv.datagram.data = new Uint8Array( sv.datagram_buf.length );
		sv.datagram.maxsize = sv.datagram_buf.length;
		sv.datagram.cursize = 0;
		sv.datagram.allowoverflow = true;
		sv.datagram.overflowed = false;

		const entity = new edict_t( 7, 105 );
		SV_StartSound( entity, 3, 'test/entity.wav', 255, 1 );

		const data = sv.datagram.data;
		const packedChannel = data[ 2 ] | ( data[ 3 ] << 8 );
		assertEqual( sv.datagram.cursize, 11, 'sound packet size' );
		assertEqual( data[ 0 ], svc_sound, 'service opcode' );
		assertEqual( data[ 1 ], 0, 'optional field mask' );
		assertEqual( packedChannel >> 3, 7, 'encoded entity index' );
		assertEqual( packedChannel & 7, 3, 'encoded sound channel' );
		assertEqual( data[ 4 ], 1, 'sound precache index' );

	} finally {

		PR_SetSV( oldProgsSV );
		sv.num_edicts = oldNumEdicts;
		sv.max_edicts = oldMaxEdicts;
		sv.sound_precache[ 1 ] = oldSound1;
		sv.sound_precache[ 2 ] = oldSound2;
		sv.datagram.data = oldDatagramData;
		sv.datagram.maxsize = oldDatagramMaxsize;
		sv.datagram.cursize = oldDatagramCursize;
		sv.datagram.allowoverflow = oldDatagramAllowoverflow;
		sv.datagram.overflowed = oldDatagramOverflowed;

	}

} );
