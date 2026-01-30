// Ported from: WinQuake/vid.h -- video driver defs (browser/Three.js)

import * as THREE from 'three';
import { Sys_Error, Sys_Printf } from './sys.js';
import { Con_Printf } from './console.js';
import { XR_Init, XR_IsSupported, XR_IsPresenting, XR_GetManager } from './xr_manager.js';

//
// vid.h constants
//
export const VID_CBITS = 6;
export const VID_GRADES = ( 1 << VID_CBITS );

//============================================================================
// vrect_t
//============================================================================

export class vrect_t {

	constructor() {

		this.x = 0;
		this.y = 0;
		this.width = 0;
		this.height = 0;
		this.pnext = null;

	}

}

//============================================================================
// viddef_t -- global video state
//============================================================================

export class viddef_t {

	constructor() {

		this.buffer = null; // Uint8Array -- invisible buffer
		this.colormap = null; // Uint8Array -- 256 * VID_GRADES size
		this.colormap16 = null; // Uint16Array -- 256 * VID_GRADES size
		this.fullbright = 0; // index of first fullbright color
		this.rowbytes = 0; // may be > width if displayed in a window
		this.width = 0;
		this.height = 0;
		this.aspect = 0; // width / height -- < 0 is taller than wide
		this.numpages = 0;
		this.recalc_refdef = 0; // if true, recalc vid-based stuff
		this.conbuffer = null;
		this.conrowbytes = 0;
		this.conwidth = 0;
		this.conheight = 0;
		this.maxwarpwidth = 0;
		this.maxwarpheight = 0;
		this.direct = null; // direct drawing to framebuffer, if not NULL

	}

}

//============================================================================
// Globals
//============================================================================

export const vid = new viddef_t();

// palette lookup tables
export const d_8to16table = new Uint16Array( 256 );
export const d_8to24table = new Uint32Array( 256 );

// menu callback function pointers (stubs for browser)
export let vid_menudrawfn = null;
export let vid_menukeyfn = null;

//============================================================================
// Three.js renderer state (replaces raw GL context)
//============================================================================

export let renderer = null; // THREE.WebGLRenderer
export let canvas = null; // HTMLCanvasElement

// World container - holds all level geometry
// This can be rotated to convert coordinate systems for VR
export let worldContainer = null; // THREE.Group

//============================================================================
// VID_SetPalette
//
// Called at startup and after any gamma correction.
// Takes 256 entries of RGB byte triplets (768 bytes total).
//============================================================================

export function VID_SetPalette( palette ) {

	// palette is a Uint8Array of 768 bytes (256 * 3 RGB)
	if ( ! palette ) return;

	for ( let i = 0; i < 256; i ++ ) {

		const r = palette[ i * 3 + 0 ];
		const g = palette[ i * 3 + 1 ];
		const b = palette[ i * 3 + 2 ];

		// d_8to24table: RGBA packed as 32-bit unsigned
		// Quake uses ABGR byte order on little-endian (0xAABBGGRR)
		d_8to24table[ i ] = ( 255 << 24 ) | ( b << 16 ) | ( g << 8 ) | r;

		// d_8to16table: RGB565 format
		d_8to16table[ i ] = ( ( r >> 3 ) << 11 ) | ( ( g >> 2 ) << 5 ) | ( b >> 3 );

	}

	// index 255 is transparent (used for sprites, etc.)
	d_8to24table[ 255 ] = 0; // fully transparent black

}

//============================================================================
// VID_ShiftPalette
//
// Called for bonus and pain flashes, and for underwater color changes.
//============================================================================

export function VID_ShiftPalette( palette ) {

	// In the browser, palette shifts are handled by post-processing
	// or by a screen-space color overlay (see R_PolyBlend in gl_rmain.js).
	// For now, just update the lookup tables.
	VID_SetPalette( palette );

}

//============================================================================
// VID_Init
//
// Called at startup to set up translation tables.
// Takes 256 8-bit RGB values. The palette data will go away after the call,
// so it must be copied off if the video driver will need it again.
//
// For browser: creates a canvas and initializes Three.js WebGLRenderer.
//============================================================================

export function VID_Init( palette ) {

	Sys_Printf( 'VID_Init' );

	// default video dimensions
	vid.width = 640; // was 320 in software Quake
	vid.height = 480; // was 200 in software Quake
	vid.aspect = vid.width / vid.height;
	vid.numpages = 1;
	vid.rowbytes = vid.width;
	vid.conwidth = vid.width;
	vid.conheight = vid.height;
	vid.maxwarpwidth = 320;
	vid.maxwarpheight = 200;
	vid.fullbright = 256 - 32; // last 32 colors are fullbright in Quake palette
	vid.recalc_refdef = 1;

	// allocate buffers
	vid.buffer = new Uint8Array( vid.width * vid.height );
	vid.conbuffer = vid.buffer;
	vid.conrowbytes = vid.rowbytes;
	vid.colormap = new Uint8Array( 256 * VID_GRADES );

	// build palette lookup
	if ( palette ) {

		VID_SetPalette( palette );

	}

	// create canvas element
	canvas = document.createElement( 'canvas' );
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	canvas.style.display = 'block';
	document.body.appendChild( canvas );

	// update vid dimensions to match actual canvas
	vid.width = canvas.width;
	vid.height = canvas.height;
	vid.aspect = vid.width / vid.height;
	vid.rowbytes = vid.width;
	vid.conwidth = vid.width;
	vid.conheight = vid.height;

	// create Three.js WebGLRenderer (replaces raw GL context)
	renderer = new THREE.WebGLRenderer( {
		canvas: canvas,
		antialias: false, // Quake didn't have AA
		alpha: false,
		depth: true,
		stencil: false
	} );

	renderer.setSize( canvas.width, canvas.height );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.autoClear = false; // we manage clearing ourselves, like Quake did
	renderer.sortObjects = false; // we sort manually via BSP front-to-back

	// Enable tone mapping for brightness control
	// LinearToneMapping applies exposure without additional curve
	renderer.toneMapping = THREE.LinearToneMapping;
	renderer.toneMappingExposure = 1.0;

	// listen for window resize
	window.addEventListener( 'resize', function () {

		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		vid.width = canvas.width;
		vid.height = canvas.height;
		vid.aspect = vid.width / vid.height;
		vid.rowbytes = vid.width;
		vid.conwidth = vid.width;
		vid.conheight = vid.height;
		vid.recalc_refdef = 1;

		renderer.setSize( canvas.width, canvas.height );

	} );

	Con_Printf( 'WebGLRenderer initialized (' + vid.width + 'x' + vid.height + ')\n' );

}

//============================================================================
// VID_Shutdown
//
// Called at shutdown.
//============================================================================

export function VID_Shutdown() {

	Sys_Printf( 'VID_Shutdown' );

	if ( renderer ) {

		renderer.dispose();
		renderer = null;

	}

	if ( canvas && canvas.parentNode ) {

		canvas.parentNode.removeChild( canvas );
		canvas = null;

	}

}

//============================================================================
// VID_Update
//
// Flushes the given rectangles from the view buffer to the screen.
// In Three.js, the actual rendering is handled by renderer.render() in
// gl_rmain.js, so this is largely a no-op.
//============================================================================

export function VID_Update( rects ) {

	// Three.js handles buffer swaps internally via renderer.render()

}

//============================================================================
// VID_SetMode
//
// Sets the mode; only used by the Quake engine for resetting to mode 0
// (the base mode) on memory allocation failures.
//============================================================================

export function VID_SetMode( modenum, palette ) {

	// In browser, we only have one "mode" - the canvas size
	if ( palette ) {

		VID_SetPalette( palette );

	}

	vid.recalc_refdef = 1;

	return 1; // success

}

//============================================================================
// VID_HandlePause
//
// Called only on Win32, when pause happens, so the mouse can be released.
// In browser, we use Pointer Lock API instead.
//============================================================================

export function VID_HandlePause( pause ) {

	// Browser: Pointer Lock API handles this naturally
	// When paused, we can exit pointer lock if desired

}

//============================================================================
// VID_UpdateGamma
//
// Updates the renderer's tone mapping exposure based on the gamma cvar.
// In original Quake, gamma ranges from 0.5 (brightest) to 1.0 (normal).
// We map this to toneMappingExposure where 1.0 is normal and higher is brighter.
//============================================================================

export function VID_UpdateGamma( gamma ) {

	if ( ! renderer ) return;

	// Quake gamma: 0.5 = bright, 1.0 = normal
	// Exposure: higher = brighter
	// Base exposure of 1.5 to brighten the overall scene
	// Map gamma 0.5->3.0, 1.0->1.5 using: exposure = 1.5 / gamma
	renderer.toneMappingExposure = 1.5 / gamma;

}

//============================================================================
// VID_InitXR
//
// Initialize WebXR support. Call after VID_Init.
// Returns a promise that resolves to the XRManager or null if not supported.
//============================================================================

export async function VID_InitXR( scene, container ) {

	if ( ! renderer ) {

		Con_Printf( 'VID_InitXR: renderer not initialized\n' );
		return null;

	}

	const xrManager = await XR_Init( renderer, scene, container || document.body );

	if ( xrManager ) {

		Con_Printf( 'VID_InitXR: WebXR initialized\n' );

	}

	return xrManager;

}

//============================================================================
// VID_IsInVR
//
// Returns true if currently in VR mode
//============================================================================

export function VID_IsInVR() {

	return XR_IsPresenting();

}

//============================================================================
// VID_GetXRManager
//
// Get the XR manager instance
//============================================================================

export function VID_GetXRManager() {

	return XR_GetManager();

}

//============================================================================
// VID_SetAnimationLoop
//
// Set the animation loop for WebXR compatibility.
// This uses renderer.setAnimationLoop which is required for WebXR.
//============================================================================

export function VID_SetAnimationLoop( callback ) {

	if ( renderer ) {

		renderer.setAnimationLoop( callback );

	}

}

//============================================================================
// VID_CreateWorldContainer
//
// Create and return the world container group.
// Call this when initializing the scene.
//============================================================================

export function VID_CreateWorldContainer() {

	worldContainer = new THREE.Group();
	worldContainer.name = 'worldContainer';
	return worldContainer;

}

//============================================================================
// VID_GetWorldContainer
//
// Get the world container group
//============================================================================

export function VID_GetWorldContainer() {

	return worldContainer;

}

//============================================================================
// VID_RotateWorldForVR
//
// Rotate the world container to convert from Quake's Z-up to WebXR's Y-up.
// Call when entering VR.
//============================================================================

export function VID_RotateWorldForVR() {

	if ( worldContainer ) {

		worldContainer.rotation.order = 'XYZ';
		worldContainer.rotation.x = - Math.PI / 2;
		Con_Printf( 'World container rotated for VR\n' );

	}

}

//============================================================================
// VID_ResetWorldRotation
//
// Reset world container rotation for non-VR mode.
// Call when exiting VR.
//============================================================================

export function VID_ResetWorldRotation() {

	if ( worldContainer ) {

		worldContainer.rotation.set( 0, 0, 0 );
		Con_Printf( 'World container rotation reset\n' );

	}

}
