// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const THREE = await import( 'three' );
const { cl } = await import( '../src/client.js' );
const glquake = await import( '../src/glquake.js' );
const { sv_gravity } = await import( '../src/sv_phys.js' );
const {
	Cvar_FindVar, Cvar_RegisterVariable, Cvar_Set
} = await import( '../src/cvar.js' );
const {
	R_InitParticles, R_SetParticleExternals, R_ClearParticles,
	R_RocketTrail, R_DrawParticles
} = await import( '../src/r_part.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function assertNear( actual, expected, message, epsilon = 1e-6 ) {

	if ( Number.isFinite( actual ) === false || Math.abs( actual - expected ) > epsilon )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'particle physics stays frozen at zero client-time delta', () => {

	const oldTime = cl.time;
	const oldOldtime = cl.oldtime;
	const oldTextures = glquake._allGameTextures.slice();
	const scene = new THREE.Scene();

	try {

		R_InitParticles();
		R_SetParticleExternals( { scene: scene } );
		cl.time = 10;
		cl.oldtime = 10;
		R_RocketTrail(
			new Float32Array( [ 0, 0, 0 ] ),
			new Float32Array( [ 2, 0, 0 ] ),
			3
		);

		R_DrawParticles();
		assertEqual( scene.children.length, 1, 'paused particle remains visible' );
		const positions = scene.children[ 0 ].geometry.attributes.position.array;
		const pausedX = positions[ 0 ];
		const pausedY = positions[ 1 ];
		const pausedZ = positions[ 2 ];

		R_DrawParticles();
		assertEqual( positions[ 0 ], pausedX, 'paused particle x' );
		assertEqual( positions[ 1 ], pausedY, 'paused particle y' );
		assertEqual( positions[ 2 ], pausedZ, 'paused particle z' );

		cl.oldtime = 9.9;
		R_DrawParticles();
		R_DrawParticles();
		if ( positions[ 0 ] === pausedX && positions[ 1 ] === pausedY && positions[ 2 ] === pausedZ )
			throw new Error( 'particle did not resume after client time advanced' );

	} finally {

		R_ClearParticles();
		R_DrawParticles();
		cl.time = oldTime;
		cl.oldtime = oldOldtime;
		glquake._allGameTextures.splice(
			0, glquake._allGameTextures.length, ...oldTextures
		);

	}

} );

Deno.test( 'particles read live gravity from the registered cvar', () => {

	const oldTime = cl.time;
	const oldOldtime = cl.oldtime;
	const oldGravity = sv_gravity.string;
	const oldTextures = glquake._allGameTextures.slice();
	const scene = new THREE.Scene();

	try {

		const registeredGravity = Cvar_FindVar( 'sv_gravity' );
		if ( registeredGravity == null ) Cvar_RegisterVariable( sv_gravity );
		assertEqual( Cvar_FindVar( 'sv_gravity' ), sv_gravity, 'gravity cvar identity' );

		R_InitParticles();
		R_SetParticleExternals( { scene: scene, sv_gravity: sv_gravity } );
		Cvar_Set( 'sv_gravity', '0' );
		cl.time = 10;
		cl.oldtime = 9.9;
		R_RocketTrail(
			new Float32Array( [ 0, 0, 0 ] ),
			new Float32Array( [ 2, 0, 0 ] ),
			2
		);

		R_DrawParticles();
		const positions = scene.children[ 0 ].geometry.attributes.position.array;
		const startZ = positions[ 2 ];
		R_DrawParticles();
		assertNear( positions[ 2 ], startZ, 'zero-gravity particle height' );

		Cvar_Set( 'sv_gravity', '200' );
		R_DrawParticles();
		assertNear( positions[ 2 ], startZ, 'gravity applies after current draw' );
		R_DrawParticles();
		assertNear( positions[ 2 ], startZ, 'gravity movement renders on the next draw' );
		R_DrawParticles();
		assertNear( positions[ 2 ], startZ - 0.1, 'live gravity particle height' );

	} finally {

		R_ClearParticles();
		R_DrawParticles();
		Cvar_Set( 'sv_gravity', oldGravity );
		cl.time = oldTime;
		cl.oldtime = oldOldtime;
		glquake._allGameTextures.splice(
			0, glquake._allGameTextures.length, ...oldTextures
		);

	}

} );
