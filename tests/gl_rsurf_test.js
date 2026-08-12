// Bootstrap the renderer's existing circular module graph in its safe order.
const gl_rsurf = await import( '../src/gl_rsurf.js' );

const gl_rmain = await import( '../src/gl_rmain.js' );
const { cl } = await import( '../src/client.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function makeFrame( name, animMin, animMax, diffuse ) {

	return {
		name: name,
		anim_total: 2,
		anim_min: animMin,
		anim_max: animMax,
		anim_next: null,
		alternate_anims: null,
		gl_texture: diffuse
	};

}

Deno.test( 'cached world materials advance animated textures', () => {

	const oldTime = cl.time;
	const oldCurrentEntity = gl_rmain.currententity;
	const fullbright = { name: 'fullbright' };
	const diffuse0 = { name: 'primary 0', _fullbright: null };
	const diffuse1 = { name: 'primary 1', _fullbright: fullbright };
	const diffuseA = { name: 'alternate 0', _fullbright: null };
	const diffuseB = { name: 'alternate 1', _fullbright: null };
	const primary0 = makeFrame( '+0', 0, 1, diffuse0 );
	const primary1 = makeFrame( '+1', 1, 2, diffuse1 );
	const alternate0 = makeFrame( '+A', 0, 1, diffuseA );
	const alternate1 = makeFrame( '+B', 1, 2, diffuseB );

	primary0.anim_next = primary1;
	primary1.anim_next = primary0;
	alternate0.anim_next = alternate1;
	alternate1.anim_next = alternate0;
	primary0.alternate_anims = alternate0;

	const emissive = {
		r: 0,
		g: 0,
		b: 0,
		setRGB( r, g, b ) {

			this.r = r;
			this.g = g;
			this.b = b;

		}
	};
	const material = {
		map: diffuse0,
		emissiveMap: null,
		emissive: emissive,
		needsUpdate: false
	};

	try {

		cl.time = 0.11;
		assertEqual( gl_rsurf.R_TextureAnimation( primary0, 0 ), primary1,
			'primary animation frame' );
		assertEqual( gl_rsurf.R_TextureAnimation( primary0, 1 ), alternate1,
			'alternate animation frame' );

		gl_rmain.set_currententity( { frame: 1 } );
		assertEqual( gl_rsurf.R_TextureAnimation( primary0 ), alternate1,
			'current entity alternate frame' );
		assertEqual( gl_rsurf.R_TextureAnimation( primary0, 0 ), primary1,
			'explicit world frame override' );

		assertEqual( gl_rsurf.R_UpdateAnimatedMaterial( material, primary0, 0 ), true,
			'primary material update' );
		assertEqual( material.map, diffuse1, 'advanced diffuse map' );
		assertEqual( material.emissiveMap, fullbright, 'advanced fullbright map' );
		assertEqual( material.emissive.r, 1, 'fullbright emissive red' );
		assertEqual( material.emissive.g, 1, 'fullbright emissive green' );
		assertEqual( material.emissive.b, 1, 'fullbright emissive blue' );
		assertEqual( material.needsUpdate, true, 'fullbright shader update' );

		material.needsUpdate = false;
		assertEqual( gl_rsurf.R_UpdateAnimatedMaterial( material, primary0, 0 ), false,
			'unchanged material update' );
		assertEqual( material.needsUpdate, false, 'unchanged shader state' );

		cl.time = 0.01;
		assertEqual( gl_rsurf.R_UpdateAnimatedMaterial( material, primary0, 0 ), true,
			'wrapped material update' );
		assertEqual( material.map, diffuse0, 'wrapped diffuse map' );
		assertEqual( material.emissiveMap, null, 'cleared fullbright map' );
		assertEqual( material.emissive.r, 0, 'cleared emissive red' );
		assertEqual( material.emissive.g, 0, 'cleared emissive green' );
		assertEqual( material.emissive.b, 0, 'cleared emissive blue' );
		assertEqual( material.needsUpdate, true, 'cleared fullbright shader update' );

	} finally {

		cl.time = oldTime;
		gl_rmain.set_currententity( oldCurrentEntity );

	}

} );
