import { PR_ExecuteProgram, PR_SetHostError } from '../src/pr_exec.js';
import { OP_ADDRESS, OP_DONE } from '../src/pr_comp.js';
import { ss_active, ss_loading } from '../src/server.js';
import {
	progs, pr_functions, pr_strings_data, pr_statements,
	pr_globals_float, pr_globals_int, pr_trace, pr_xfunction, pr_xstatement, sv,
	PR_SetProgs, PR_SetFunctions, PR_SetStringsData, PR_SetStatements,
	PR_SetGlobalsFloat, PR_SetGlobalsInt, PR_SetTrace,
	PR_SetXFunction, PR_SetXStatement, PR_SetSV,
} from '../src/progs.js';

Deno.test( 'OP_ADDRESS rejects assignments to the active world entity', () => {

	const oldProgs = progs;
	const oldFunctions = pr_functions;
	const oldStringsData = pr_strings_data;
	const oldStatements = pr_statements;
	const oldGlobalsFloat = pr_globals_float;
	const oldGlobalsInt = pr_globals_int;
	const oldTrace = pr_trace;
	const oldXFunction = pr_xfunction;
	const oldXStatement = pr_xstatement;
	const oldSV = sv;

	const globalsBuffer = new ArrayBuffer( 64 * 4 );
	const globalsFloat = new Float32Array( globalsBuffer );
	const globalsInt = new Int32Array( globalsBuffer );
	const world = { index: 0 };
	const entity = { index: 1 };
	const server = { active: true, state: ss_loading, edicts: [ world, entity ] };
	const testFunction = {
		first_statement: 0,
		parm_start: 0,
		locals: 0,
		profile: 0,
		s_name: 0,
		s_file: 0,
		numparms: 0,
		parm_size: [],
	};

	const entityGlobal = 28;
	const fieldGlobal = 29;
	const addressGlobal = 30;
	globalsInt[ entityGlobal ] = 0;
	globalsInt[ fieldGlobal ] = 7;

	try {

		PR_SetProgs( { numfunctions: 2 } );
		PR_SetFunctions( [ null, testFunction ] );
		PR_SetStringsData( new Uint8Array( [ 0 ] ) );
		PR_SetStatements( [
			{ op: OP_ADDRESS, a: entityGlobal, b: fieldGlobal, c: addressGlobal },
			{ op: OP_DONE, a: 0, b: 0, c: 0 },
		] );
		PR_SetGlobalsFloat( globalsFloat );
		PR_SetGlobalsInt( globalsInt );
		PR_SetSV( server );

		PR_ExecuteProgram( 1 );
		if ( globalsInt[ addressGlobal ] !== 7 )
			throw new Error( 'world address was blocked while the server was loading' );

		server.state = ss_active;
		globalsInt[ entityGlobal ] = 1;
		globalsInt[ addressGlobal ] = 0;
		PR_ExecuteProgram( 1 );
		if ( globalsInt[ addressGlobal ] !== ( ( 1 << 16 ) | 7 ) )
			throw new Error( 'active non-world address was blocked' );

		globalsInt[ entityGlobal ] = 0;
		globalsInt[ addressGlobal ] = 0x12345678;
		const sentinel = new Error( 'Host_Error sentinel' );
		let hostMessage = null;
		let caught = null;
		const oldHostError = PR_SetHostError( ( message ) => {

			hostMessage = message;
			throw sentinel;

		} );

		try {

			PR_ExecuteProgram( 1 );

		} catch ( error ) {

			caught = error;

		} finally {

			PR_SetHostError( oldHostError );

		}

		if ( caught !== sentinel )
			throw new Error( `expected Host_Error sentinel, got ${caught}` );
		if ( hostMessage !== 'Program error' )
			throw new Error( `expected Program error, got ${hostMessage}` );
		if ( globalsInt[ addressGlobal ] !== 0x12345678 )
			throw new Error( 'active world address was written before the error' );

	} finally {

		PR_SetProgs( oldProgs );
		PR_SetFunctions( oldFunctions );
		PR_SetStringsData( oldStringsData );
		PR_SetStatements( oldStatements );
		PR_SetGlobalsFloat( oldGlobalsFloat );
		PR_SetGlobalsInt( oldGlobalsInt );
		PR_SetTrace( oldTrace );
		PR_SetXFunction( oldXFunction );
		PR_SetXStatement( oldXStatement );
		PR_SetSV( oldSV );

	}

} );
