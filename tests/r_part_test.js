// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const THREE = await import( 'three' );
const { cl } = await import( '../src/client.js' );
const glquake = await import( '../src/glquake.js' );
const {
	R_InitParticles, R_SetParticleExternals, R_ClearParticles,
	R_RocketTrail, R_DrawParticles
} = await import( '../src/r_part.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
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
