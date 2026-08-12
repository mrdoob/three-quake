// Bootstrap the renderer's existing circular module graph in its safe order.
const gl_rsurf = await import( '../src/gl_rsurf.js' );

const glquake = await import( '../src/glquake.js' );
const gl_rmain = await import( '../src/gl_rmain.js' );
const gl_rlight = await import( '../src/gl_rlight.js' );
const { cl, cl_dlights } = await import( '../src/client.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'dynamic light marks use the renderer frame counter', () => {

	const oldFrame = gl_rmain.r_framecount;
	const oldFlashblend = glquake.gl_flashblend.value;
	const oldTime = cl.time;
	const oldWorldmodel = cl.worldmodel;
	const oldLights = cl_dlights.map( ( light ) => ( {
		die: light.die,
		radius: light.radius,
		origin: new Float32Array( light.origin )
	} ) );

	try {

		const surface = { dlightframe: - 1, dlightbits: 0x80 };
		const leaf0 = { contents: - 1 };
		const leaf1 = { contents: - 1 };
		const root = {
			contents: 0,
			plane: {
				normal: new Float32Array( [ 1, 0, 0 ] ),
				dist: 0
			},
			firstsurface: 0,
			numsurfaces: 1,
			children: [ leaf0, leaf1 ]
		};

		cl.time = 10;
		cl.worldmodel = { nodes: [ root ], surfaces: [ surface ] };
		glquake.gl_flashblend.value = 0;
		for ( const light of cl_dlights ) {

			light.die = 0;
			light.radius = 0;

		}

		cl_dlights[ 0 ].die = 11;
		cl_dlights[ 0 ].radius = 64;
		cl_dlights[ 0 ].origin.fill( 0 );

		gl_rmain.set_r_framecount( 41 );
		gl_rlight.R_PushDlights( cl );

		assertEqual( glquake.r_framecount, 41, 'shared pre-frame count' );
		assertEqual( gl_rlight.r_dlightframecount, 42, 'dynamic-light frame' );
		assertEqual( surface.dlightframe, 42, 'marked surface frame' );
		assertEqual( surface.dlightbits, 1, 'marked surface bits' );

		assertEqual( gl_rmain.inc_r_framecount(), 42, 'advanced renderer frame' );
		assertEqual( gl_rmain.r_framecount, 42, 'renderer frame binding' );
		assertEqual( glquake.r_framecount, 42, 'shared frame binding' );
		assertEqual( surface.dlightframe, gl_rmain.r_framecount,
			'mark consumed by the rendered frame' );

	} finally {

		gl_rmain.set_r_framecount( oldFrame );
		glquake.gl_flashblend.value = oldFlashblend;
		cl.time = oldTime;
		cl.worldmodel = oldWorldmodel;
		for ( let i = 0; i < cl_dlights.length; i ++ ) {

			cl_dlights[ i ].die = oldLights[ i ].die;
			cl_dlights[ i ].radius = oldLights[ i ].radius;
			cl_dlights[ i ].origin.set( oldLights[ i ].origin );

		}

	}

} );

Deno.test( 'inline brush models receive dynamic light marks', () => {

	const oldFrame = gl_rmain.r_framecount;
	const oldBrushPolys = gl_rmain.c_brush_polys;
	const oldFlashblend = glquake.gl_flashblend.value;
	const oldTime = cl.time;
	const oldWorldmodel = cl.worldmodel;
	const oldLights = cl_dlights.map( ( light ) => ( {
		die: light.die,
		radius: light.radius,
		origin: new Float32Array( light.origin )
	} ) );

	try {

		const leaf0 = { contents: - 1 };
		const leaf1 = { contents: - 1 };
		const plane = {
			normal: new Float32Array( [ 1, 0, 0 ] ),
			dist: 0
		};
		const worldSurface = { dlightframe: - 1, dlightbits: 0 };
		const worldRoot = {
			contents: 0,
			plane: plane,
			firstsurface: 0,
			numsurfaces: 1,
			children: [ leaf0, leaf1 ]
		};
		const brushSurface = {
			flags: gl_rmain.SURF_DRAWSKY,
			dlightframe: - 7,
			dlightbits: 0x80
		};
		const brushRoot = {
			contents: 0,
			plane: plane,
			firstsurface: 1,
			numsurfaces: 1,
			children: [ leaf0, leaf1 ]
		};
		const brushGroup = {
			children: [],
			parent: { remove() {} },
			position: { set() {} },
			quaternion: { identity() {}, setFromEuler() {} }
		};
		const model = {
			mins: new Float32Array( [ - 1, - 1, - 1 ] ),
			maxs: new Float32Array( [ 1, 1, 1 ] ),
			radius: 2,
			firstmodelsurface: 1,
			nummodelsurfaces: 1,
			nodes: [ brushRoot ],
			hulls: [ { firstclipnode: 0 } ],
			surfaces: [ null, brushSurface ]
		};
		const entity = {
			origin: new Float32Array( 3 ),
			angles: new Float32Array( 3 ),
			frame: 0,
			model: model,
			_brushGroup: brushGroup,
			_brushGroupFrame: 0,
			_brushAnimSurfaces: null
		};

		cl.time = 10;
		cl.worldmodel = { nodes: [ worldRoot ], surfaces: [ worldSurface ] };
		glquake.gl_flashblend.value = 0;
		for ( const light of cl_dlights ) {

			light.die = 0;
			light.radius = 0;

		}

		cl_dlights[ 0 ].die = 11;
		cl_dlights[ 0 ].radius = 64;
		cl_dlights[ 0 ].origin.fill( 0 );

		gl_rmain.set_r_framecount( 41 );
		gl_rlight.R_PushDlights( cl );
		gl_rmain.inc_r_framecount();
		gl_rsurf.R_DrawBrushModel( entity );

		assertEqual( brushSurface.dlightframe, 42, 'brush surface frame' );
		assertEqual( brushSurface.dlightbits, 1, 'brush surface bits' );

	} finally {

		gl_rmain.set_r_framecount( oldFrame );
		gl_rmain.set_c_brush_polys( oldBrushPolys );
		glquake.gl_flashblend.value = oldFlashblend;
		cl.time = oldTime;
		cl.worldmodel = oldWorldmodel;
		for ( let i = 0; i < cl_dlights.length; i ++ ) {

			cl_dlights[ i ].die = oldLights[ i ].die;
			cl_dlights[ i ].radius = oldLights[ i ].radius;
			cl_dlights[ i ].origin.set( oldLights[ i ].origin );

		}

	}

} );
