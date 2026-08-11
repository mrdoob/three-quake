// Ported from: WinQuake/progs.h -- program execution definitions

import { link_t } from './common.js';
import { entity_state_t } from './quakedef.js';
import {
	dprograms_t, dfunction_t, ddef_t, dstatement_t,
	DEF_SAVEGLOBAL,
	ev_void, ev_string, ev_float, ev_vector, ev_entity,
	ev_field, ev_function, ev_pointer,
	OFS_RETURN, OFS_PARM0,
} from './pr_comp.js';
import { entvars_t } from './progdefs.js';

export const MAX_ENT_LEAFS = 16;

//
// eval_t - union type for accessing progs data as different types
// In C this is a union of string, float, vector[3], function, int, edict.
// In JS we provide accessor helpers on the backing ArrayBuffer.
//

//
// EdictFieldAccessor - provides typed access to an ArrayBuffer region
// Used for both pr_globals and per-edict field data.
//
export class EdictFieldAccessor {

	constructor( buffer, byteOffset, length ) {

		// buffer: ArrayBuffer
		// byteOffset: starting byte offset
		// length: number of 32-bit slots
		this._buffer = buffer;
		this._byteOffset = byteOffset;
		this._length = length;
		this._floatView = new Float32Array( buffer, byteOffset, length );
		this._intView = new Int32Array( buffer, byteOffset, length );

	}

	getFloat( ofs ) {

		return this._floatView[ ofs ];

	}

	setFloat( ofs, v ) {

		this._floatView[ ofs ] = v;

	}

	getInt32( ofs ) {

		return this._intView[ ofs ];

	}

	setInt32( ofs, v ) {

		this._intView[ ofs ] = v;

	}

	getVector( ofs ) {

		return new Float32Array( this._buffer, this._byteOffset + ofs * 4, 3 );

	}

	setVector( ofs, v ) {

		this._floatView[ ofs ] = v[ 0 ];
		this._floatView[ ofs + 1 ] = v[ 1 ];
		this._floatView[ ofs + 2 ] = v[ 2 ];

	}

	// Clear a range of slots to zero
	clear( startOfs, count ) {

		for ( let i = 0; i < count; i ++ ) {

			this._intView[ startOfs + i ] = 0;

		}

	}

	// Clear all slots
	clearAll() {

		this._intView.fill( 0 );

	}

}

//
// edict_t - entity dictionary entry
//
export class edict_t {

	constructor( index, entityfields ) {

		this.index = index; // entity number (replaces pointer arithmetic)
		this.free = false;

		this.area = new link_t(); // linked to a division node or leaf

		this.num_leafs = 0;
		this.leafnums = new Int16Array( MAX_ENT_LEAFS );

		this.baseline = new entity_state_t();

		this.freetime = 0.0; // sv.time when the object was freed

		// Allocate field data backing buffer
		// entityfields is the number of int/float slots for the v (entvars) fields
		// Additional fields from progs come immediately after
		this._fieldBuffer = new ArrayBuffer( entityfields * 4 );
		this._fieldAccessor = new EdictFieldAccessor( this._fieldBuffer, 0, entityfields );

		// C exported fields from progs (entvars_t)
		this.v = new entvars_t( this._fieldAccessor );

		// Store entityfields count for clearing
		this._entityfields = entityfields;

	}

	// Clear entity variable fields (memset &e->v to 0)
	clearFields() {

		this._fieldAccessor.clearAll();

	}

}

//============================================================================
// Progs module state
//============================================================================

export let progs = null; // dprograms_t
export let pr_functions = null; // dfunction_t[]
export let pr_strings = ''; // string table (raw string data)
export let pr_strings_data = null; // Uint8Array of raw string bytes
export let pr_globaldefs = null; // ddef_t[]
export let pr_fielddefs = null; // ddef_t[]
export let pr_statements = null; // dstatement_t[]
export let pr_global_struct = null; // globalvars_t
export let pr_globals = null; // EdictFieldAccessor (same memory as pr_global_struct)
export let pr_globals_float = null; // Float32Array view on globals
export let pr_globals_int = null; // Int32Array view on globals

export let pr_edict_size = 0; // in bytes (C: sizeof edict_t fields portion)

export let pr_crc = 0;

// Temp string buffer for PF_ftos/PF_vtos (mirrors C's pr_string_temp[128])
// This is a fixed 128-byte region at the end of pr_strings_data that gets reused.
export let pr_string_temp_ofs = - 1;

// type_size[etype] - number of int/float slots per type
export const type_size = [ 1, 1, 1, 3, 1, 1, 1, 1 ];

//============================================================================
// Setter functions for module state (since we use export let)
//============================================================================

export function PR_SetProgs( p ) { progs = p; }
export function PR_SetFunctions( f ) { pr_functions = f; }
export function PR_SetStrings( s ) { pr_strings = s; }
export function PR_SetStringsData( d ) { pr_strings_data = d; }
export function PR_SetGlobalDefs( g ) { pr_globaldefs = g; }
export function PR_SetFieldDefs( f ) { pr_fielddefs = f; }
export function PR_SetStatements( s ) { pr_statements = s; }
export function PR_SetGlobalStruct( g ) { pr_global_struct = g; }
export function PR_SetGlobals( g ) { pr_globals = g; }
export function PR_SetGlobalsFloat( f ) { pr_globals_float = f; }
export function PR_SetGlobalsInt( i ) { pr_globals_int = i; }
export function PR_SetEdictSize( s ) { pr_edict_size = s; }
export function PR_SetCRC( c ) { pr_crc = c; }
export function PR_SetStringTempOfs( o ) { pr_string_temp_ofs = o; }

// Write a string into the fixed pr_string_temp area (128 bytes max).
// Returns the offset into pr_strings_data. Mirrors C's pr_string_temp usage.
export function PR_SetTempString( str ) {

	const maxLen = 127; // leave room for null terminator
	const len = Math.min( str.length, maxLen );
	for ( let i = 0; i < len; i ++ ) {

		pr_strings_data[ pr_string_temp_ofs + i ] = str.charCodeAt( i );

	}

	pr_strings_data[ pr_string_temp_ofs + len ] = 0; // null terminator
	return pr_string_temp_ofs;

}

//============================================================================
// Global access helper macros (ported as functions)
// These match the C macros: G_FLOAT, G_INT, G_VECTOR, G_STRING, etc.
//============================================================================

export function G_FLOAT( o ) {

	return pr_globals_float[ o ];

}

export function G_FLOAT_SET( o, v ) {

	pr_globals_float[ o ] = v;

}

export function G_INT( o ) {

	return pr_globals_int[ o ];

}

export function G_INT_SET( o, v ) {

	pr_globals_int[ o ] = v;

}

export function G_VECTOR( o ) {

	return new Float32Array( pr_globals_float.buffer, pr_globals_float.byteOffset + o * 4, 3 );

}

export function G_STRING( o ) {

	return PR_GetString( pr_globals_int[ o ] );

}

export function G_FUNCTION( o ) {

	return pr_globals_int[ o ];

}

//============================================================================
// String table helpers
//============================================================================

export function PR_GetString( ofs ) {

	if ( ofs < 0 || ofs >= pr_strings_data.length ) return '';

	let s = '';
	for ( let i = ofs; i < pr_strings_data.length; i ++ ) {

		if ( pr_strings_data[ i ] === 0 ) break;
		s += String.fromCharCode( pr_strings_data[ i ] );

	}

	return s;

}

//============================================================================
// Edict number <-> pointer helpers
// In C these use byte pointer arithmetic on sv.edicts.
// In JS we use an array of edict_t objects.
//============================================================================

// These are set by the server module
export let sv = null; // will reference the server state
export let svs = null; // will reference the persistent server state

export function PR_SetSV( s ) { sv = s; }
export function PR_SetSVS( s ) { svs = s; }

export function EDICT_NUM( n ) {

	if ( n < 0 || n >= sv.max_edicts ) {

		throw new Error( 'EDICT_NUM: bad number ' + n );

	}

	return sv.edicts[ n ];

}

export function NUM_FOR_EDICT( e ) {

	const n = e.index;

	if ( n < 0 || n >= sv.num_edicts ) {

		throw new Error( 'NUM_FOR_EDICT: bad pointer' );

	}

	return n;

}

export function NEXT_EDICT( e ) {

	return sv.edicts[ e.index + 1 ];

}

export function EDICT_TO_PROG( e ) {

	return e.index;

}

export function PROG_TO_EDICT( e ) {

	return sv.edicts[ e ];

}

//============================================================================
// Edict field access helpers (match C macros)
// E_FLOAT, E_INT, E_VECTOR, E_STRING
//============================================================================

export function E_FLOAT( e, o ) {

	return e._fieldAccessor.getFloat( o );

}

export function E_FLOAT_SET( e, o, v ) {

	e._fieldAccessor.setFloat( o, v );

}

export function E_INT( e, o ) {

	return e._fieldAccessor.getInt32( o );

}

export function E_INT_SET( e, o, v ) {

	e._fieldAccessor.setInt32( o, v );

}

export function E_VECTOR( e, o ) {

	return e._fieldAccessor.getVector( o );

}

export function E_STRING( e, o ) {

	return PR_GetString( e._fieldAccessor.getInt32( o ) );

}

//============================================================================
// G_EDICT, G_EDICTNUM - read edict from globals
//============================================================================

export function G_EDICT( o ) {

	return PROG_TO_EDICT( pr_globals_int[ o ] );

}

export function G_EDICTNUM( o ) {

	return NUM_FOR_EDICT( G_EDICT( o ) );

}

export function RETURN_EDICT( e ) {

	pr_globals_int[ OFS_RETURN ] = EDICT_TO_PROG( e );

}

//============================================================================
// Builtin function types
//============================================================================

export let pr_builtins = null; // Function[]
export let pr_numbuiltins = 0;

export function PR_SetBuiltins( b, n ) {

	pr_builtins = b;
	pr_numbuiltins = n;

}

export let pr_argc = 0;

export function PR_SetArgc( n ) { pr_argc = n; }

export let pr_trace = false;
export let pr_xfunction = null; // dfunction_t
export let pr_xstatement = 0;

export function PR_SetTrace( t ) { pr_trace = t; }
export function PR_SetXFunction( f ) { pr_xfunction = f; }
export function PR_SetXStatement( s ) { pr_xstatement = s; }
