import { PR_ExecuteProgram, PR_RunError, PR_SetHostError } from '../src/pr_exec.js';
import {
	progs, pr_global_struct, pr_statements, pr_xstatement,
	PR_SetProgs, PR_SetGlobalStruct, PR_SetStatements, PR_SetXStatement,
} from '../src/progs.js';

function expectHostError( action, expectedMessage ) {

	const sentinel = new Error( 'Host_Error sentinel' );
	let actualMessage = null;
	let caught = null;

	const oldHostError = PR_SetHostError( ( message ) => {

		actualMessage = message;
		throw sentinel;

	} );

	try {

		action();

	} catch ( error ) {

		caught = error;

	} finally {

		PR_SetHostError( oldHostError );

	}

	if ( caught !== sentinel )
		throw new Error( `expected Host_Error sentinel, got ${caught}` );
	if ( actualMessage !== expectedMessage )
		throw new Error( `expected ${expectedMessage}, got ${actualMessage}` );

}

Deno.test( 'QuakeC runtime failures use Host_Error', () => {

	const oldProgs = progs;
	const oldGlobalStruct = pr_global_struct;
	const oldStatements = pr_statements;
	const oldXStatement = pr_xstatement;

	try {

		PR_SetStatements( [ { op: 0, a: 0, b: 0, c: 0 } ] );
		PR_SetXStatement( 0 );
		expectHostError(
			() => PR_RunError( 'bad opcode %i', 99 ),
			'Program error'
		);

		PR_SetProgs( { numfunctions: 1 } );
		PR_SetGlobalStruct( { self: 0 } );
		expectHostError(
			() => PR_ExecuteProgram( 0 ),
			'PR_ExecuteProgram: NULL function'
		);

	} finally {

		PR_SetProgs( oldProgs );
		PR_SetGlobalStruct( oldGlobalStruct );
		PR_SetStatements( oldStatements );
		PR_SetXStatement( oldXStatement );

	}

} );
