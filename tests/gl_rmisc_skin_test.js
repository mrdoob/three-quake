// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const gl_rmisc = await import( '../src/gl_rmisc.js' );
const { mod_alias, mod_sprite } = await import( '../src/gl_rmain.js' );
const { cl, cl_entities } = await import( '../src/client.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'player skin translation accepts numeric alias model types', () => {

	const oldScores = cl.scores;
	const oldModel = cl_entities[ 1 ].model;
	const oldSkinNum = cl_entities[ 1 ].skinnum;
	let aliasReads = 0;
	let spriteReads = 0;
	const aliasTexels = [];
	const spriteTexels = [];
	Object.defineProperty( aliasTexels, 0, {
		get() { aliasReads ++; return null; }
	} );
	Object.defineProperty( spriteTexels, 0, {
		get() { spriteReads ++; return null; }
	} );

	try {

		cl.scores = [ { colors: 0 } ];
		cl_entities[ 1 ].skinnum = 0;
		cl_entities[ 1 ].model = {
			type: mod_alias,
			cache: { data: { numskins: 1, texels: aliasTexels } }
		};

		gl_rmisc.R_TranslatePlayerSkin( 0 );
		assertEqual( aliasReads, 1, 'alias skin texel access' );

		cl_entities[ 1 ].model = {
			type: mod_sprite,
			cache: { data: { numskins: 1, texels: spriteTexels } }
		};

		gl_rmisc.R_TranslatePlayerSkin( 0 );
		assertEqual( spriteReads, 0, 'non-alias skin texel access' );

	} finally {

		cl.scores = oldScores;
		cl_entities[ 1 ].model = oldModel;
		cl_entities[ 1 ].skinnum = oldSkinNum;

	}

} );
