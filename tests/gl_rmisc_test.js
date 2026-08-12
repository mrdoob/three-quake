// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const gl_rmain = await import( '../src/gl_rmain.js' );
const gl_rmisc = await import( '../src/gl_rmisc.js' );
const gl_rsurf = await import( '../src/gl_rsurf.js' );
const {
	cl, cl_static_entities, cl_visedicts, cl_numvisedicts, set_cl_numvisedicts
} = await import( '../src/client.js' );
const { SPR_SINGLE } = await import( '../src/gl_model.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function captureRendererState() {

	const worldEntity = gl_rmain.r_worldentity;
	return {
		frame: gl_rmain.r_framecount,
		visFrame: gl_rmain.r_visframecount,
		viewLeaf: gl_rmain.r_viewleaf,
		oldViewLeaf: gl_rmain.r_oldviewleaf,
		worldEntity: worldEntity,
		worldEntityDescriptors: worldEntity != null
			? Object.getOwnPropertyDescriptors( worldEntity )
			: null,
		mirrorTextureNum: gl_rmain.mirrortexturenum
	};

}

function restoreRendererState( state ) {

	if ( state.worldEntity != null && state.worldEntityDescriptors != null ) {

		for ( const key of Object.keys( state.worldEntity ) )
			delete state.worldEntity[ key ];
		Object.defineProperties( state.worldEntity, state.worldEntityDescriptors );

	}
	gl_rmain.set_r_worldentity( state.worldEntity );
	gl_rmain.set_r_framecount( state.frame );
	gl_rmain.set_r_visframecount( state.visFrame );
	gl_rmain.set_r_viewleaf( state.viewLeaf );
	gl_rmain.set_r_oldviewleaf( state.oldViewLeaf );
	gl_rmain.set_mirrortexturenum( state.mirrorTextureNum );

}

Deno.test( 'map setup runs the canonical renderer reset', () => {

	const rendererState = captureRendererState();
	const oldLightstyles = gl_rmain.d_lightstylevalue.slice();
	const oldSkyTextureNum = gl_rsurf.skytexturenum;
	const oldWorldmodel = cl.worldmodel;
	const oldModels = cl.model_precache.slice();
	const efrag = {};
	const worldmodel = {
		numleafs: 1,
		leafs: [ { efrags: efrag }, { contents: - 2 } ],
		numtextures: 2,
		textures: [
			{ name: 'stone', texturechain: {} },
			{ name: 'window02_1', texturechain: {} }
		],
		firstmodelsurface: 0,
		nummodelsurfaces: 0,
		numsurfaces: 0,
		surfaces: []
	};

	try {

		cl.worldmodel = worldmodel;
		cl.model_precache.fill( null );
		gl_rmain.set_r_framecount( 99 );
		gl_rmain.set_r_viewleaf( {} );
		gl_rmain.set_r_oldviewleaf( {} );

		const result = gl_rmisc.R_NewMap( cl );
		const worldEntity = gl_rmain.r_worldentity;

		assertEqual( gl_rmain.r_framecount, 1, 'renderer frame reset' );
		assertEqual( gl_rmain.r_viewleaf, null, 'view leaf reset' );
		assertEqual( gl_rmain.r_oldviewleaf, null, 'old view leaf reset' );
		assertEqual( worldmodel.leafs[ 0 ].efrags, null, 'world efrag reset' );
		if ( rendererState.worldEntity != null )
			assertEqual( worldEntity, rendererState.worldEntity, 'existing world entity identity' );
		assertEqual( worldEntity.model, worldmodel, 'world entity model' );
		assertEqual( result.worldEntity, worldEntity, 'published world entity' );
		assertEqual( result.mirrortexturenum, 1, 'published mirror texture index' );
		assertEqual( gl_rmain.mirrortexturenum, 1, 'renderer mirror texture index' );
		assertEqual( worldmodel.textures[ 1 ].texturechain, null,
			'mirror texture chain reset' );

		worldEntity.frame = 7;
		worldEntity._brushGroup = {};
		const nextWorldmodel = {
			...worldmodel,
			leafs: [ { efrags: {} } ],
			numtextures: 1,
			textures: [ { name: 'stone', texturechain: {} } ]
		};
		cl.worldmodel = nextWorldmodel;
		const nextResult = gl_rmisc.R_NewMap( cl );

		assertEqual( gl_rmain.r_worldentity, worldEntity, 'stable world entity identity' );
		assertEqual( nextResult.worldEntity, worldEntity, 'stable published world entity' );
		assertEqual( worldEntity.model, nextWorldmodel, 'updated world entity model' );
		assertEqual( worldEntity.frame, 0, 'reset world entity frame' );
		assertEqual( Object.hasOwn( worldEntity, '_brushGroup' ), false,
			'reset world entity renderer cache' );
		assertEqual( nextResult.mirrortexturenum, - 1, 'published missing mirror index' );
		assertEqual( gl_rmain.mirrortexturenum, - 1, 'renderer missing mirror index' );

	} finally {

		restoreRendererState( rendererState );
		cl.worldmodel = oldWorldmodel;
		for ( let i = 0; i < oldModels.length; i ++ )
			cl.model_precache[ i ] = oldModels[ i ];
		gl_rmain.d_lightstylevalue.set( oldLightstyles );
		gl_rsurf.set_skytexturenum( oldSkyTextureNum );

	}

} );

Deno.test( 'map teardown clears persistent entity mesh caches', () => {

	const rendererState = captureRendererState();
	const entity = cl_static_entities[ 0 ];
	const oldDescriptors = Object.getOwnPropertyDescriptors( entity );
	const oldWorldmodel = cl.worldmodel;
	const oldModels = cl.model_precache.slice();
	const disposalCounts = new Map();
	const detachCounts = new Map();
	function disposable( name ) {

		const value = {
			dispose() {

				disposalCounts.set( name, ( disposalCounts.get( name ) ?? 0 ) + 1 );

			}
		};
		disposalCounts.set( name, 0 );
		return value;

	}
	function mesh( name, geometry ) {

		const value = {
			geometry: geometry,
			parent: {
				remove( child ) {

					if ( child !== value ) throw new Error( `wrong ${name} detach target` );
					detachCounts.set( name, ( detachCounts.get( name ) ?? 0 ) + 1 );
					child.parent = null;

				}
			}
		};
		detachCounts.set( name, 0 );
		return value;

	}
	const spriteGeometry = disposable( 'sprite geometry' );
	const aliasGeometry = disposable( 'alias geometry' );
	const shadowGeometry = disposable( 'shadow geometry' );
	const viewmodelMaterial = disposable( 'viewmodel material' );
	const playerMaterial = disposable( 'player material' );
	const spriteMesh = mesh( 'sprite mesh', spriteGeometry );
	const aliasMesh = mesh( 'alias mesh', aliasGeometry );
	const shadowMesh = mesh( 'shadow mesh', shadowGeometry );
	const worldmodel = {
		numleafs: 1,
		leafs: [ { efrags: null } ],
		numtextures: 0,
		textures: [],
		firstmodelsurface: 0,
		nummodelsurfaces: 0,
		numsurfaces: 0,
		surfaces: []
	};

	try {

		entity._spriteMesh = spriteMesh;
		entity._aliasMesh = aliasMesh;
		entity._aliasGeo = aliasGeometry;
		entity._aliasColorArray = new Float32Array( 3 );
		entity._aliasPaliashdr = {};
		entity._aliasPosenum = 7;
		entity._aliasShadowMesh = shadowMesh;
		entity._aliasShadowGeo = shadowGeometry;
		entity._aliasShadowPosArray = new Float32Array( 3 );
		entity._aliasShadowVertCount = 1;
		entity._viewmodelMaterial = viewmodelMaterial;
		entity._viewmodelMaterialBase = {};
		entity._playerMaterial = playerMaterial;
		entity._playerSkinTexture = {};
		cl.worldmodel = worldmodel;
		cl.model_precache.fill( null );

		gl_rmain.R_NewMap();
		for ( const [ name, count ] of disposalCounts )
			assertEqual( count, 1, `${name} disposal` );
		for ( const [ name, count ] of detachCounts )
			assertEqual( count, 1, `${name} detach` );
		assertEqual( entity._spriteMesh, null, 'sprite mesh cache' );
		assertEqual( entity._aliasMesh, null, 'alias mesh cache' );
		assertEqual( entity._aliasGeo, null, 'alias geometry cache' );
		assertEqual( entity._aliasColorArray, null, 'alias color cache' );
		assertEqual( entity._aliasPaliashdr, null, 'alias header cache' );
		assertEqual( entity._aliasPosenum, undefined, 'alias pose cache' );
		assertEqual( entity._aliasShadowMesh, null, 'shadow mesh cache' );
		assertEqual( entity._aliasShadowGeo, null, 'shadow geometry cache' );
		assertEqual( entity._aliasShadowPosArray, null, 'shadow position cache' );
		assertEqual( entity._aliasShadowVertCount, undefined, 'shadow count cache' );
		assertEqual( entity._viewmodelMaterial, null, 'viewmodel material cache' );
		assertEqual( entity._viewmodelMaterialBase, null, 'viewmodel base cache' );
		assertEqual( entity._playerMaterial, null, 'player material cache' );
		assertEqual( entity._playerSkinTexture, null, 'player skin cache' );

		gl_rmain.R_NewMap();
		for ( const [ name, count ] of disposalCounts )
			assertEqual( count, 1, `idempotent ${name} disposal` );
		for ( const [ name, count ] of detachCounts )
			assertEqual( count, 1, `idempotent ${name} detach` );

	} finally {

		restoreRendererState( rendererState );
		for ( const key of Object.keys( entity ) ) delete entity[ key ];
		Object.defineProperties( entity, oldDescriptors );
		cl.worldmodel = oldWorldmodel;
		for ( let i = 0; i < oldModels.length; i ++ )
			cl.model_precache[ i ] = oldModels[ i ];

	}

} );

Deno.test( 'map teardown retains owners after entities leave the PVS', () => {

	const rendererState = captureRendererState();
	const oldVisedicts = cl_visedicts.slice();
	const oldNumVisedicts = cl_numvisedicts;
	const oldWorldmodel = cl.worldmodel;
	const oldModels = cl.model_precache.slice();
	const texture = {};
	const sprite = {
		type: 0,
		numframes: 1,
		frames: [ {
			type: SPR_SINGLE,
			frameptr: {
				gl_texturenum: texture,
				left: - 1,
				right: 1,
				up: 1,
				down: - 1
			}
		} ]
	};
	const entity = {
		origin: new Float32Array( 3 ),
		angles: new Float32Array( 3 ),
		frame: 0,
		syncbase: 0,
		model: { type: gl_rmain.mod_sprite, cache: { data: sprite } }
	};
	const worldmodel = {
		numleafs: 1,
		leafs: [ { efrags: null } ],
		numtextures: 0,
		textures: [],
		firstmodelsurface: 0,
		nummodelsurfaces: 0,
		numsurfaces: 0,
		surfaces: []
	};
	let geometryDisposals = 0;

	try {

		cl_visedicts.fill( null );
		cl_visedicts[ 0 ] = entity;
		set_cl_numvisedicts( 1 );
		gl_rmain.R_DrawEntitiesOnList();
		const mesh = entity._spriteMesh;
		if ( mesh == null ) throw new Error( 'sprite owner fixture was not rendered' );
		mesh.geometry.dispose = () => { geometryDisposals ++; };

		// Simulate CL_ClearState replacing the entity after it left the PVS.
		cl_visedicts[ 0 ] = null;
		set_cl_numvisedicts( 0 );
		entity._spriteMesh._quakeOwner = null;
		cl.worldmodel = worldmodel;
		cl.model_precache.fill( null );

		gl_rmain.R_NewMap();
		assertEqual( geometryDisposals, 1, 'unreachable sprite geometry disposal' );
		assertEqual( entity._spriteMesh, null, 'unreachable sprite owner cache' );

	} finally {

		gl_rmain.R_NewMap();
		restoreRendererState( rendererState );
		for ( let i = 0; i < oldVisedicts.length; i ++ )
			cl_visedicts[ i ] = oldVisedicts[ i ];
		set_cl_numvisedicts( oldNumVisedicts );
		cl.worldmodel = oldWorldmodel;
		for ( let i = 0; i < oldModels.length; i ++ )
			cl.model_precache[ i ] = oldModels[ i ];

	}

} );

Deno.test( 'map teardown invalidates cached brush entity groups', () => {

	const rendererState = captureRendererState();
	const oldFrame = gl_rmain.r_framecount;
	const oldBrushPolys = gl_rmain.c_brush_polys;
	const oldModels = cl.model_precache.slice();
	const poly = {
		numverts: 3,
		verts: new Float32Array( [
			0, 0, 0, 0, 0, 0, 0,
			1, 0, 0, 1, 0, 1, 0,
			0, 1, 0, 0, 1, 0, 1
		] )
	};
	const surface = {
		flags: 0,
		styles: new Uint8Array( [ 255, 255, 255, 255 ] ),
		cached_light: new Int32Array( 4 ),
		dlightframe: - 1,
		dlightbits: 0,
		cached_dlight: false,
		polys: poly,
		lightmaptexturenum: 0,
		plane: { normal: new Float32Array( [ 0, 0, 1 ] ) },
		texinfo: {
			texture: { anim_total: 0, alternate_anims: null, gl_texture: null }
		}
	};
	const model = {
		mins: new Float32Array( [ - 1, - 1, - 1 ] ),
		maxs: new Float32Array( [ 1, 1, 1 ] ),
		radius: 2,
		firstmodelsurface: 0,
		nummodelsurfaces: 1,
		surfaces: [ surface ]
	};
	const entity = {
		origin: new Float32Array( 3 ),
		angles: new Float32Array( [ 0, 1, 0 ] ),
		frame: 0,
		model: model
	};
	let oldGroup = null;
	let disposals = 0;

	try {

		cl.model_precache.fill( null );
		gl_rsurf.R_DrawBrushModel( entity );
		oldGroup = entity._brushGroup;
		if ( oldGroup == null || oldGroup.children.length !== 1 )
			throw new Error( 'brush cache fixture was not built' );
		oldGroup.children[ 0 ].geometry.dispose = () => { disposals ++; };

		gl_rsurf.GL_BuildLightmaps();
		assertEqual( disposals, 1, 'old brush geometry disposal' );
		assertEqual( entity._brushGroup, null, 'brush group owner invalidation' );
		assertEqual( entity._brushGroupFrame, undefined, 'brush frame owner invalidation' );
		assertEqual( entity._brushAnimSurfaces, null, 'brush animation owner invalidation' );

		gl_rsurf.R_DrawBrushModel( entity );
		if ( entity._brushGroup === oldGroup )
			throw new Error( 'disposed brush group was reused' );

	} finally {

		gl_rsurf.GL_BuildLightmaps();
		restoreRendererState( rendererState );
		for ( let i = 0; i < oldModels.length; i ++ )
			cl.model_precache[ i ] = oldModels[ i ];
		gl_rmain.set_r_framecount( oldFrame );
		gl_rmain.set_c_brush_polys( oldBrushPolys );

	}

} );
