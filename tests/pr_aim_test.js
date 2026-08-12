import { CONTENTS_EMPTY } from '../src/bspfile.js';
import { PR_InitBuiltins } from '../src/pr_cmds.js';
import { OFS_PARM0, OFS_RETURN } from '../src/pr_comp.js';
import { PR_AllocEdicts } from '../src/pr_edict.js';
import {
	pr_builtins, pr_numbuiltins, pr_global_struct,
	pr_globals_float, pr_globals_int, sv as progs_sv,
	PR_SetBuiltins, PR_SetGlobalStruct, PR_SetGlobalsFloat, PR_SetGlobalsInt, PR_SetSV,
} from '../src/progs.js';
import {
	MOVETYPE_PUSH, SOLID_BBOX, SOLID_BSP, sv, teamplay,
} from '../src/server.js';
import { sv_aim } from '../src/sv_main.js';
import { SV_ClearWorld, SV_LinkEdict } from '../src/world.js';

function assertNear( actual, expected, epsilon, message ) {

	if ( Number.isFinite( actual ) !== true || Math.abs( actual - expected ) > epsilon )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function configureTarget( ent, origin, team ) {

	ent.v.origin.set( origin );
	ent.v.mins.set( [ - 16, - 16, - 24 ] );
	ent.v.maxs.set( [ 16, 16, 32 ] );
	ent.v.solid = SOLID_BBOX;
	ent.v.takedamage = 2;
	ent.v.team = team;

}

Deno.test( 'PF_aim filters teammates with the engine teamplay cvar', () => {

	const oldBuiltins = pr_builtins;
	const oldNumBuiltins = pr_numbuiltins;
	const oldGlobalStruct = pr_global_struct;
	const oldGlobalsFloat = pr_globals_float;
	const oldGlobalsInt = pr_globals_int;
	const oldProgsSV = progs_sv;
	const oldEdicts = sv.edicts;
	const oldNumEdicts = sv.num_edicts;
	const oldMaxEdicts = sv.max_edicts;
	const oldModels = sv.models;
	const oldWorldmodel = sv.worldmodel;
	const oldTeamplayString = teamplay.string;
	const oldTeamplayValue = teamplay.value;
	const oldAimString = sv_aim.string;
	const oldAimValue = sv_aim.value;

	const globalsBuffer = new ArrayBuffer( 64 * 4 );
	const globalsFloat = new Float32Array( globalsBuffer );
	const globalsInt = new Int32Array( globalsBuffer );
	const qcGlobals = {
		v_forward: new Float32Array( [ 1, 0, 0 ] ),
		teamplay: 0,
	};
	const emptyHull = {
		firstclipnode: CONTENTS_EMPTY,
		lastclipnode: CONTENTS_EMPTY,
		clipnodes: [],
		planes: [],
		clip_mins: new Float32Array( 3 ),
	};
	const worldmodel = {
		type: 0,
		hulls: [ emptyHull, emptyHull, emptyHull ],
		mins: new Float32Array( [ - 4096, - 4096, - 4096 ] ),
		maxs: new Float32Array( [ 4096, 4096, 4096 ] ),
	};

	try {

		sv.edicts = PR_AllocEdicts( 4, 105 );
		sv.num_edicts = 4;
		sv.max_edicts = 4;
		sv.models = new Array( 256 ).fill( null );
		sv.models[ 1 ] = worldmodel;
		sv.worldmodel = worldmodel;
		PR_SetSV( sv );

		const world = sv.edicts[ 0 ];
		const shooter = sv.edicts[ 1 ];
		const teammate = sv.edicts[ 2 ];
		const enemy = sv.edicts[ 3 ];
		world.v.solid = SOLID_BSP;
		world.v.movetype = MOVETYPE_PUSH;
		world.v.modelindex = 1;
		shooter.v.team = 1;
		configureTarget( teammate, [ 128, 0, 0 ], 1 );
		configureTarget( enemy, [ 128, 16, 64 ], 2 );

		SV_ClearWorld();
		SV_LinkEdict( teammate, false );
		SV_LinkEdict( enemy, false );

		PR_SetGlobalStruct( qcGlobals );
		PR_SetGlobalsFloat( globalsFloat );
		PR_SetGlobalsInt( globalsInt );
		globalsInt[ OFS_PARM0 ] = 1;
		PR_InitBuiltins();
		sv_aim.string = '0.9';
		sv_aim.value = 0.9;

		teamplay.string = '1';
		teamplay.value = 1;
		qcGlobals.teamplay = 0;
		pr_builtins[ 44 ]();
		assertNear( globalsFloat[ OFS_RETURN ], 0.89442719, 0.000001, 'team aim X' );
		assertNear( globalsFloat[ OFS_RETURN + 1 ], 0, 0.000001, 'team aim Y' );
		assertNear( globalsFloat[ OFS_RETURN + 2 ], 0.4472136, 0.000001, 'team aim Z' );

		teamplay.string = '0';
		teamplay.value = 0;
		qcGlobals.teamplay = 1;
		globalsFloat.fill( 0, OFS_RETURN, OFS_RETURN + 3 );
		globalsInt[ OFS_PARM0 ] = 1;
		pr_builtins[ 44 ]();
		assertNear( globalsFloat[ OFS_RETURN ], 1, 0.000001, 'free aim X' );
		assertNear( globalsFloat[ OFS_RETURN + 1 ], 0, 0.000001, 'free aim Y' );
		assertNear( globalsFloat[ OFS_RETURN + 2 ], 0, 0.000001, 'free aim Z' );

	} finally {

		PR_SetBuiltins( oldBuiltins, oldNumBuiltins );
		PR_SetGlobalStruct( oldGlobalStruct );
		PR_SetGlobalsFloat( oldGlobalsFloat );
		PR_SetGlobalsInt( oldGlobalsInt );
		PR_SetSV( oldProgsSV );
		sv.edicts = oldEdicts;
		sv.num_edicts = oldNumEdicts;
		sv.max_edicts = oldMaxEdicts;
		sv.models = oldModels;
		sv.worldmodel = oldWorldmodel;
		SV_ClearWorld();
		teamplay.string = oldTeamplayString;
		teamplay.value = oldTeamplayValue;
		sv_aim.string = oldAimString;
		sv_aim.value = oldAimValue;

	}

} );
