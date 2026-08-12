// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const gl_model = await import( '../src/gl_model.js' );
const glquake = await import( '../src/glquake.js' );
const gl_warp = await import( '../src/gl_warp.js' );
const { Cmd_ExecuteString, src_command } = await import( '../src/cmd.js' );
const { Cvar_FindVar, Cvar_Set, Cvar_WriteVariables } = await import( '../src/cvar.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function makeModel() {

	const points = [
		[ - 96, - 96, 0 ], [ 96, - 96, 0 ],
		[ 96, 96, 0 ], [ - 96, 96, 0 ]
	];
	const vertexes = [ { position: new Float32Array( 3 ) } ];
	for ( const point of points ) vertexes.push( { position: new Float32Array( point ) } );

	return {
		vertexes: vertexes,
		edges: [ null,
			{ v: new Uint16Array( [ 1, 2 ] ) },
			{ v: new Uint16Array( [ 2, 3 ] ) },
			{ v: new Uint16Array( [ 3, 4 ] ) },
			{ v: new Uint16Array( [ 4, 1 ] ) }
		],
		surfedges: new Int32Array( [ 1, 2, 3, 4 ] )
	};

}

function makeSurface() {

	return {
		firstedge: 0,
		numedges: 4,
		polys: null,
		texinfo: {
			vecs: [
				new Float32Array( [ 1, 0, 0, 0 ] ),
				new Float32Array( [ 0, 1, 0, 0 ] )
			]
		}
	};

}

function countPolys( surface ) {

	let count = 0;
	for ( let poly = surface.polys; poly != null; poly = poly.next ) count ++;
	return count;

}

Deno.test( 'gl_subdivide_size console cvar controls surface subdivision', () => {

	const oldString = glquake.gl_subdivide_size.string;
	const registered = Cvar_FindVar( glquake.gl_subdivide_size.name );
	if ( registered == null ) gl_model.Mod_Init();
	else if ( registered !== glquake.gl_subdivide_size )
		throw new Error( 'gl_subdivide_size name is owned by another cvar' );

	try {

		assertEqual( Cvar_FindVar( 'gl_subdivide_size' ), glquake.gl_subdivide_size,
			'subdivision cvar identity' );
		assertEqual( glquake.gl_subdivide_size.archive, true, 'subdivision archive flag' );

		gl_warp.GL_Warp_SetLoadmodel( makeModel() );
		Cmd_ExecuteString( 'gl_subdivide_size "128"', src_command );
		const coarse = makeSurface();
		gl_warp.GL_SubdivideSurface( coarse );
		assertEqual( countPolys( coarse ), 4, '128-unit subdivision count' );

		Cmd_ExecuteString( 'gl_subdivide_size "64"', src_command );
		const fine = makeSurface();
		gl_warp.GL_SubdivideSurface( fine );
		assertEqual( countPolys( fine ), 16, '64-unit subdivision count' );
		assertEqual( glquake.gl_subdivide_size.value, 64, 'console subdivision value' );
		if ( Cvar_WriteVariables().includes( 'gl_subdivide_size "64"\n' ) === false )
			throw new Error( 'archived subdivision cvar was not written' );

	} finally {

		Cvar_Set( 'gl_subdivide_size', oldString );
		gl_warp.GL_Warp_SetLoadmodel( null );

	}

} );
