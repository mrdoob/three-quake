// Ported from: WinQuake/pr_exec.c -- QuakeC bytecode interpreter

import { Sys_Error } from './sys.js';
import { Con_Printf } from './common.js';
import {
	progs, pr_functions, pr_strings_data,
	pr_globaldefs, pr_fielddefs, pr_statements,
	pr_global_struct, pr_globals, pr_globals_float, pr_globals_int,
	type_size,
	PR_GetString,
	EDICT_NUM, NUM_FOR_EDICT, EDICT_TO_PROG, PROG_TO_EDICT,
	sv,
	pr_builtins, pr_numbuiltins,
	pr_argc, PR_SetArgc,
	pr_trace, pr_xfunction, pr_xstatement,
	PR_SetTrace, PR_SetXFunction, PR_SetXStatement,
} from './progs.js';
import {
	OFS_NULL, OFS_RETURN, OFS_PARM0,
	OP_DONE, OP_MUL_F, OP_MUL_V, OP_MUL_FV, OP_MUL_VF,
	OP_DIV_F, OP_ADD_F, OP_ADD_V, OP_SUB_F, OP_SUB_V,
	OP_EQ_F, OP_EQ_V, OP_EQ_S, OP_EQ_E, OP_EQ_FNC,
	OP_NE_F, OP_NE_V, OP_NE_S, OP_NE_E, OP_NE_FNC,
	OP_LE, OP_GE, OP_LT, OP_GT,
	OP_LOAD_F, OP_LOAD_V, OP_LOAD_S, OP_LOAD_ENT, OP_LOAD_FLD, OP_LOAD_FNC,
	OP_ADDRESS,
	OP_STORE_F, OP_STORE_V, OP_STORE_S, OP_STORE_ENT, OP_STORE_FLD, OP_STORE_FNC,
	OP_STOREP_F, OP_STOREP_V, OP_STOREP_S, OP_STOREP_ENT, OP_STOREP_FLD, OP_STOREP_FNC,
	OP_RETURN, OP_NOT_F, OP_NOT_V, OP_NOT_S, OP_NOT_ENT, OP_NOT_FNC,
	OP_IF, OP_IFNOT,
	OP_CALL0, OP_CALL1, OP_CALL2, OP_CALL3, OP_CALL4,
	OP_CALL5, OP_CALL6, OP_CALL7, OP_CALL8,
	OP_STATE, OP_GOTO, OP_AND, OP_OR,
	OP_BITAND, OP_BITOR,
} from './pr_comp.js';
import { ED_Print } from './pr_edict.js';

/*
*/

const MAX_STACK_DEPTH = 32;
const LOCALSTACK_SIZE = 2048;

const pr_stack = new Array( MAX_STACK_DEPTH );
for ( let i = 0; i < MAX_STACK_DEPTH; i ++ )
	pr_stack[ i ] = { s: 0, f: null };

let pr_depth = 0;

const localstack = new Int32Array( LOCALSTACK_SIZE );
let localstack_used = 0;

let Host_Error = null;

export function PR_SetHostError( callback ) {

	const previous = Host_Error;
	Host_Error = callback;
	return previous;

}

export function PR_HostError( error ) {

	if ( Host_Error === null )
		Sys_Error( 'PR_HostError: Host_Error callback not set' );

	Host_Error( error );
	Sys_Error( 'PR_HostError: Host_Error returned' );

}

const pr_opnames = [
	'DONE',
	'MUL_F', 'MUL_V', 'MUL_FV', 'MUL_VF',
	'DIV',
	'ADD_F', 'ADD_V',
	'SUB_F', 'SUB_V',
	'EQ_F', 'EQ_V', 'EQ_S', 'EQ_E', 'EQ_FNC',
	'NE_F', 'NE_V', 'NE_S', 'NE_E', 'NE_FNC',
	'LE', 'GE', 'LT', 'GT',
	'INDIRECT', 'INDIRECT', 'INDIRECT', 'INDIRECT', 'INDIRECT', 'INDIRECT',
	'ADDRESS',
	'STORE_F', 'STORE_V', 'STORE_S', 'STORE_ENT', 'STORE_FLD', 'STORE_FNC',
	'STOREP_F', 'STOREP_V', 'STOREP_S', 'STOREP_ENT', 'STOREP_FLD', 'STOREP_FNC',
	'RETURN',
	'NOT_F', 'NOT_V', 'NOT_S', 'NOT_ENT', 'NOT_FNC',
	'IF', 'IFNOT',
	'CALL0', 'CALL1', 'CALL2', 'CALL3', 'CALL4', 'CALL5', 'CALL6', 'CALL7', 'CALL8',
	'STATE',
	'GOTO',
	'AND', 'OR',
	'BITAND', 'BITOR',
];

//=============================================================================

/*
=================
PR_PrintStatement
=================
*/
export function PR_PrintStatement( s ) {

	let line = '';

	if ( s.op < pr_opnames.length ) {

		line += pr_opnames[ s.op ];
		while ( line.length < 10 )
			line += ' ';

	}

	if ( s.op === OP_IF || s.op === OP_IFNOT ) {

		line += PR_GlobalString( s.a ) + 'branch ' + s.b;

	} else if ( s.op === OP_GOTO ) {

		line += 'branch ' + s.a;

	} else if ( s.op >= OP_STORE_F && s.op <= OP_STORE_FNC ) {

		line += PR_GlobalString( s.a );
		line += PR_GlobalStringNoContents( s.b );

	} else {

		if ( s.a !== 0 )
			line += PR_GlobalString( s.a );
		if ( s.b !== 0 )
			line += PR_GlobalString( s.b );
		if ( s.c !== 0 )
			line += PR_GlobalStringNoContents( s.c );

	}

	Con_Printf( '%s\n', line );

}

// Forward references to pr_edict.js functions for printing
// (used by PR_PrintStatement but defined in pr_edict.js)
function PR_GlobalString( ofs ) {

	// Simple fallback - will be overridden by imports if needed
	return ofs + ' ';

}

function PR_GlobalStringNoContents( ofs ) {

	return ofs + ' ';

}

/*
============
PR_StackTrace
============
*/
export function PR_StackTrace() {

	if ( pr_depth === 0 ) {

		Con_Printf( '<NO STACK>\n' );
		return;

	}

	pr_stack[ pr_depth ].f = pr_xfunction;

	for ( let i = pr_depth; i >= 0; i -- ) {

		const f = pr_stack[ i ].f;

		if ( ! f ) {

			Con_Printf( '<NO FUNCTION>\n' );

		} else {

			Con_Printf( '%12s : %s\n', PR_GetString( f.s_file ), PR_GetString( f.s_name ) );

		}

	}

}

/*
============
PR_Profile_f
============
*/
export function PR_Profile_f() {

	let num = 0;

	do {

		let max = 0;
		let best = null;

		for ( let i = 0; i < progs.numfunctions; i ++ ) {

			const f = pr_functions[ i ];
			if ( f.profile > max ) {

				max = f.profile;
				best = f;

			}

		}

		if ( best ) {

			if ( num < 10 )
				Con_Printf( '%7i %s\n', best.profile, PR_GetString( best.s_name ) );
			num ++;
			best.profile = 0;

		}

	} while ( best );

}

/*
============
PR_RunError

Aborts the currently executing function
============
*/
export function PR_RunError( error, ...args ) {

	let message = error;
	// Simple sprintf-like formatting
	for ( const arg of args ) {

		message = message.replace( /%[disf]/, String( arg ) );

	}

	PR_PrintStatement( pr_statements[ pr_xstatement ] );
	PR_StackTrace();
	Con_Printf( '%s\n', message );

	pr_depth = 0; // dump the stack so host_error can shutdown functions

	PR_HostError( 'Program error' );

}

/*
============================================================================
PR_ExecuteProgram

The interpretation main loop
============================================================================
*/

/*
====================
PR_EnterFunction

Returns the new program statement counter
====================
*/
export function PR_EnterFunction( f ) {

	pr_stack[ pr_depth ].s = pr_xstatement;
	pr_stack[ pr_depth ].f = pr_xfunction;
	pr_depth ++;

	if ( pr_depth >= MAX_STACK_DEPTH )
		PR_RunError( 'stack overflow' );

	// save off any locals that the new function steps on
	const c = f.locals;
	if ( localstack_used + c > LOCALSTACK_SIZE )
		PR_RunError( 'PR_ExecuteProgram: locals stack overflow\n' );

	for ( let i = 0; i < c; i ++ )
		localstack[ localstack_used + i ] = pr_globals_int[ f.parm_start + i ];
	localstack_used += c;

	// copy parameters
	let o = f.parm_start;
	for ( let i = 0; i < f.numparms; i ++ ) {

		for ( let j = 0; j < f.parm_size[ i ]; j ++ ) {

			pr_globals_int[ o ] = pr_globals_int[ OFS_PARM0 + i * 3 + j ];
			o ++;

		}

	}

	PR_SetXFunction( f );
	return f.first_statement - 1; // offset the s++

}

/*
====================
PR_LeaveFunction
====================
*/
export function PR_LeaveFunction() {

	if ( pr_depth <= 0 )
		Sys_Error( 'prog stack underflow' );

	// restore locals from the stack
	const c = pr_xfunction.locals;
	localstack_used -= c;
	if ( localstack_used < 0 )
		PR_RunError( 'PR_ExecuteProgram: locals stack underflow\n' );

	for ( let i = 0; i < c; i ++ )
		pr_globals_int[ pr_xfunction.parm_start + i ] = localstack[ localstack_used + i ];

	// up stack
	pr_depth --;
	PR_SetXFunction( pr_stack[ pr_depth ].f );
	return pr_stack[ pr_depth ].s;

}

/*
====================
PR_ExecuteProgram
====================
*/
export function PR_ExecuteProgram( fnum ) {

	let s;
	let st;
	let runaway;
	let exitdepth;

	if ( fnum === 0 || fnum >= progs.numfunctions ) {

		if ( pr_global_struct.self !== 0 )
			ED_Print( PROG_TO_EDICT( pr_global_struct.self ) );
		PR_HostError( 'PR_ExecuteProgram: NULL function' );

	}

	const f = pr_functions[ fnum ];

	runaway = 100000;
	PR_SetTrace( false );

	// make a stack frame
	exitdepth = pr_depth;

	s = PR_EnterFunction( f );

	// Cached references to typed views for performance
	const gf = pr_globals_float;
	const gi = pr_globals_int;

	while ( true ) {

		s ++; // next statement

		st = pr_statements[ s ];

		const stA = st.a;
		const stB = st.b;
		const stC = st.c;

		if ( ! -- runaway )
			PR_RunError( 'runaway loop error' );

		pr_xfunction.profile ++;
		PR_SetXStatement( s );

		if ( pr_trace )
			PR_PrintStatement( st );

		switch ( st.op ) {

			case OP_ADD_F:
				gf[ stC ] = gf[ stA ] + gf[ stB ];
				break;
			case OP_ADD_V:
				gf[ stC ] = gf[ stA ] + gf[ stB ];
				gf[ stC + 1 ] = gf[ stA + 1 ] + gf[ stB + 1 ];
				gf[ stC + 2 ] = gf[ stA + 2 ] + gf[ stB + 2 ];
				break;

			case OP_SUB_F:
				gf[ stC ] = gf[ stA ] - gf[ stB ];
				break;
			case OP_SUB_V:
				gf[ stC ] = gf[ stA ] - gf[ stB ];
				gf[ stC + 1 ] = gf[ stA + 1 ] - gf[ stB + 1 ];
				gf[ stC + 2 ] = gf[ stA + 2 ] - gf[ stB + 2 ];
				break;

			case OP_MUL_F:
				gf[ stC ] = gf[ stA ] * gf[ stB ];
				break;
			case OP_MUL_V:
				gf[ stC ] = gf[ stA ] * gf[ stB ]
					+ gf[ stA + 1 ] * gf[ stB + 1 ]
					+ gf[ stA + 2 ] * gf[ stB + 2 ];
				break;
			case OP_MUL_FV:
				gf[ stC ] = gf[ stA ] * gf[ stB ];
				gf[ stC + 1 ] = gf[ stA ] * gf[ stB + 1 ];
				gf[ stC + 2 ] = gf[ stA ] * gf[ stB + 2 ];
				break;
			case OP_MUL_VF:
				gf[ stC ] = gf[ stB ] * gf[ stA ];
				gf[ stC + 1 ] = gf[ stB ] * gf[ stA + 1 ];
				gf[ stC + 2 ] = gf[ stB ] * gf[ stA + 2 ];
				break;

			case OP_DIV_F:
				gf[ stC ] = gf[ stA ] / gf[ stB ];
				break;

			case OP_BITAND:
				gf[ stC ] = ( gf[ stA ] | 0 ) & ( gf[ stB ] | 0 );
				break;

			case OP_BITOR:
				gf[ stC ] = ( gf[ stA ] | 0 ) | ( gf[ stB ] | 0 );
				break;

			case OP_GE:
				gf[ stC ] = gf[ stA ] >= gf[ stB ] ? 1 : 0;
				break;
			case OP_LE:
				gf[ stC ] = gf[ stA ] <= gf[ stB ] ? 1 : 0;
				break;
			case OP_GT:
				gf[ stC ] = gf[ stA ] > gf[ stB ] ? 1 : 0;
				break;
			case OP_LT:
				gf[ stC ] = gf[ stA ] < gf[ stB ] ? 1 : 0;
				break;
			case OP_AND:
				gf[ stC ] = ( gf[ stA ] !== 0 && gf[ stB ] !== 0 ) ? 1 : 0;
				break;
			case OP_OR:
				gf[ stC ] = ( gf[ stA ] !== 0 || gf[ stB ] !== 0 ) ? 1 : 0;
				break;

			case OP_NOT_F:
				gf[ stC ] = ( gf[ stA ] === 0 ) ? 1 : 0;
				break;
			case OP_NOT_V:
				gf[ stC ] = ( gf[ stA ] === 0 && gf[ stA + 1 ] === 0 && gf[ stA + 2 ] === 0 ) ? 1 : 0;
				break;
			case OP_NOT_S:
				gf[ stC ] = ( gi[ stA ] === 0 || pr_strings_data[ gi[ stA ] ] === 0 ) ? 1 : 0;
				break;
			case OP_NOT_FNC:
				gf[ stC ] = ( gi[ stA ] === 0 ) ? 1 : 0;
				break;
			case OP_NOT_ENT:
				gf[ stC ] = ( gi[ stA ] === 0 ) ? 1 : 0;
				// C: (PROG_TO_EDICT(a->edict) == sv.edicts)
				// edict index 0 is the world entity
				break;

			case OP_EQ_F:
				gf[ stC ] = ( gf[ stA ] === gf[ stB ] ) ? 1 : 0;
				break;
			case OP_EQ_V:
				gf[ stC ] = ( gf[ stA ] === gf[ stB ]
					&& gf[ stA + 1 ] === gf[ stB + 1 ]
					&& gf[ stA + 2 ] === gf[ stB + 2 ] ) ? 1 : 0;
				break;
			case OP_EQ_S:
				gf[ stC ] = ( PR_GetString( gi[ stA ] ) === PR_GetString( gi[ stB ] ) ) ? 1 : 0;
				break;
			case OP_EQ_E:
				gf[ stC ] = ( gi[ stA ] === gi[ stB ] ) ? 1 : 0;
				break;
			case OP_EQ_FNC:
				gf[ stC ] = ( gi[ stA ] === gi[ stB ] ) ? 1 : 0;
				break;

			case OP_NE_F:
				gf[ stC ] = ( gf[ stA ] !== gf[ stB ] ) ? 1 : 0;
				break;
			case OP_NE_V:
				gf[ stC ] = ( gf[ stA ] !== gf[ stB ]
					|| gf[ stA + 1 ] !== gf[ stB + 1 ]
					|| gf[ stA + 2 ] !== gf[ stB + 2 ] ) ? 1 : 0;
				break;
			case OP_NE_S:
				gf[ stC ] = ( PR_GetString( gi[ stA ] ) !== PR_GetString( gi[ stB ] ) ) ? 1 : 0;
				break;
			case OP_NE_E:
				gf[ stC ] = ( gi[ stA ] !== gi[ stB ] ) ? 1 : 0;
				break;
			case OP_NE_FNC:
				gf[ stC ] = ( gi[ stA ] !== gi[ stB ] ) ? 1 : 0;
				break;

			//==================
			case OP_STORE_F:
			case OP_STORE_ENT:
			case OP_STORE_FLD: // integers
			case OP_STORE_S:
			case OP_STORE_FNC: // pointers
				gi[ stB ] = gi[ stA ];
				break;
			case OP_STORE_V:
				gi[ stB ] = gi[ stA ];
				gi[ stB + 1 ] = gi[ stA + 1 ];
				gi[ stB + 2 ] = gi[ stA + 2 ];
				break;

			case OP_STOREP_F:
			case OP_STOREP_ENT:
			case OP_STOREP_FLD: // integers
			case OP_STOREP_S:
			case OP_STOREP_FNC: { // pointers

				// b->_int is an edict index + field offset encoded
				// In C: ptr = (eval_t *)((byte *)sv.edicts + b->_int);
				// In JS: we encode as { edictIndex, fieldOfs }
				const addr = gi[ stB ];
				const edictIndex = ( addr >> 16 ) & 0xFFFF;
				const fieldOfs = addr & 0xFFFF;
				const ed = sv.edicts[ edictIndex ];
				ed._fieldAccessor.setInt32( fieldOfs, gi[ stA ] );
				break;

			}

			case OP_STOREP_V: {

				const addr = gi[ stB ];
				const edictIndex = ( addr >> 16 ) & 0xFFFF;
				const fieldOfs = addr & 0xFFFF;
				const ed = sv.edicts[ edictIndex ];
				ed._fieldAccessor.setInt32( fieldOfs, gi[ stA ] );
				ed._fieldAccessor.setInt32( fieldOfs + 1, gi[ stA + 1 ] );
				ed._fieldAccessor.setInt32( fieldOfs + 2, gi[ stA + 2 ] );
				break;

			}

			case OP_ADDRESS: {

				const ed = PROG_TO_EDICT( gi[ stA ] );
				// Encode edict index and field offset into a single int
				// b->_int is the field offset within the edict
				gi[ stC ] = ( ed.index << 16 ) | ( gi[ stB ] & 0xFFFF );
				break;

			}

			case OP_LOAD_F:
			case OP_LOAD_FLD:
			case OP_LOAD_ENT:
			case OP_LOAD_S:
			case OP_LOAD_FNC: {

				const ed = PROG_TO_EDICT( gi[ stA ] );
				gi[ stC ] = ed._fieldAccessor.getInt32( gi[ stB ] );
				break;

			}

			case OP_LOAD_V: {

				const ed = PROG_TO_EDICT( gi[ stA ] );
				const fieldOfs = gi[ stB ];
				gf[ stC ] = ed._fieldAccessor.getFloat( fieldOfs );
				gf[ stC + 1 ] = ed._fieldAccessor.getFloat( fieldOfs + 1 );
				gf[ stC + 2 ] = ed._fieldAccessor.getFloat( fieldOfs + 2 );
				break;

			}

			//==================

			case OP_IFNOT:
				if ( gi[ stA ] === 0 )
					s += stB - 1; // offset the s++
				break;

			case OP_IF:
				if ( gi[ stA ] !== 0 )
					s += stB - 1; // offset the s++
				break;

			case OP_GOTO:
				s += stA - 1; // offset the s++
				break;

			case OP_CALL0:
			case OP_CALL1:
			case OP_CALL2:
			case OP_CALL3:
			case OP_CALL4:
			case OP_CALL5:
			case OP_CALL6:
			case OP_CALL7:
			case OP_CALL8: {

				PR_SetArgc( st.op - OP_CALL0 );

				if ( ! gi[ stA ] )
					PR_RunError( 'NULL function' );

				const newf = pr_functions[ gi[ stA ] ];

				if ( newf.first_statement < 0 ) {

					// negative statements are built in functions
					const i = - newf.first_statement;
					if ( i >= pr_numbuiltins )
						PR_RunError( 'Bad builtin call number' );
					pr_builtins[ i ]();
					break;

				}

				s = PR_EnterFunction( newf );
				break;

			}

			case OP_DONE:
			case OP_RETURN:
				gi[ OFS_RETURN ] = gi[ stA ];
				gi[ OFS_RETURN + 1 ] = gi[ stA + 1 ];
				gi[ OFS_RETURN + 2 ] = gi[ stA + 2 ];

				s = PR_LeaveFunction();
				if ( pr_depth === exitdepth )
					return; // all done
				break;

			case OP_STATE: {

				const ed = PROG_TO_EDICT( pr_global_struct.self );
				ed.v.nextthink = pr_global_struct.time + 0.1;
				if ( gf[ stA ] !== ed.v.frame ) {

					ed.v.frame = gf[ stA ];

				}

				ed.v.think = gi[ stB ];
				break;

			}

			default:
				PR_RunError( 'Bad opcode %i', st.op );

		}

	}

}
