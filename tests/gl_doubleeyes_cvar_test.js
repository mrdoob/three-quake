// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const gl_rmisc = await import( '../src/gl_rmisc.js' );
const glquake = await import( '../src/glquake.js' );
const { Cmd_ExecuteString, src_command } = await import( '../src/cmd.js' );
const { Cvar_FindVar, Cvar_Set } = await import( '../src/cvar.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'gl_doubleeyes keeps the original console spelling', () => {

	gl_rmisc.R_Init();
	const oldString = glquake.gl_doubleeyes.string;

	try {

		assertEqual( Cvar_FindVar( 'gl_doubleeys' ), glquake.gl_doubleeyes,
			'double-eyes cvar identity' );
		assertEqual( Cvar_FindVar( 'gl_doubleeyes' ), null,
			'noncanonical corrected spelling' );

		Cmd_ExecuteString( 'gl_doubleeys 0', src_command );
		assertEqual( glquake.gl_doubleeyes.value, 0, 'console-updated value' );

	} finally {

		Cvar_Set( 'gl_doubleeys', oldString );

	}

} );
