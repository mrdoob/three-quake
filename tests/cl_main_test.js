// Bootstrap the client renderer graph in its established safe import order.
await import( '../src/gl_rsurf.js' );

const { CL_ClearState } = await import( '../src/cl_main.js' );
const { Mod_FindName, mod_brush, mod_alias } = await import( '../src/gl_model.js' );
const { sv } = await import( '../src/server.js' );
const { cls } = await import( '../src/client.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'remote client state changes invalidate map-owned models', () => {

	const brush = Mod_FindName( '__test_remote_clear_brush.bsp' );
	const alias = Mod_FindName( '__test_remote_clear_alias.mdl' );
	const oldActive = sv.active;
	const oldSignon = cls.signon;
	const oldBrushType = brush.type;
	const oldBrushNeedload = brush.needload;
	const oldAliasType = alias.type;
	const oldAliasNeedload = alias.needload;

	try {

		brush.type = mod_brush;
		brush.needload = false;
		alias.type = mod_alias;
		alias.needload = false;
		sv.active = false;
		cls.signon = 4;

		CL_ClearState();
		assertEqual( brush.needload, true, 'remote brush invalidation' );
		assertEqual( alias.needload, false, 'remote alias cache retention' );
		assertEqual( cls.signon, 0, 'remote host memory clear' );

		brush.needload = false;
		sv.active = true;
		cls.signon = 3;

		CL_ClearState();
		assertEqual( brush.needload, false, 'local brush cache retention' );
		assertEqual( cls.signon, 3, 'local host memory retention' );

	} finally {

		sv.active = oldActive;
		cls.signon = oldSignon;
		brush.type = oldBrushType;
		brush.needload = oldBrushNeedload;
		alias.type = oldAliasType;
		alias.needload = oldAliasNeedload;

	}

} );
