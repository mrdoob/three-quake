// Ported from: WinQuake/gl_screen.c -- GL screen management
// Master for refresh, status bar, console, chat, notify, etc

import { Con_Printf, Con_CheckResize, Con_DrawConsole, Con_DrawNotify, Con_ClearNotify,
	con_forcedup, Con_SetForcedup, con_initialized } from './console.js';
import { Sbar_Draw, Sbar_Changed, Sbar_IntermissionOverlay, Sbar_FinaleOverlay, SBAR_HEIGHT, set_sb_lines as Sbar_set_sb_lines } from './sbar.js';
import { M_Draw } from './menu.js';
import { Draw_Character, Draw_CachePic, Draw_Pic, Draw_FadeScreen, Draw_BeginFrame,
	GL_Set2D, Draw_TileClear, Draw_PicFromWad, Draw_GetUIScale,
	Draw_GetVirtualWidth, Draw_GetVirtualHeight } from './gl_draw.js';
import { Cvar_RegisterVariable, Cvar_Set, Cvar_VariableValue } from './cvar.js';
import { Cmd_AddCommand } from './cmd.js';
import { key_dest, key_game, key_console, key_message } from './keys.js';
import { realtime, host_frametime } from './host.js';
import { renderer } from './vid.js';
import { r_refdef as _r_refdef_canonical } from './render.js';

/*
==============================================================================

			GL SCREEN STATE

==============================================================================
*/

let glx = 0;
let gly = 0;
let glwidth = 640;
let glheight = 480;

let scr_copytop = 0;
let scr_copyeverything = 0;

export let scr_con_current = 0;
let scr_conlines = 0; // lines of console to display

let oldfov = 0;
let oldscreensize = 0;

export const scr_viewsize = { name: 'viewsize', string: '100', value: 100, archive: true };
const scr_fov = { name: 'fov', string: '90', value: 90 };
const scr_conspeed = { name: 'scr_conspeed', string: '300', value: 300 };
const scr_centertime = { name: 'scr_centertime', string: '2', value: 2 };
const scr_showram = { name: 'showram', string: '1', value: 1 };
const scr_showturtle = { name: 'showturtle', string: '0', value: 0 };
const scr_showpause = { name: 'showpause', string: '1', value: 1 };
const scr_printspeed = { name: 'scr_printspeed', string: '8', value: 8 };
const gl_triplebuffer = { name: 'gl_triplebuffer', string: '1', value: 1, archive: true };

export let scr_initialized = false;

let scr_ram = null;
let scr_net = null;
let scr_turtle = null;

let scr_fullupdate = 0;

let clearconsole = 0;
let clearnotify = 0;

let sb_lines = 0;

const scr_vrect = { x: 0, y: 0, width: 0, height: 0 };

export let scr_disabled_for_loading = false;
export let scr_drawloading = false;
let scr_disabled_time = 0;

let block_drawing = false;

// Center print
let scr_centerstring = '';
let scr_centertime_start = 0;
let scr_centertime_off = 0;
let scr_center_lines = 0;
let scr_erase_lines = 0;
let scr_erase_center = 0;

// Modal dialog
let scr_notifystring = '';
let scr_drawdialog = false;

// SIGNONS constant
const SIGNONS = 4;

/*
==============================================================================

			EXTERNAL REFERENCES

==============================================================================
*/

let _realVid = { width: 640, height: 480, numpages: 2, recalc_refdef: false };
const _vid = {
	get width() { return Draw_GetVirtualWidth(); },
	get height() { return Draw_GetVirtualHeight(); },
	get numpages() { return _realVid.numpages; },
	set numpages( v ) { _realVid.numpages = v; },
	get recalc_refdef() { return _realVid.recalc_refdef; },
	set recalc_refdef( v ) { _realVid.recalc_refdef = v; }
};
let _cls = { state: 0, signon: 0, demoplayback: false };
let _cl = { intermission: 0, paused: false, worldmodel: null, time: 0,
	last_received_message: 0 };
let _r_refdef = null; // deferred: set in SCR_Init to avoid circular dep in Deno
let _V_RenderView = null;
let _V_UpdatePalette = null;
let _GL_BeginRendering = null;
let _GL_EndRendering = null;
let _S_StopAllSounds = null;
let _r_cache_thrash = false;

export function SCR_SetExternals( externals ) {

	if ( externals.vid ) _realVid = externals.vid;
	if ( externals.cls ) _cls = externals.cls;
	if ( externals.cl ) _cl = externals.cl;
	if ( externals.r_refdef ) _r_refdef = externals.r_refdef;
	if ( externals.V_RenderView ) _V_RenderView = externals.V_RenderView;
	if ( externals.V_UpdatePalette ) _V_UpdatePalette = externals.V_UpdatePalette;
	if ( externals.GL_BeginRendering ) _GL_BeginRendering = externals.GL_BeginRendering;
	if ( externals.GL_EndRendering ) _GL_EndRendering = externals.GL_EndRendering;
	if ( externals.S_StopAllSounds ) _S_StopAllSounds = externals.S_StopAllSounds;

}

/*
==============
SCR_CenterPrint

Called for important messages that should stay in the center of the screen
for a few moments
==============
*/
export function SCR_CenterPrint( str ) {

	scr_centerstring = str.substring( 0, 1023 );
	scr_centertime_off = scr_centertime.value;
	scr_centertime_start = _cl.time;

	// count the number of lines for centering
	scr_center_lines = 1;
	for ( let i = 0; i < str.length; i ++ ) {

		if ( str[ i ] === '\n' )
			scr_center_lines ++;

	}

}

/*
==============
SCR_DrawCenterString
==============
*/
function SCR_DrawCenterString() {

	let remaining;

	// the finale prints the characters one at a time
	if ( _cl.intermission )
		remaining = Math.floor( scr_printspeed.value * ( _cl.time - scr_centertime_start ) );
	else
		remaining = 9999;

	scr_erase_center = 0;

	let start = 0;
	let y;

	if ( scr_center_lines <= 4 )
		y = Math.floor( _vid.height * 0.35 );
	else
		y = 48;

	while ( start < scr_centerstring.length ) {

		// scan the width of the line
		let l;
		for ( l = 0; l < 40; l ++ ) {

			if ( start + l >= scr_centerstring.length || scr_centerstring[ start + l ] === '\n' )
				break;

		}

		const x = Math.floor( ( _vid.width - l * 8 ) / 2 );

		for ( let j = 0; j < l; j ++ ) {

			Draw_Character( x + j * 8, y, scr_centerstring.charCodeAt( start + j ) );
			if ( remaining -- === 0 )
				return;

		}

		y += 8;

		// skip past the line
		while ( start < scr_centerstring.length && scr_centerstring[ start ] !== '\n' )
			start ++;

		if ( start >= scr_centerstring.length )
			break;

		start ++; // skip the \n

	}

}

function SCR_CheckDrawCenterString() {

	scr_copytop = 1;

	if ( scr_center_lines > scr_erase_lines )
		scr_erase_lines = scr_center_lines;

	scr_centertime_off -= host_frametime;

	if ( scr_centertime_off <= 0 && ! _cl.intermission )
		return;
	if ( key_dest !== key_game )
		return;

	SCR_DrawCenterString();

}

/*
====================
CalcFov
====================
*/
function CalcFov( fov_x, width, height ) {

	if ( fov_x < 1 || fov_x > 179 )
		fov_x = 90;

	const x = width / Math.tan( fov_x / 360 * Math.PI );
	let a = Math.atan( height / x );
	a = a * 360 / Math.PI;
	return a;

}

/*
====================
CalcFovX

Inverse of CalcFov - given vertical FOV, calculate horizontal FOV
====================
*/
function CalcFovX( fov_y, width, height ) {

	if ( fov_y < 1 || fov_y > 179 )
		fov_y = 90;

	const y = height / Math.tan( fov_y / 360 * Math.PI );
	let a = Math.atan( width / y );
	a = a * 360 / Math.PI;
	return a;

}

/*
=================
SCR_CalcRefdef

Must be called whenever vid changes
Internal use only
=================
*/
function SCR_CalcRefdef() {

	scr_fullupdate = 0; // force a background redraw
	_vid.recalc_refdef = false;
	_r_refdef.vrectScale = Draw_GetUIScale();

	// force the status bar to redraw
	Sbar_Changed();

	// bound viewsize
	if ( scr_viewsize.value < 30 )
		Cvar_Set( 'viewsize', '30' );
	if ( scr_viewsize.value > 120 )
		Cvar_Set( 'viewsize', '120' );

	// bound field of view
	if ( scr_fov.value < 10 )
		Cvar_Set( 'fov', '10' );
	if ( scr_fov.value > 170 )
		Cvar_Set( 'fov', '170' );

	// intermission is always full screen
	let size;
	if ( _cl.intermission )
		size = 120;
	else
		size = scr_viewsize.value;

	if ( size >= 120 )
		sb_lines = 0; // no status bar at all
	else if ( size >= 110 )
		sb_lines = 24; // no inventory
	else
		sb_lines = 24 + 16 + 8;
	Sbar_set_sb_lines( sb_lines );

	let full = false;
	if ( scr_viewsize.value >= 100.0 ) {

		full = true;
		size = 100.0;

	} else {

		size = scr_viewsize.value;

	}

	if ( _cl.intermission ) {

		full = true;
		size = 100;
		sb_lines = 0;
		Sbar_set_sb_lines( sb_lines );

	}

	size /= 100.0;

	const h = _vid.height - sb_lines;

	_r_refdef.vrect.width = Math.floor( _vid.width * size );
	if ( _r_refdef.vrect.width < 96 ) {

		size = 96.0 / _r_refdef.vrect.width;
		_r_refdef.vrect.width = 96; // min for icons

	}

	_r_refdef.vrect.height = Math.floor( _vid.height * size );
	if ( _r_refdef.vrect.height > _vid.height - sb_lines )
		_r_refdef.vrect.height = _vid.height - sb_lines;
	if ( _r_refdef.vrect.height > _vid.height )
		_r_refdef.vrect.height = _vid.height;

	_r_refdef.vrect.x = Math.floor( ( _vid.width - _r_refdef.vrect.width ) / 2 );

	if ( full )
		_r_refdef.vrect.y = 0;
	else
		_r_refdef.vrect.y = Math.floor( ( h - _r_refdef.vrect.height ) / 2 );

	// Hor+ FOV: lock vertical FOV to what fov cvar gives at 4:3,
	// then expand horizontal FOV for the actual aspect ratio.
	_r_refdef.fov_y = CalcFov( scr_fov.value, 4, 3 );
	_r_refdef.fov_x = CalcFovX( _r_refdef.fov_y, _r_refdef.vrect.width, _r_refdef.vrect.height );

	scr_vrect.x = _r_refdef.vrect.x;
	scr_vrect.y = _r_refdef.vrect.y;
	scr_vrect.width = _r_refdef.vrect.width;
	scr_vrect.height = _r_refdef.vrect.height;

}

/*
=================
SCR_SizeUp_f

Keybinding command
=================
*/
function SCR_SizeUp_f() {

	scr_viewsize.value += 10;
	if ( scr_viewsize.value > 120 )
		scr_viewsize.value = 120;
	_vid.recalc_refdef = true;

}

/*
=================
SCR_SizeDown_f

Keybinding command
=================
*/
function SCR_SizeDown_f() {

	scr_viewsize.value -= 10;
	if ( scr_viewsize.value < 30 )
		scr_viewsize.value = 30;
	_vid.recalc_refdef = true;

}

/*
==================
SCR_Init
==================
*/
export function SCR_Init() {

	if ( _r_refdef === null ) _r_refdef = _r_refdef_canonical;

	Cvar_RegisterVariable( scr_fov );
	Cvar_RegisterVariable( scr_viewsize );
	Cvar_RegisterVariable( scr_conspeed );
	Cvar_RegisterVariable( scr_showram );
	Cvar_RegisterVariable( scr_showturtle );
	Cvar_RegisterVariable( scr_showpause );
	Cvar_RegisterVariable( scr_centertime );
	Cvar_RegisterVariable( scr_printspeed );
	Cvar_RegisterVariable( gl_triplebuffer );

	//
	// register our commands
	//
	Cmd_AddCommand( 'screenshot', SCR_ScreenShot_f );
	Cmd_AddCommand( 'sizeup', SCR_SizeUp_f );
	Cmd_AddCommand( 'sizedown', SCR_SizeDown_f );

	scr_ram = Draw_PicFromWad( 'ram' );
	scr_net = Draw_PicFromWad( 'net' );
	scr_turtle = Draw_PicFromWad( 'turtle' );

	scr_initialized = true;

}

/*
==============
SCR_DrawRam
==============
*/
function SCR_DrawRam() {

	if ( ! scr_showram.value )
		return;

	// r_cache_thrash is not applicable in Three.js port

}

/*
==============
SCR_DrawTurtle
==============
*/
let turtle_count = 0;

function SCR_DrawTurtle() {

	if ( ! scr_showturtle.value )
		return;

	if ( host_frametime < 0.1 ) {

		turtle_count = 0;
		return;

	}

	turtle_count ++;
	if ( turtle_count < 3 )
		return;

	Draw_Pic( scr_vrect.x, scr_vrect.y, scr_turtle );

}

/*
==============
SCR_DrawNet
==============
*/
function SCR_DrawNet() {

	if ( realtime - _cl.last_received_message < 0.3 )
		return;
	if ( _cls.demoplayback )
		return;

	Draw_Pic( scr_vrect.x + 64, scr_vrect.y, scr_net );

}

/*
==============
SCR_DrawPause
==============
*/
function SCR_DrawPause() {

	if ( ! scr_showpause.value )
		return;

	if ( ! _cl.paused )
		return;

	const pic = Draw_CachePic( 'gfx/pause.lmp' );
	if ( pic )
		Draw_Pic( ( _vid.width - ( pic.width || 0 ) ) / 2,
			( _vid.height - 48 - ( pic.height || 0 ) ) / 2, pic );

}

/*
==============
SCR_DrawLoading
==============
*/
export function SCR_DrawLoading() {

	if ( ! scr_drawloading )
		return;

	const pic = Draw_CachePic( 'gfx/loading.lmp' );
	if ( pic )
		Draw_Pic( ( _vid.width - ( pic.width || 0 ) ) / 2,
			( _vid.height - 48 - ( pic.height || 0 ) ) / 2, pic );

}

/*
==================
SCR_SetUpToDrawConsole
==================
*/
function SCR_SetUpToDrawConsole() {

	Con_CheckResize();

	if ( scr_drawloading )
		return; // never a console with loading plaque

	// decide on the height of the console
	const forcedup = ! _cl.worldmodel || _cls.signon !== SIGNONS;
	Con_SetForcedup( forcedup );

	if ( forcedup ) {

		scr_conlines = _vid.height; // full screen
		scr_con_current = scr_conlines;

	} else if ( key_dest === key_console ) {

		scr_conlines = _vid.height / 2; // half screen

	} else {

		scr_conlines = 0; // none visible

	}

	if ( scr_conlines < scr_con_current ) {

		scr_con_current -= scr_conspeed.value * host_frametime;
		if ( scr_conlines > scr_con_current )
			scr_con_current = scr_conlines;

	} else if ( scr_conlines > scr_con_current ) {

		scr_con_current += scr_conspeed.value * host_frametime;
		if ( scr_conlines < scr_con_current )
			scr_con_current = scr_conlines;

	}

	if ( clearconsole ++ < _vid.numpages ) {

		Sbar_Changed();

	} else if ( clearnotify ++ < _vid.numpages ) {

		// nothing

	} else {

		// con_notifylines = 0; -- handled via console module

	}

}

/*
==================
SCR_DrawConsole
==================
*/
function SCR_DrawConsole() {

	if ( scr_con_current ) {

		scr_copyeverything = 1;
		Con_DrawConsole( scr_con_current, true );
		clearconsole = 0;

	} else {

		if ( key_dest === key_game || key_dest === key_message )
			Con_DrawNotify(); // only draw notify in game

	}

}

/*
==================
SCR_DrawNotifyString
==================
*/
function SCR_DrawNotifyString() {

	let start = 0;
	let y = Math.floor( _vid.height * 0.35 );

	while ( start < scr_notifystring.length ) {

		let l;
		for ( l = 0; l < 40; l ++ ) {

			if ( start + l >= scr_notifystring.length || scr_notifystring[ start + l ] === '\n' )
				break;

		}

		const x = Math.floor( ( _vid.width - l * 8 ) / 2 );
		for ( let j = 0; j < l; j ++ )
			Draw_Character( x + j * 8, y, scr_notifystring.charCodeAt( start + j ) );

		y += 8;

		while ( start < scr_notifystring.length && scr_notifystring[ start ] !== '\n' )
			start ++;

		if ( start >= scr_notifystring.length )
			break;

		start ++; // skip the \n

	}

}

/*
==================
SCR_TileClear
==================
*/
function SCR_TileClear() {

	if ( _r_refdef.vrect.x > 0 ) {

		// left
		Draw_TileClear( 0, 0, _r_refdef.vrect.x, _vid.height - sb_lines );
		// right
		Draw_TileClear( _r_refdef.vrect.x + _r_refdef.vrect.width, 0,
			_vid.width - _r_refdef.vrect.x + _r_refdef.vrect.width,
			_vid.height - sb_lines );

	}

	if ( _r_refdef.vrect.y > 0 ) {

		// top
		Draw_TileClear( _r_refdef.vrect.x, 0,
			_r_refdef.vrect.x + _r_refdef.vrect.width,
			_r_refdef.vrect.y );
		// bottom
		Draw_TileClear( _r_refdef.vrect.x,
			_r_refdef.vrect.y + _r_refdef.vrect.height,
			_r_refdef.vrect.width,
			_vid.height - sb_lines -
			( _r_refdef.vrect.height + _r_refdef.vrect.y ) );

	}

}

/*
==============
SCR_ScreenShot_f
==============
*/
let _screenshotPending = false;

function SCR_ScreenShot_f() {

	_screenshotPending = true;
	Con_Printf( 'Capturing screenshot...\n' );

}

function SCR_DoScreenShot() {

	if ( renderer == null ) {

		Con_Printf( 'Screenshot: renderer not initialized\n' );
		return;

	}

	const canvas = renderer.domElement;

	try {

		// toDataURL is synchronous — reads the buffer before it's cleared
		const dataURL = canvas.toDataURL( 'image/png' );

		const link = document.createElement( 'a' );
		link.download = 'quake_screenshot.png';
		link.href = dataURL;
		link.click();

		Con_Printf( 'Screenshot saved\n' );

	} catch ( e ) {

		Con_Printf( 'Screenshot failed: ' + e.message + '\n' );

	}

}

/*
===============
SCR_BeginLoadingPlaque
================
*/
export function SCR_BeginLoadingPlaque() {

	if ( _S_StopAllSounds ) _S_StopAllSounds( true );

	if ( _cls.state !== 2 ) // ca_connected
		return;
	if ( _cls.signon !== SIGNONS )
		return;

	// redraw with no console and the loading plaque
	Con_ClearNotify();
	scr_centertime_off = 0;
	scr_con_current = 0;

	scr_drawloading = true;
	scr_fullupdate = 0;
	Sbar_Changed();
	SCR_UpdateScreen();
	scr_drawloading = false;

	scr_disabled_for_loading = true;
	scr_disabled_time = realtime;
	scr_fullupdate = 0;

}

/*
===============
SCR_EndLoadingPlaque
================
*/
export function SCR_EndLoadingPlaque() {

	scr_disabled_for_loading = false;
	scr_fullupdate = 0;
	Con_ClearNotify();

}

/*
==================
SCR_UpdateScreen

This is called every frame, and can also be called explicitly to flush
text to the screen.

WARNING: be very careful calling this from elsewhere, because the refresh
needs almost the entire 256k of stack space!
==================
*/
export function SCR_UpdateScreen() {

	if ( block_drawing )
		return;

	_vid.numpages = 2 + gl_triplebuffer.value;

	scr_copytop = 0;
	scr_copyeverything = 0;

	if ( scr_disabled_for_loading ) {

		if ( realtime - scr_disabled_time > 60 ) {

			scr_disabled_for_loading = false;
			Con_Printf( 'load failed.\n' );

		} else {

			return;

		}

	}

	if ( ! scr_initialized || ! con_initialized )
		return; // not initialized yet

	// GL_BeginRendering
	if ( _GL_BeginRendering ) _GL_BeginRendering();

	// Clear 2D overlay
	Draw_BeginFrame();

	//
	// determine size of refresh window
	//
	if ( oldfov !== scr_fov.value ) {

		oldfov = scr_fov.value;
		_vid.recalc_refdef = true;

	}

	if ( oldscreensize !== scr_viewsize.value ) {

		oldscreensize = scr_viewsize.value;
		_vid.recalc_refdef = true;

	}

	if ( _vid.recalc_refdef )
		SCR_CalcRefdef();

	//
	// do 3D refresh drawing, and then update the screen
	//
	SCR_SetUpToDrawConsole();

	if ( _V_RenderView ) _V_RenderView();

	GL_Set2D();

	//
	// draw any areas not covered by the refresh
	//
	SCR_TileClear();

	if ( scr_drawdialog ) {

		Sbar_Draw();
		Draw_FadeScreen();
		SCR_DrawNotifyString();
		scr_copyeverything = 1;

	} else if ( scr_drawloading ) {

		SCR_DrawLoading();
		Sbar_Draw();

	} else if ( _cl.intermission === 1 && key_dest === key_game ) {

		Sbar_IntermissionOverlay();

	} else if ( _cl.intermission === 2 && key_dest === key_game ) {

		Sbar_FinaleOverlay();
		SCR_CheckDrawCenterString();

	} else {

		if ( Cvar_VariableValue( 'crosshair' ) !== 0 && _cls.demoplayback === false )
			Draw_Character( Math.floor( _vid.width / 2 + Cvar_VariableValue( 'cl_crossx' ) ) - 4,
				Math.floor( _vid.height / 2 + Cvar_VariableValue( 'cl_crossy' ) ) - 4, 43 ); // '+' crosshair

		SCR_DrawRam();
		SCR_DrawNet();
		SCR_DrawTurtle();
		SCR_DrawPause();
		SCR_CheckDrawCenterString();
		Sbar_Draw();
		SCR_DrawConsole();
		M_Draw();

	}

	if ( _V_UpdatePalette ) _V_UpdatePalette();

	// GL_EndRendering
	if ( _GL_EndRendering ) _GL_EndRendering();

	// Capture screenshot after render, while draw buffer is still valid
	if ( _screenshotPending ) {

		_screenshotPending = false;
		SCR_DoScreenShot();

	}

}
