// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const cmd = await import( '../src/cmd.js' );
const { CL_Init } = await import( '../src/cl_main.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'client initialization registers all demo commands', () => {

	cmd.Cbuf_Init();
	cmd.Cmd_Init();
	CL_Init();

	for ( const command of [ 'record', 'stop', 'playdemo', 'timedemo' ] )
		assertEqual( cmd.Cmd_Exists( command ), true, `${command} command registration` );

} );
