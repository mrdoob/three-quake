// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const gl_model = await import( '../src/gl_model.js' );
const glquake = await import( '../src/glquake.js' );
const gl_rsurf = await import( '../src/gl_rsurf.js' );
const THREE = await import( 'three' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function makeTexture( name ) {

	return {
		name: name,
		disposals: 0,
		generateMipmaps: false,
		needsUpdate: false,
		dispose() { this.disposals ++; }
	};

}

Deno.test( 'model clearing disposes only map-owned Three textures', () => {

	const brush = gl_model.Mod_FindName( '__test_texture_owner.bsp' );
	const sprite = gl_model.Mod_FindName( '__test_texture_owner.spr' );
	const alias = gl_model.Mod_FindName( '__test_texture_owner.mdl' );
	const brushDescriptors = Object.getOwnPropertyDescriptors( brush );
	const spriteDescriptors = Object.getOwnPropertyDescriptors( sprite );
	const aliasDescriptors = Object.getOwnPropertyDescriptors( alias );
	const oldRegistry = glquake._allGameTextures.slice();
	const oldTextureMode = glquake.gl_texturemode.value;
	const base = makeTexture( 'brush base' );
	const fullbright = makeTexture( 'brush fullbright' );
	const spriteTexture = makeTexture( 'sprite' );
	const solidSky = makeTexture( 'solid sky' );
	const alphaSky = makeTexture( 'alpha sky' );
	const aliasTexture = makeTexture( 'alias' );
	const particleTexture = makeTexture( 'particle' );
	base._fullbright = fullbright;

	try {

		glquake._allGameTextures.length = 0;
		for ( const texture of [ base, fullbright, spriteTexture, aliasTexture, particleTexture ] )
			glquake.GL_RegisterTexture( texture );

		brush.type = gl_model.mod_brush;
		brush.needload = false;
		brush.textures = [ { gl_texture: base } ];
		brush._threeTextures = new Set( [ base, fullbright, solidSky, alphaSky ] );

		sprite.type = gl_model.mod_sprite;
		sprite.needload = false;
		sprite.cache = { data: { texture: spriteTexture } };
		sprite._threeTextures = new Set( [ spriteTexture ] );

		alias.type = gl_model.mod_alias;
		alias.needload = false;
		alias._threeTextures = new Set( [ aliasTexture ] );

		gl_model.Mod_ClearAll();
		for ( const texture of [ base, fullbright, spriteTexture, solidSky, alphaSky ] )
			assertEqual( texture.disposals, 1, `${texture.name} disposal` );
		assertEqual( aliasTexture.disposals, 0, 'alias texture retention' );
		assertEqual( particleTexture.disposals, 0, 'particle texture retention' );
		assertEqual( brush.needload, true, 'brush reload flag' );
		assertEqual( sprite.needload, true, 'sprite reload flag' );
		assertEqual( alias.needload, false, 'alias reload flag' );
		assertEqual( brush.textures[ 0 ].gl_texture, null, 'brush texture reference' );
		assertEqual( base._fullbright, null, 'brush fullbright reference' );
		assertEqual( sprite.cache.data, null, 'sprite cache reference' );
		assertEqual( brush._threeTextures.size, 0, 'brush ownership set' );
		assertEqual( sprite._threeTextures.size, 0, 'sprite ownership set' );
		assertEqual( alias._threeTextures.size, 1, 'alias ownership set' );
		for ( const texture of [ base, fullbright, spriteTexture ] )
			assertEqual( glquake._allGameTextures.includes( texture ), false,
				`${texture.name} registry removal` );
		assertEqual( glquake._allGameTextures.includes( aliasTexture ), true,
			'alias registry retention' );
		assertEqual( glquake._allGameTextures.includes( particleTexture ), true,
			'particle registry retention' );

		glquake.gl_texturemode.value = 1;
		glquake.GL_UpdateTextureFiltering();
		assertEqual( aliasTexture.needsUpdate, true, 'alias filtering update' );
		assertEqual( particleTexture.needsUpdate, true, 'particle filtering update' );
		assertEqual( base.needsUpdate, false, 'disposed filtering exclusion' );

		gl_model.Mod_ClearAll();
		for ( const texture of [ base, fullbright, spriteTexture, solidSky, alphaSky ] )
			assertEqual( texture.disposals, 1, `idempotent ${texture.name} disposal` );

	} finally {

		for ( const key of Object.keys( brush ) ) delete brush[ key ];
		for ( const key of Object.keys( sprite ) ) delete sprite[ key ];
		for ( const key of Object.keys( alias ) ) delete alias[ key ];
		Object.defineProperties( brush, brushDescriptors );
		Object.defineProperties( sprite, spriteDescriptors );
		Object.defineProperties( alias, aliasDescriptors );
		glquake._allGameTextures.splice( 0, glquake._allGameTextures.length, ...oldRegistry );
		glquake.gl_texturemode.value = oldTextureMode;

	}

} );

Deno.test( 'server texture shim supports map texture disposal', () => {

	const texture = new THREE.DataTexture();
	texture.dispose();

} );

Deno.test( 'missing textures use the persistent checkerboard', () => {

	gl_model.Mod_Init();
	const fallback = gl_model.R_InitTextures();
	const fallbackTexture = fallback.gl_texture;
	assertEqual( gl_model.R_InitTextures(), fallback, 'idempotent fallback descriptor' );
	assertEqual( fallback.gl_texture, fallbackTexture, 'idempotent fallback texture' );

	const material = { map: null, needsUpdate: false };
	assertEqual( gl_rsurf.R_UpdateAnimatedMaterial( material, fallback, 0 ), true,
		'fallback material update' );
	assertEqual( material.map, fallbackTexture, 'renderer fallback map' );

	gl_model.Mod_ClearAll();
	assertEqual( fallback.gl_texture, fallbackTexture, 'fallback survives map clearing' );
	assertEqual( gl_model.R_InitTextures(), fallback, 'fallback survives reinitialization' );

} );
