import { ED_Alloc, PR_AllocEdicts } from '../src/pr_edict.js';
import { PR_SetSV, PR_SetSVS, sv as progs_sv, svs as progs_svs } from '../src/progs.js';

Deno.test( 'ED_Alloc never reuses reserved client edicts', () => {

	const oldSV = progs_sv;
	const oldSVS = progs_svs;
	const server = {
		max_edicts: 10,
		num_edicts: 6,
		time: 10,
		edicts: PR_AllocEdicts( 10, 105 )
	};
	const serverStatic = { maxclients: 4 };

	server.edicts[ 2 ].free = true;
	server.edicts[ 2 ].freetime = 0;
	server.edicts[ 5 ].free = true;
	server.edicts[ 5 ].freetime = 0;

	try {

		PR_SetSV( server );
		PR_SetSVS( serverStatic );

		const allocated = ED_Alloc();
		if ( allocated.index !== 5 )
			throw new Error( `expected edict 5, got ${allocated.index}` );
		if ( server.edicts[ 2 ].free !== true )
			throw new Error( 'reserved client edict 2 was reused' );
		if ( server.edicts[ 5 ].free !== false )
			throw new Error( 'allocated edict 5 was not activated' );
		if ( server.num_edicts !== 6 )
			throw new Error( `expected 6 edicts, got ${server.num_edicts}` );

	} finally {

		PR_SetSV( oldSV );
		PR_SetSVS( oldSVS );

	}

} );
