// Ported from: WinQuake/gl_rmisc.c -- GL misc rendering functions

import * as THREE from 'three';
import { Con_Printf } from './common.js';
import { Cvar_RegisterVariable as Cvar_RegisterVariable_impl, Cvar_SetValue as Cvar_SetValue_impl } from './cvar.js';
import { d_lightstylevalue, r_viewleaf, r_norefresh, r_lightmap,
	r_fullbright, r_drawentities, r_drawviewmodel, r_shadows,
	r_mirroralpha, r_wateralpha, r_dynamic, r_novis, r_speeds,
	gl_clear, gl_texsort, gl_cull, gl_smoothmodels, gl_affinemodels,
	gl_polyblend, gl_flashblend, gl_playermip, gl_nocolors,
	gl_keeptjunctions, gl_reporttjunctions, gl_doubleeyes, gl_texturemode,
	gl_mtexable, skytexturenum, mirrortexturenum, set_mirrortexturenum,
	getTextureExtensionNumber, particletexture, playertextures,
	envmap } from './glquake.js';
import { mod_alias, r_worldentity, R_Init as R_Init_rmain, R_NewMap as R_NewMap_rmain } from './gl_rmain.js';
import { set_skytexturenum as set_skytexturenum_rsurf } from './gl_rsurf.js';
import { cl, cl_entities } from './client.js';
import { d_8to24table } from './vid.js';

// External function stubs (set by engine)
let Cmd_AddCommand = null;
let Cvar_RegisterVariable = null;
let Cvar_SetValue = null;
let R_InitParticles = null;
let R_RenderView = null;

export function R_Misc_SetCallbacks( callbacks ) {

	if ( callbacks.Cmd_AddCommand ) Cmd_AddCommand = callbacks.Cmd_AddCommand;
	if ( callbacks.Cvar_RegisterVariable ) Cvar_RegisterVariable = callbacks.Cvar_RegisterVariable;
	if ( callbacks.Cvar_SetValue ) Cvar_SetValue = callbacks.Cvar_SetValue;
	if ( callbacks.R_InitParticles ) R_InitParticles = callbacks.R_InitParticles;
	if ( callbacks.R_RenderView ) R_RenderView = callbacks.R_RenderView;

}

/*
===============
R_InitParticleTexture

Creates the particle dot texture used for particle effects.
The original is an 8x8 texture with a circular dot pattern.
===============
*/

const dottexture = [
	[ 0, 1, 1, 0, 0, 0, 0, 0 ],
	[ 1, 1, 1, 1, 0, 0, 0, 0 ],
	[ 1, 1, 1, 1, 0, 0, 0, 0 ],
	[ 0, 1, 1, 0, 0, 0, 0, 0 ],
	[ 0, 0, 0, 0, 0, 0, 0, 0 ],
	[ 0, 0, 0, 0, 0, 0, 0, 0 ],
	[ 0, 0, 0, 0, 0, 0, 0, 0 ],
	[ 0, 0, 0, 0, 0, 0, 0, 0 ],
];

export function R_InitParticleTexture() {

	//
	// particle texture
	//
	const data = new Uint8Array( 8 * 8 * 4 );

	for ( let x = 0; x < 8; x ++ ) {

		for ( let y = 0; y < 8; y ++ ) {

			const idx = ( y * 8 + x ) * 4;
			data[ idx ] = 255;
			data[ idx + 1 ] = 255;
			data[ idx + 2 ] = 255;
			data[ idx + 3 ] = dottexture[ x ][ y ] * 255;

		}

	}

	const texture = new THREE.DataTexture( data, 8, 8, THREE.RGBAFormat );
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.needsUpdate = true;

	return texture;

}

/*
===============
R_Envmap_f

Grab six views for environment mapping tests.
In Three.js, we would use CubeCamera for this.
===============
*/
export function R_Envmap_f( r_refdef, scene, renderer, camera ) {

	if ( ! renderer || ! scene || ! camera )
		return;

	const cubeRenderTarget = new THREE.WebGLCubeRenderTarget( 256 );
	const cubeCamera = new THREE.CubeCamera( 1, 10000, cubeRenderTarget );
	cubeCamera.position.copy( camera.position );

	cubeCamera.update( renderer, scene );

	Con_Printf( 'Environment map captured via CubeCamera\n' );

	return cubeRenderTarget.texture;

}

/*
===============
R_Init
===============
*/
export function R_Init() {

	// Register commands
	if ( Cmd_AddCommand ) {

		Cmd_AddCommand( 'envmap', R_Envmap_f );

	}

	// Register cvars
	const _Cvar_RegisterVariable = Cvar_RegisterVariable || Cvar_RegisterVariable_impl;
	const _Cvar_SetValue = Cvar_SetValue || Cvar_SetValue_impl;
	if ( _Cvar_RegisterVariable ) {

		_Cvar_RegisterVariable( r_norefresh );
		_Cvar_RegisterVariable( r_lightmap );
		_Cvar_RegisterVariable( r_fullbright );
		_Cvar_RegisterVariable( r_drawentities );
		_Cvar_RegisterVariable( r_drawviewmodel );
		_Cvar_RegisterVariable( r_shadows );
		_Cvar_RegisterVariable( r_mirroralpha );
		_Cvar_RegisterVariable( r_wateralpha );
		_Cvar_RegisterVariable( r_dynamic );
		_Cvar_RegisterVariable( r_novis );
		_Cvar_RegisterVariable( r_speeds );

		_Cvar_RegisterVariable( gl_clear );
		_Cvar_RegisterVariable( gl_texsort );

		if ( gl_mtexable ) {

			_Cvar_SetValue( 'gl_texsort', 0.0 );

		}

		_Cvar_RegisterVariable( gl_cull );
		_Cvar_RegisterVariable( gl_smoothmodels );
		_Cvar_RegisterVariable( gl_affinemodels );
		_Cvar_RegisterVariable( gl_polyblend );
		_Cvar_RegisterVariable( gl_flashblend );
		_Cvar_RegisterVariable( gl_playermip );
		_Cvar_RegisterVariable( gl_nocolors );

		_Cvar_RegisterVariable( gl_keeptjunctions );
		_Cvar_RegisterVariable( gl_reporttjunctions );

		_Cvar_RegisterVariable( gl_doubleeyes );

		_Cvar_RegisterVariable( gl_texturemode );

	}

	if ( R_InitParticles )
		R_InitParticles();

	const particleTex = R_InitParticleTexture();

	// Initialize gl_rmain scene/camera
	R_Init_rmain();

	return { particleTexture: particleTex };

}

/*
===============
R_TranslatePlayerSkin

Translates a skin texture by the per-player color lookup.
For Three.js, builds a new texture with translated colors.
Stores the result in _playerSkinTextures[playernum] for gl_mesh.js to use.
===============
*/

const MAX_SCOREBOARD = 16;
const _playerSkinTextures = new Array( MAX_SCOREBOARD ).fill( null );

export function R_GetPlayerSkinTexture( playernum ) {

	return _playerSkinTextures[ playernum ];

}

export function R_TranslatePlayerSkin( playernum ) {

	if ( cl.scores == null || cl.scores[ playernum ] == null )
		return;

	const top = cl.scores[ playernum ].colors & 0xf0;
	const bottom = ( cl.scores[ playernum ].colors & 15 ) << 4;

	const translate = new Uint8Array( 256 );
	for ( let i = 0; i < 256; i ++ )
		translate[ i ] = i;

	const TOP_RANGE = 16;
	const BOTTOM_RANGE = 96;

	for ( let i = 0; i < 16; i ++ ) {

		if ( top < 128 ) // the artists made some backwards ranges. sigh.
			translate[ TOP_RANGE + i ] = top + i;
		else
			translate[ TOP_RANGE + i ] = top + 15 - i;

		if ( bottom < 128 )
			translate[ BOTTOM_RANGE + i ] = bottom + i;
		else
			translate[ BOTTOM_RANGE + i ] = bottom + 15 - i;

	}

	//
	// locate the original skin pixels
	//
	const entity = cl_entities[ 1 + playernum ];
	if ( entity == null || entity.model == null )
		return; // player doesn't have a model yet

	const model = entity.model;
	if ( model.type !== mod_alias )
		return; // only translate skins on alias models

	const paliashdr = model.cache != null ? model.cache.data : null;
	if ( paliashdr == null )
		return;

	const skinnum = ( entity.skinnum >= 0 && entity.skinnum < paliashdr.numskins )
		? entity.skinnum : 0;
	const original = paliashdr.texels[ skinnum ];
	if ( original == null )
		return;

	const inwidth = paliashdr.skinwidth;
	const inheight = paliashdr.skinheight;

	// Build translated 32-bit pixels
	const translate32 = new Uint32Array( 256 );
	for ( let i = 0; i < 256; i ++ )
		translate32[ i ] = d_8to24table[ translate[ i ] ];

	const scaled_width = Math.min( 512, inwidth );
	const scaled_height = Math.min( 256, inheight );

	const pixels = new Uint8Array( scaled_width * scaled_height * 4 );
	const fracstep = ( inwidth * 0x10000 / scaled_width ) | 0;

	for ( let i = 0; i < scaled_height; i ++ ) {

		const inrow_offset = inwidth * ( ( i * inheight / scaled_height ) | 0 );
		let frac = fracstep >> 1;
		for ( let j = 0; j < scaled_width; j ++ ) {

			const rgba = translate32[ original[ inrow_offset + ( frac >> 16 ) ] ];
			const pixIdx = ( i * scaled_width + j ) * 4;
			pixels[ pixIdx ] = rgba & 0xff;
			pixels[ pixIdx + 1 ] = ( rgba >> 8 ) & 0xff;
			pixels[ pixIdx + 2 ] = ( rgba >> 16 ) & 0xff;
			pixels[ pixIdx + 3 ] = 255;
			frac += fracstep;

		}

	}

	// Dispose previous translated texture for this player
	if ( _playerSkinTextures[ playernum ] != null ) {

		_playerSkinTextures[ playernum ].dispose();

	}

	const texture = new THREE.DataTexture( pixels, scaled_width, scaled_height, THREE.RGBAFormat );
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;

	_playerSkinTextures[ playernum ] = texture;

}

/*
===============
R_NewMap
===============
*/
export function R_NewMap( cl ) {

	// Initialize light style values
	for ( let i = 0; i < 256; i ++ )
		d_lightstylevalue[ i ] = 264; // normal light value

	// clear out efrags in case the level hasn't been reloaded
	if ( cl.worldmodel && cl.worldmodel.leafs ) {

		for ( let i = 0; i < cl.worldmodel.numleafs; i ++ )
			cl.worldmodel.leafs[ i ].efrags = null;

	}

	R_NewMap_rmain();

	// identify sky texture
	let skyTexNum = - 1;
	let mirrorTexNum = - 1;
	if ( cl.worldmodel && cl.worldmodel.textures ) {

		for ( let i = 0; i < cl.worldmodel.numtextures; i ++ ) {

			if ( ! cl.worldmodel.textures[ i ] )
				continue;
			if ( cl.worldmodel.textures[ i ].name.substring( 0, 3 ) === 'sky' )
				skyTexNum = i;
			if ( cl.worldmodel.textures[ i ].name.substring( 0, 10 ) === 'window02_1' )
				mirrorTexNum = i;
			cl.worldmodel.textures[ i ].texturechain = null;

		}

	}

	// Set sky texture number in gl_rsurf.js for DrawTextureChains
	set_skytexturenum_rsurf( skyTexNum );
	set_mirrortexturenum( mirrorTexNum );

	return {
		worldEntity: r_worldentity,
		skytexturenum: skyTexNum,
		mirrortexturenum: mirrorTexNum
	};

}

/*
====================
D_FlushCaches

No-op in GL renderer
====================
*/
export function D_FlushCaches() {

	// no-op

}
