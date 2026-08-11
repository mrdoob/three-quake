import { Cmd_ExecuteString, src_command } from '../src/cmd.js';
import { Cvar_FindVar, Cvar_RegisterVariable, Cvar_Set } from '../src/cvar.js';
import { sv_edgefriction } from '../src/sv_phys.js';

Deno.test( 'edgefriction console cvar updates the movement setting', () => {

	const oldString = sv_edgefriction.string;
	const registered = Cvar_FindVar( sv_edgefriction.name );

	if ( registered === null )
		Cvar_RegisterVariable( sv_edgefriction );
	else if ( registered !== sv_edgefriction )
		throw new Error( 'edgefriction name is owned by another cvar' );

	if ( Cvar_FindVar( 'edgefriction' ) !== sv_edgefriction )
		throw new Error( 'edgefriction is not the registered movement cvar' );

	try {

		if ( Cvar_FindVar( 'sv_edgefriction' ) !== null )
			throw new Error( 'obsolete sv_edgefriction cvar is still registered' );

		Cmd_ExecuteString( 'edgefriction 1.25', src_command );
		if ( sv_edgefriction.value !== 1.25 )
			throw new Error( `expected edge friction 1.25, got ${sv_edgefriction.value}` );

	} finally {

		Cvar_Set( sv_edgefriction.name, oldString );

	}

} );
