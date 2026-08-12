// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const gl_rmain = await import( '../src/gl_rmain.js' );
const glquake = await import( '../src/glquake.js' );
const chase = await import( '../src/chase.js' );
const cvar = await import( '../src/cvar.js' );
const { cl } = await import( '../src/client.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'viewmodel uses the registered chase camera cvar', () => {

	let registered = cvar.Cvar_FindVar( 'chase_active' );
	if ( registered === null ) {

		cvar.Cvar_RegisterVariable( chase.chase_active );
		registered = cvar.Cvar_FindVar( 'chase_active' );

	}

	assertEqual( gl_rmain.chase_active, chase.chase_active,
		'renderer chase cvar binding' );
	assertEqual( registered, chase.chase_active, 'registered chase cvar binding' );

	const oldChaseString = chase.chase_active.string;
	const oldDrawViewmodel = glquake.r_drawviewmodel.value;
	const oldDrawEntities = glquake.r_drawentities.value;
	const oldItems = cl.items;
	const oldHealth = cl.stats[ 0 ];
	const oldViewent = cl.viewent;
	const oldCurrententity = gl_rmain.currententity;
	let modelReads = 0;

	try {

		glquake.r_drawviewmodel.value = 1;
		glquake.r_drawentities.value = 1;
		cl.items = 0;
		cl.stats[ 0 ] = 100;
		cl.viewent = {};
		Object.defineProperty( cl.viewent, 'model', {
			get() { modelReads ++; return null; }
		} );

		cvar.Cvar_Set( 'chase_active', '1' );
		gl_rmain.R_DrawViewModel();
		assertEqual( modelReads, 0, 'chase viewmodel suppression' );

		cvar.Cvar_Set( 'chase_active', '0' );
		gl_rmain.R_DrawViewModel();
		assertEqual( modelReads, 1, 'first-person viewmodel lookup' );

	} finally {

		cvar.Cvar_Set( 'chase_active', oldChaseString );
		glquake.r_drawviewmodel.value = oldDrawViewmodel;
		glquake.r_drawentities.value = oldDrawEntities;
		cl.items = oldItems;
		cl.stats[ 0 ] = oldHealth;
		cl.viewent = oldViewent;
		gl_rmain.set_currententity( oldCurrententity );

	}

} );
