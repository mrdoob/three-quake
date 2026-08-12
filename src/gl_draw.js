// Ported from: WinQuake/gl_draw.c -- GL 2D drawing functions
// In browser port: uses a canvas 2D overlay context for HUD/menu/console drawing

import { Con_Printf } from './console.js';
import { Sbar_Changed } from './sbar.js';
import { W_GetLumpName } from './wad.js';
import { d_8to24table as vid_d_8to24table } from './vid.js';
import { COM_FindFile } from './pak.js';
import { Cmd_AddCommand, Cmd_Argc, Cmd_Argv } from './cmd.js';

/*
==============================================================================

			TEXTURE MANAGEMENT

==============================================================================
*/

const MAX_GLTEXTURES = 1024;

class gltexture_t {

	constructor() {

		this.identifier = '';
		this.texnum = 0;
		this.width = 0;
		this.height = 0;
		this.mipmap = false;

	}

}

const gltextures = [];
for ( let i = 0; i < MAX_GLTEXTURES; i ++ )
	gltextures[ i ] = new gltexture_t();

let numgltextures = 0;
let texture_extension_number = 1;

// Cached pics
const cachepics = {}; // name -> { width, height, data, canvas, texnum }

// 2D overlay canvas
let overlayCanvas = null;
let overlayCtx = null;

// Charset
let char_canvas = null;
let conback = null;
let draw_disc = null;
let draw_backtile = null;

// Quake palette (256 colors, initialized externally)
let host_basepal = null;

// d_8to24table for palette conversion
let d_8to24table = null;

/*
==============================================================================

			UI SCALING

GLQuake used vid.conwidth/conheight to define a virtual resolution for 2D
content. We implement this via canvas transforms - all 2D drawing happens
in a virtual coordinate space that scales to fill the actual screen.

Default virtual height is 240 pixels (close to Quake's original 200).
This gives menus/HUD a classic look while scaling to any screen size.

==============================================================================
*/

// Target virtual height for 2D content (adjustable)
// 240 gives a classic Quake feel, 480 gives smaller/more modern UI
let scr_conheight = 240;

// Calculated scale factor (physical pixels per virtual pixel)
let _uiScale = 1;

// Cached virtual dimensions
let _virtualWidth = 640;
let _virtualHeight = 480;

/*
================
_calculateUIScale

Calculate the UI scale factor based on physical pixel count and target
virtual height. Uses physical pixels (CSS * devicePixelRatio) so that
screens with the same physical resolution get the same UI size regardless
of OS DPI settings. Also ensures the overlay canvas is crisp on HiDPI.
================
*/
function _calculateUIScale() {

	const dpr = window.devicePixelRatio || 1;
	const physicalWidth = Math.floor( _realVid.width * dpr );
	const physicalHeight = Math.floor( _realVid.height * dpr );

	// Calculate scale from physical pixels
	// Use floor to avoid fractional scaling (sharper pixels)
	_uiScale = Math.max( 1, Math.floor( physicalHeight / scr_conheight ) );

	// Ensure minimum 320px virtual width so Quake's menus fit
	while ( _uiScale > 1 && Math.floor( physicalWidth / _uiScale ) < 320 ) {

		_uiScale --;

	}

	_virtualWidth = Math.ceil( physicalWidth / _uiScale );
	_virtualHeight = Math.ceil( physicalHeight / _uiScale );

	return { width: _virtualWidth, height: _virtualHeight };

}

/*
================
SCR_SetConHeight

Set the target virtual height for UI scaling.
Lower values = larger UI, higher values = smaller UI.
Minimum: 200, Maximum: physical screen height.
================
*/
export function SCR_SetConHeight( height ) {

	const dpr = window.devicePixelRatio || 1;
	const physicalHeight = Math.floor( _realVid.height * dpr );

	// Clamp to reasonable range
	scr_conheight = Math.max( 200, Math.min( height, physicalHeight ) );
	_calculateUIScale();
	_realVid.recalc_refdef = 1;

}

/*
================
SCR_GetConHeight

Get the current target virtual height.
================
*/
export function SCR_GetConHeight() {

	return scr_conheight;

}

/*
================
Draw_GetUIScale

Get the current UI scale factor.
================
*/
export function Draw_GetUIScale() {

	_calculateUIScale();
	return _uiScale;

}

/*
================
Draw_GetVirtualWidth / Draw_GetVirtualHeight

Get the current virtual dimensions for 2D drawing.
Used by other modules instead of computing locally.
================
*/
export function Draw_GetVirtualWidth() {

	_calculateUIScale();
	return _virtualWidth;

}

export function Draw_GetVirtualHeight() {

	_calculateUIScale();
	return _virtualHeight;

}

/*
================
SCR_ConHeight_f

Console command to set the virtual UI height.
Usage: scr_conheight [height]
Lower values = larger UI (240 = classic Quake size)
Higher values = smaller UI (480 = modern size)
================
*/
function SCR_ConHeight_f() {

	if ( Cmd_Argc() === 1 ) {

		// No argument - print current value
		const dims = _calculateUIScale();
		Con_Printf( 'scr_conheight is %d (virtual: %dx%d, scale: %dx)\n',
			scr_conheight, dims.width, dims.height, _uiScale );
		return;

	}

	const val = parseInt( Cmd_Argv( 1 ), 10 );
	if ( isNaN( val ) || val < 200 ) {

		Con_Printf( 'scr_conheight must be at least 200\n' );
		return;

	}

	SCR_SetConHeight( val );
	const dims = _calculateUIScale();
	Con_Printf( 'UI scale: %dx (virtual: %dx%d)\n', _uiScale, dims.width, dims.height );

}

/*
================
SCR_UIScaleUp_f

Increase UI size (decrease scr_conheight).
================
*/
function SCR_UIScaleUp_f() {

	// Decrease conheight by ~40 (makes UI bigger)
	SCR_SetConHeight( scr_conheight - 40 );
	const dims = _calculateUIScale();
	Con_Printf( 'UI scale: %dx (virtual: %dx%d)\n', _uiScale, dims.width, dims.height );

}

/*
================
SCR_UIScaleDown_f

Decrease UI size (increase scr_conheight).
================
*/
function SCR_UIScaleDown_f() {

	// Increase conheight by ~40 (makes UI smaller)
	SCR_SetConHeight( scr_conheight + 40 );
	const dims = _calculateUIScale();
	Con_Printf( 'UI scale: %dx (virtual: %dx%d)\n', _uiScale, dims.width, dims.height );

}

/*
================
Draw_InitCommands

Register UI scale console commands.
Called from Draw_Init.
================
*/
function Draw_InitCommands() {

	Cmd_AddCommand( 'scr_conheight', SCR_ConHeight_f );
	Cmd_AddCommand( 'uiscale+', SCR_UIScaleUp_f );
	Cmd_AddCommand( 'uiscale-', SCR_UIScaleDown_f );

}

/*
==============================================================================

			EXTERNAL REFERENCES

==============================================================================
*/

let _realVid = { width: 640, height: 480 };
const _vid = {
	get width() {

		return _virtualWidth;

	},
	get height() {

		return _virtualHeight;

	},
	get numpages() { return _realVid.numpages; }
};

export function Draw_SetExternals( externals ) {

	if ( externals.vid ) _realVid = externals.vid;
	if ( externals.host_basepal ) host_basepal = externals.host_basepal;
	if ( externals.d_8to24table ) d_8to24table = externals.d_8to24table;

}

/*
===============
_loadCharset

Loads the "conchars" lump from gfx.wad and creates a canvas with the charset.
conchars is 128x128 pixels, 8-bit indexed (16x16 grid of 8x8 characters).
===============
*/
function _loadCharset() {

	const pal = d_8to24table || vid_d_8to24table;
	if ( ! pal ) return;

	const lump = W_GetLumpName( 'conchars' );
	if ( ! lump ) return;

	let data;
	if ( lump.data instanceof Uint8Array ) {

		data = lump.data.subarray( lump.offset, lump.offset + lump.size );

	} else {

		data = new Uint8Array( lump.data, lump.offset, lump.size );

	}

	const charWidth = 128;
	const charHeight = 128;
	const cs = document.createElement( 'canvas' );
	cs.width = charWidth;
	cs.height = charHeight;
	const ctx = cs.getContext( '2d' );
	const imageData = ctx.createImageData( charWidth, charHeight );
	const pixels = imageData.data;

	for ( let i = 0; i < charWidth * charHeight; i ++ ) {

		const palIdx = data[ i ];
		if ( palIdx === 0 ) {

			// transparent
			pixels[ i * 4 ] = 0;
			pixels[ i * 4 + 1 ] = 0;
			pixels[ i * 4 + 2 ] = 0;
			pixels[ i * 4 + 3 ] = 0;

		} else {

			const rgba = pal[ palIdx ];
			pixels[ i * 4 ] = rgba & 0xff;
			pixels[ i * 4 + 1 ] = ( rgba >> 8 ) & 0xff;
			pixels[ i * 4 + 2 ] = ( rgba >> 16 ) & 0xff;
			pixels[ i * 4 + 3 ] = 255;

		}

	}

	ctx.putImageData( imageData, 0, 0 );
	char_canvas = cs;

}

/*
===============
_loadConback

Loads the console background image from gfx/conback.lmp in the PAK file.
conback.lmp is a qpic_t: int32 width (320), int32 height (200), then 320*200 palette indices.
===============
*/
function _loadConback() {

	const pal = d_8to24table || vid_d_8to24table;
	if ( ! pal ) return;

	const result = COM_FindFile( 'gfx/conback.lmp' );
	if ( ! result ) {

		Con_Printf( 'Couldn\'t load gfx/conback.lmp\n' );
		return;

	}

	const view = new DataView( result.data.buffer, result.data.byteOffset, result.size );
	const width = view.getInt32( 0, true );
	const height = view.getInt32( 4, true );

	const pixels = new Uint8Array( result.data.buffer, result.data.byteOffset + 8, width * height );

	const cs = _qpicToCanvas( width, height, pixels, false );
	if ( ! cs ) return;

	conback = {
		width: _vid.width,
		height: _vid.height,
		canvas: cs
	};

}

/*
===============
Draw_Init
===============
*/
export function Draw_Init( canvas ) {

	if ( canvas ) {

		overlayCanvas = canvas;
		overlayCtx = canvas.getContext( '2d' );

	} else {

		// Create an overlay canvas positioned on top of the WebGL canvas
		// Size to physical pixels (CSS * dpr) for crisp HiDPI rendering
		const dpr = window.devicePixelRatio || 1;
		overlayCanvas = document.createElement( 'canvas' );
		overlayCanvas.width = Math.floor( ( _realVid.width || 640 ) * dpr );
		overlayCanvas.height = Math.floor( ( _realVid.height || 480 ) * dpr );
		overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
		overlayCtx = overlayCanvas.getContext( '2d' );
		document.body.appendChild( overlayCanvas );

		// Resize overlay when window resizes (use physical pixels)
		window.addEventListener( 'resize', function () {

			const dpr = window.devicePixelRatio || 1;
			overlayCanvas.width = Math.floor( _realVid.width * dpr );
			overlayCanvas.height = Math.floor( _realVid.height * dpr );
			// Scale is applied per-frame in Draw_BeginFrame

		} );

	}

	// Initial scale calculation
	_calculateUIScale();

	// Register console commands
	Draw_InitCommands();

	// Load charset from WAD for character drawing
	_loadCharset();

	// Load conback from PAK (gfx/conback.lmp)
	_loadConback();

	// Load disc and backtile from WAD
	draw_disc = Draw_PicFromWad( 'disc' );
	draw_backtile = Draw_PicFromWad( 'backtile' );

	Con_Printf( 'GL_Draw initialized (canvas 2D overlay, scale=' + _uiScale + 'x)\n' );

}

/*
===============
Draw_GetOverlayCanvas

Returns the overlay canvas for compositing
===============
*/
export function Draw_GetOverlayCanvas() {

	return overlayCanvas;

}

/*
===============
Draw_BeginFrame

Clear the overlay for a new frame of 2D drawing.
Applies UI scaling transform so all drawing happens in virtual coordinates.
===============
*/
export function Draw_BeginFrame() {

	if ( overlayCtx ) {

		// Reset transform and clear
		overlayCtx.setTransform( 1, 0, 0, 1, 0, 0 );
		overlayCtx.clearRect( 0, 0, overlayCanvas.width, overlayCanvas.height );

		// Apply UI scale transform
		// This maps virtual coordinates to canvas pixels
		_calculateUIScale();
		overlayCtx.setTransform( _uiScale, 0, 0, _uiScale, 0, 0 );

		// Disable image smoothing for crisp pixels
		overlayCtx.imageSmoothingEnabled = false;

	}

}

/*
================
Draw_Character

Draws one 8*8 graphics character with 0 being transparent.
It can be clipped to the top of the screen to allow the console to be
smoothly scrolled off.
================
*/
export function Draw_Character( x, y, num ) {

	if ( ! overlayCtx ) return;

	num &= 255;

	if ( num === 32 ) return; // space

	if ( y <= - 8 )
		return; // totally off screen

	// Draw character using the charset texture
	// The charset is a 16x16 grid of 8x8 characters (256 total)
	// Characters 0-127 are normal, 128-255 are the alternate (brown/gold) set
	if ( char_canvas ) {

		// Character sheet is 16x16 grid of 8x8 chars
		const row = Math.floor( num / 16 );
		const col = num % 16;

		overlayCtx.drawImage(
			char_canvas,
			col * 8, row * 8, 8, 8,
			x, y, 8, 8
		);

	} else {

		// Fallback: render as text
		const charCode = num & 127;
		const isAlt = num > 127;
		overlayCtx.fillStyle = isAlt ? '#ff8800' : '#ffffff';
		overlayCtx.font = '8px monospace';
		overlayCtx.textBaseline = 'top';

		if ( charCode >= 32 && charCode < 127 ) {

			overlayCtx.fillText( String.fromCharCode( charCode ), x, y );

		}

	}

}

/*
================
Draw_String
================
*/
export function Draw_String( x, y, str ) {

	for ( let i = 0; i < str.length; i ++ ) {

		Draw_Character( x, y, str.charCodeAt( i ) );
		x += 8;

	}

}

/*
================
Draw_Alt_String

Draw string with alternate (gold) coloring
================
*/
export function Draw_Alt_String( x, y, str ) {

	for ( let i = 0; i < str.length; i ++ ) {

		Draw_Character( x, y, str.charCodeAt( i ) | 128 );
		x += 8;

	}

}

/*
=============
Draw_Pic
=============
*/
export function Draw_Pic( x, y, pic ) {

	if ( ! overlayCtx || ! pic ) return;

	if ( pic.canvas ) {

		overlayCtx.drawImage( pic.canvas, x, y );

	} else if ( pic.imageData ) {

		overlayCtx.putImageData( pic.imageData, x, y );

	}

}

/*
=============
Draw_TransPic

Same as Draw_Pic but with transparency (index 255 = transparent)
In GL mode this is the same as Draw_Pic since alpha is handled by texture
=============
*/
export function Draw_TransPic( x, y, pic ) {

	if ( x < 0 || y < 0 ) return;

	Draw_Pic( x, y, pic );

}

/*
=============
Draw_SubPic

Draws a vertical sub-region of a pic. Used for the extended main menu image
where we sometimes need to skip the "Continue" row at the top.
=============
*/
export function Draw_SubPic( x, y, pic, srcY, srcH ) {

	if ( x < 0 || y < 0 || pic == null ) return;

	if ( pic.canvas ) {

		overlayCtx.drawImage( pic.canvas, 0, srcY, pic.width, srcH, x, y, pic.width, srcH );

	}

}

/*
=============
Draw_TransPicTranslate

Only used for the player color selection menu.
Remaps the pic's palette indices through the translation table,
then draws the result. Ported from WinQuake/gl_draw.c:658-699
=============
*/

// Cached menuplyr raw pixel data (8-bit palette indices)
let menuplyr_pixels = null;
let menuplyr_width = 0;
let menuplyr_height = 0;

// Cached canvas/context/imagedata for Draw_TransPicTranslate (Golden Rule #4)
let _transCanvas = null;
let _transCtx = null;
let _transImageData = null;

export function Draw_TransPicTranslate( x, y, pic, translation ) {

	if ( menuplyr_pixels == null || pic == null ) return;
	if ( overlayCtx == null ) return;

	const pal = d_8to24table || vid_d_8to24table;
	if ( pal == null ) return;

	// Create or reuse cached canvas
	if ( _transCanvas == null ) {

		_transCanvas = document.createElement( 'canvas' );
		_transCanvas.width = 64;
		_transCanvas.height = 64;
		_transCtx = _transCanvas.getContext( '2d' );
		_transImageData = _transCtx.createImageData( 64, 64 );

	}

	// The original C code resamples the menuplyr pic to 64x64.
	// menuplyr.lmp is typically larger, so we scale down.
	const srcW = menuplyr_width;
	const srcH = menuplyr_height;
	const dest = _transImageData.data;

	for ( let v = 0; v < 64; v ++ ) {

		const srcRow = ( ( v * srcH ) >> 6 ) * srcW;

		for ( let u = 0; u < 64; u ++ ) {

			const srcCol = ( u * srcW ) >> 6;
			let p = menuplyr_pixels[ srcRow + srcCol ];

			// Apply translation table
			p = translation[ p ];

			if ( p === 255 ) {

				dest[ ( v * 64 + u ) * 4 ] = 0;
				dest[ ( v * 64 + u ) * 4 + 1 ] = 0;
				dest[ ( v * 64 + u ) * 4 + 2 ] = 0;
				dest[ ( v * 64 + u ) * 4 + 3 ] = 0;

			} else {

				const rgba = pal[ p ];
				dest[ ( v * 64 + u ) * 4 ] = rgba & 0xff;
				dest[ ( v * 64 + u ) * 4 + 1 ] = ( rgba >> 8 ) & 0xff;
				dest[ ( v * 64 + u ) * 4 + 2 ] = ( rgba >> 16 ) & 0xff;
				dest[ ( v * 64 + u ) * 4 + 3 ] = 255;

			}

		}

	}

	_transCtx.putImageData( _transImageData, 0, 0 );

	// Draw at (x, y) stretched to pic dimensions, matching original GL quad
	overlayCtx.drawImage( _transCanvas, x, y, pic.width, pic.height );

}

/*
================
Draw_ConsoleBackground

Always fully opaque, matching DOS/WinQuake (draw.c) rather than
GLQuake (gl_draw.c) which used semi-transparent alpha blending.
================
*/
export function Draw_ConsoleBackground( lines ) {

	if ( ! overlayCtx ) return;

	if ( conback && conback.canvas ) {

		overlayCtx.drawImage( conback.canvas, 0, lines - _vid.height, _vid.width, _vid.height );

	} else {

		// Fallback: solid black background
		overlayCtx.fillStyle = 'rgb(0, 0, 0)';
		overlayCtx.fillRect( 0, 0, _vid.width, lines );

	}

}

/*
=============
Draw_TileClear

This repeats a 64*64 tile graphic to fill the screen around a sized down
refresh window.
=============
*/
export function Draw_TileClear( x, y, w, h ) {

	if ( ! overlayCtx ) return;

	if ( draw_backtile && draw_backtile.canvas ) {

		const pattern = overlayCtx.createPattern( draw_backtile.canvas, 'repeat' );
		overlayCtx.fillStyle = pattern;
		overlayCtx.fillRect( x, y, w, h );

	} else {

		overlayCtx.fillStyle = '#202020';
		overlayCtx.fillRect( x, y, w, h );

	}

}

/*
=============
Draw_Fill

Fills a box of pixels with a single color
=============
*/
export function Draw_Fill( x, y, w, h, c ) {

	if ( ! overlayCtx ) return;

	if ( host_basepal && c >= 0 && c < 256 ) {

		const r = host_basepal[ c * 3 ];
		const g = host_basepal[ c * 3 + 1 ];
		const b = host_basepal[ c * 3 + 2 ];
		overlayCtx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';

	} else {

		overlayCtx.fillStyle = '#ffffff';

	}

	overlayCtx.fillRect( x, y, w, h );

}

/*
================
Draw_FadeScreen

================
*/
export function Draw_FadeScreen() {

	if ( ! overlayCtx ) return;

	overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
	overlayCtx.fillRect( 0, 0, _vid.width, _vid.height );

	Sbar_Changed();

}

/*
================
Draw_BeginDisc

Draws the little blue disc in the corner of the screen.
Call before beginning any disc IO.
================
*/
export function Draw_BeginDisc() {

	if ( ! draw_disc ) return;
	Draw_Pic( _vid.width - 24, 0, draw_disc );

}

/*
================
Draw_EndDisc

Erases the disc icon.
Call after completing any disc IO
================
*/
export function Draw_EndDisc() {

	// Nothing to do in GL mode

}

/*
================
GL_Set2D

Setup as if the screen was 320*200
In canvas 2D overlay mode, this is implicit.
================
*/
export function GL_Set2D() {

	// Canvas 2D context is always in 2D mode

}

/*
================
_qpicToCanvas

Convert palette-indexed qpic_t pixel data to a canvas.
If alpha is true, palette index 255 is treated as transparent.
================
*/
function _qpicToCanvas( width, height, data, alpha ) {

	const pal = d_8to24table || vid_d_8to24table;
	if ( ! pal ) return null;

	const cs = document.createElement( 'canvas' );
	cs.width = width;
	cs.height = height;
	const ctx = cs.getContext( '2d' );
	const imageData = ctx.createImageData( width, height );
	const pixels = imageData.data;

	for ( let i = 0; i < width * height; i ++ ) {

		const palIdx = data[ i ];
		if ( alpha && palIdx === 255 ) {

			pixels[ i * 4 ] = 0;
			pixels[ i * 4 + 1 ] = 0;
			pixels[ i * 4 + 2 ] = 0;
			pixels[ i * 4 + 3 ] = 0;

		} else {

			const rgba = pal[ palIdx ];
			pixels[ i * 4 ] = rgba & 0xff;
			pixels[ i * 4 + 1 ] = ( rgba >> 8 ) & 0xff;
			pixels[ i * 4 + 2 ] = ( rgba >> 16 ) & 0xff;
			pixels[ i * 4 + 3 ] = 255;

		}

	}

	ctx.putImageData( imageData, 0, 0 );
	return cs;

}

/*
================
Draw_CachePicFromPNG

Preloads a PNG image from a URL and caches it as a pic.
Call this during initialization to make custom images available via Draw_CachePic.
Returns a Promise that resolves when the image is loaded.
================
*/
export function Draw_CachePicFromPNG( path, url ) {

	return new Promise( ( resolve, reject ) => {

		const img = new Image();
		img.onload = function () {

			const cs = document.createElement( 'canvas' );
			cs.width = img.width;
			cs.height = img.height;
			const ctx = cs.getContext( '2d' );
			ctx.drawImage( img, 0, 0 );

			const pic = {
				width: img.width,
				height: img.height,
				canvas: cs
			};

			cachepics[ path ] = pic;
			resolve( pic );

		};

		img.onerror = function () {

			Con_Printf( 'Draw_CachePicFromPNG: failed to load ' + url + '\n' );
			reject( new Error( 'Failed to load ' + url ) );

		};

		img.src = url;

	} );

}

/*
================
Draw_CachePic

Loads and caches a pic from the game data (PAK files).
qpic_t format: int32 width, int32 height, then width*height palette indices.
================
*/
export function Draw_CachePic( path ) {

	if ( cachepics[ path ] )
		return cachepics[ path ];

	const result = COM_FindFile( path );
	if ( ! result ) {

		Con_Printf( 'Draw_CachePic: failed to load ' + path + '\n' );
		return null;

	}

	// COM_FindFile returns { data: Uint8Array view into pak buffer, size }
	// qpic_t: first 8 bytes are width + height (int32 LE), then pixel data
	const view = new DataView( result.data.buffer, result.data.byteOffset, result.size );
	const width = view.getInt32( 0, true );
	const height = view.getInt32( 4, true );
	const pixels = new Uint8Array( result.data.buffer, result.data.byteOffset + 8, width * height );

	// Save raw pixel data for menuplyr.lmp (used by Draw_TransPicTranslate)
	if ( path === 'gfx/menuplyr.lmp' ) {

		menuplyr_pixels = new Uint8Array( width * height );
		menuplyr_pixels.set( pixels );
		menuplyr_width = width;
		menuplyr_height = height;

	}

	const cs = _qpicToCanvas( width, height, pixels, true );

	const pic = {
		width: width,
		height: height,
		canvas: cs
	};

	cachepics[ path ] = pic;
	return pic;

}

/*
================
Draw_PicFromWad

Loads a pic from the gfx.wad file.
WAD lumps for qpic_t: int32 width, int32 height, then width*height palette indices.
================
*/
export function Draw_PicFromWad( name ) {

	let lump;
	try {

		lump = W_GetLumpName( name );

	} catch ( e ) {

		Con_Printf( 'Draw_PicFromWad: ' + name + ' not found\n' );
		return null;

	}

	if ( ! lump ) return null;

	// Parse qpic_t header from WAD lump data
	const view = new DataView( lump.data.buffer, lump.data.byteOffset + lump.offset );
	const width = view.getInt32( 0, true );
	const height = view.getInt32( 4, true );

	const pixels = new Uint8Array( lump.data.buffer, lump.data.byteOffset + lump.offset + 8, width * height );

	const cs = _qpicToCanvas( width, height, pixels, true );

	return {
		width: width,
		height: height,
		canvas: cs
	};

}

/*
================
GL_LoadTexture
================
*/
export function GL_LoadTexture( identifier, width, height, data, mipmap, alpha ) {

	// See if the texture is already present
	if ( identifier && identifier.length > 0 ) {

		for ( let i = 0; i < numgltextures; i ++ ) {

			if ( gltextures[ i ].identifier === identifier ) {

				if ( width !== gltextures[ i ].width || height !== gltextures[ i ].height )
					Con_Printf( 'GL_LoadTexture: cache mismatch for ' + identifier + '\n' );
				return gltextures[ i ].texnum;

			}

		}

	}

	const glt = gltextures[ numgltextures ];
	numgltextures ++;

	glt.identifier = identifier;
	glt.texnum = texture_extension_number;
	glt.width = width;
	glt.height = height;
	glt.mipmap = mipmap;

	// In canvas 2D mode, create an ImageData or canvas for the texture
	if ( data && d_8to24table ) {

		const canvas = document.createElement( 'canvas' );
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext( '2d' );
		const imageData = ctx.createImageData( width, height );

		for ( let i = 0; i < width * height; i ++ ) {

			const palIdx = data[ i ];
			if ( alpha && palIdx === 255 ) {

				// transparent pixel
				imageData.data[ i * 4 ] = 0;
				imageData.data[ i * 4 + 1 ] = 0;
				imageData.data[ i * 4 + 2 ] = 0;
				imageData.data[ i * 4 + 3 ] = 0;

			} else {

				const rgba = d_8to24table[ palIdx ];
				imageData.data[ i * 4 ] = rgba & 0xff;
				imageData.data[ i * 4 + 1 ] = ( rgba >> 8 ) & 0xff;
				imageData.data[ i * 4 + 2 ] = ( rgba >> 16 ) & 0xff;
				imageData.data[ i * 4 + 3 ] = 255;

			}

		}

		ctx.putImageData( imageData, 0, 0 );

		// Store canvas reference on the texture
		glt.canvas = canvas;

	}

	texture_extension_number ++;

	return texture_extension_number - 1;

}

/*
================
GL_Upload8

Convert 8-bit palettized data to RGBA and upload
================
*/
export function GL_Upload8( data, width, height, mipmap, alpha ) {

	if ( ! d_8to24table ) return;

	const s = width * height;
	const trans = new Uint32Array( s );
	let noalpha = true;

	if ( alpha ) {

		for ( let i = 0; i < s; i ++ ) {

			const p = data[ i ];
			if ( p === 255 ) noalpha = false;
			trans[ i ] = d_8to24table[ p ];

		}

		if ( noalpha ) alpha = false;

	} else {

		for ( let i = 0; i < s; i ++ ) {

			trans[ i ] = d_8to24table[ data[ i ] ];

		}

	}

	GL_Upload32( trans, width, height, mipmap, alpha );

}

/*
================
GL_Upload32
================
*/
export function GL_Upload32( data, width, height, mipmap, alpha ) {

	// In canvas 2D mode, texture upload is handled differently
	// This is a stub for compatibility

}

/*
================
GL_FindTexture
================
*/
export function GL_FindTexture( identifier ) {

	for ( let i = 0; i < numgltextures; i ++ ) {

		if ( gltextures[ i ].identifier === identifier )
			return gltextures[ i ].texnum;

	}

	return - 1;

}

/*
================
Draw_SetCharset

Set the character set bitmap for console/HUD text rendering
================
*/
export function Draw_SetCharset( charsetCanvas ) {

	char_canvas = charsetCanvas;

}

/*
================
Draw_SetConback

Set the console background image
================
*/
export function Draw_SetConback( conbackPic ) {

	conback = conbackPic;

}

/*
================
Draw_SetDisc

Set the disc (loading) icon
================
*/
export function Draw_SetDisc( discPic ) {

	draw_disc = discPic;

}
