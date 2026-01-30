// Ported from: WinQuake/in_win.c, WinQuake/input.h -- browser input system
// Adapted for web: uses Pointer Lock API for mouse, DOM keyboard events

import {
	K_TAB, K_ENTER, K_ESCAPE, K_SPACE, K_BACKSPACE,
	K_UPARROW, K_DOWNARROW, K_LEFTARROW, K_RIGHTARROW,
	K_ALT, K_CTRL, K_SHIFT,
	K_F1, K_F2, K_F3, K_F4, K_F5, K_F6, K_F7, K_F8, K_F9, K_F10, K_F11, K_F12,
	K_INS, K_DEL, K_PGDN, K_PGUP, K_HOME, K_END, K_PAUSE,
	K_MOUSE1, K_MOUSE2, K_MOUSE3,
	K_MWHEELUP, K_MWHEELDOWN,
	Key_Event,
	key_game, key_menu, key_dest
} from './keys.js';
import { Cvar_RegisterVariable } from './cvar.js';
import { Cmd_AddCommand } from './cmd.js';
import { Con_Printf } from './console.js';
import { cl, cls, ca_connected } from './client.js';
import { m_pitch, m_yaw, m_forward, m_side, lookstrafe } from './cl_main.js';
import { in_mlook, in_strafe, in_jump, in_attack, cl_forwardspeed, cl_sidespeed } from './cl_input.js';
import { V_StopPitchDrift } from './view.js';
import { PITCH, YAW } from './quakedef.js';
import {
	Touch_IsMobile, Touch_Init, Touch_Enable, Touch_Disable, Touch_IsEnabled,
	Touch_GetMoveInput, Touch_GetLookDelta, Touch_CheckJump,
	Touch_ShowMenu, Touch_HideMenu, Touch_SetMenuCallback, Touch_RequestFullscreen
} from './touch.js';
import { M_TouchInput } from './menu.js';
import { S_UnlockAudio } from './snd_dma.js';
import { VID_IsInVR, VID_GetXRManager } from './vid.js';
import { XR_GetInputState } from './xr_manager.js';

/*
===========================================================================

			BROWSER KEY MAPPING

Maps DOM event.code / event.key values to Quake K_* constants.
===========================================================================
*/

const codeToQuakeKey = {
	'Tab': K_TAB,
	'Enter': K_ENTER,
	'Escape': K_ESCAPE,
	'Space': K_SPACE,
	'Backspace': K_BACKSPACE,
	'ArrowUp': K_UPARROW,
	'ArrowDown': K_DOWNARROW,
	'ArrowLeft': K_LEFTARROW,
	'ArrowRight': K_RIGHTARROW,
	'AltLeft': K_ALT,
	'AltRight': K_ALT,
	'ControlLeft': K_CTRL,
	'ControlRight': K_CTRL,
	'ShiftLeft': K_SHIFT,
	'ShiftRight': K_SHIFT,
	'F1': K_F1,
	'F2': K_F2,
	'F3': K_F3,
	'F4': K_F4,
	'F5': K_F5,
	'F6': K_F6,
	'F7': K_F7,
	'F8': K_F8,
	'F9': K_F9,
	'F10': K_F10,
	'F11': K_F11,
	'F12': K_F12,
	'Insert': K_INS,
	'Delete': K_DEL,
	'PageDown': K_PGDN,
	'PageUp': K_PGUP,
	'Home': K_HOME,
	'End': K_END,
	'Pause': K_PAUSE,
};

/*
===========================================================================

			INPUT STATE

===========================================================================
*/

// Mouse state (replaces DirectInput mouse in in_win.c)
let mouse_x = 0;
let mouse_y = 0;
let old_mouse_x = 0;
let old_mouse_y = 0;
let mx_accum = 0;
let my_accum = 0;

let mouseinitialized = false;
let mouseactive = false;

// Pointer lock state
let pointerLocked = false;
let targetElement = null;

// Mobile/touch state
let isMobile = false;

// Wake Lock state (prevents screen from dimming/locking while playing)
let wakeLock = null;

// VR input edge detection state
let prevVRFirePressed = false;
let prevVRJumpPressed = false;

// cvars (matching in_win.c)
const m_filter = { name: 'm_filter', string: '0', value: 0 };
const sensitivity = { name: 'sensitivity', string: '3', value: 3 };

let in_initialized = false;

/*
===========================================================================

			BROWSER EVENT HANDLERS

===========================================================================
*/

function mapBrowserKeyToQuake( event ) {

	// First check code-based mapping (physical key location)
	if ( codeToQuakeKey[ event.code ] !== undefined ) {

		return codeToQuakeKey[ event.code ];

	}

	// For letter keys, map by code (e.g. 'KeyA' -> 97 'a')
	if ( event.code && event.code.startsWith( 'Key' ) ) {

		return event.code.charCodeAt( 3 ) + 32; // 'A'(65) + 32 = 'a'(97)

	}

	// For digit keys
	if ( event.code && event.code.startsWith( 'Digit' ) ) {

		return event.code.charCodeAt( 5 ); // '0'-'9' ascii

	}

	// Punctuation and other keys - use the key value
	if ( event.key && event.key.length === 1 ) {

		const code = event.key.charCodeAt( 0 );
		// Lowercase letters for quake
		if ( code >= 65 && code <= 90 )
			return code + 32;
		return code;

	}

	return 0;

}

function handleKeyDown( event ) {

	if ( ! in_initialized ) return;

	// Unlock audio on first user gesture
	S_UnlockAudio();

	const prevKeyDest = key_dest;

	const qkey = mapBrowserKeyToQuake( event );
	if ( qkey ) {

		Key_Event( qkey, true );

	}

	// Request pointer lock when transitioning into game (e.g. selecting "New Game")
	// This works because we're inside a user gesture (keydown event)
	// Only do this when actually playing, not during demo playback
	if ( key_dest === key_game && prevKeyDest !== key_game && ! cls.demoplayback ) {

		if ( isMobile ) {

			Touch_Enable();
			mouseactive = true;
			requestWakeLock(); // Keep screen on while playing

		} else if ( ! pointerLocked && targetElement && ! Touch_IsMobile() ) {

			targetElement.requestPointerLock();

		}

	}

	// Prevent browser defaults for game keys
	if ( event.code === 'Tab' || event.code === 'Escape' ||
		event.code === 'Space' || event.code === 'F5' ||
		event.code === 'F11' || event.code === 'F12' ) {

		// Allow escape to exit pointer lock
		if ( event.code !== 'Escape' ) {

			event.preventDefault();

		}

	}

}

function handleKeyUp( event ) {

	if ( ! in_initialized ) return;

	const qkey = mapBrowserKeyToQuake( event );
	if ( qkey ) {

		Key_Event( qkey, false );

	}

}

function handleMouseMove( event ) {

	if ( ! in_initialized || ! mouseactive ) return;

	// Pointer Lock API gives us movementX/Y directly
	mx_accum += event.movementX || 0;
	my_accum += event.movementY || 0;

}

function handleMouseDown( event ) {

	if ( ! in_initialized ) return;

	// Unlock audio on first user gesture
	S_UnlockAudio();

	let qkey;
	switch ( event.button ) {

		case 0: qkey = K_MOUSE1; break;
		case 2: qkey = K_MOUSE2; break;
		case 1: qkey = K_MOUSE3; break;
		default: return;

	}

	// Handle mouse clicks in the menu
	if ( key_dest === key_menu && event.button === 0 ) {

		// Get click position relative to target element
		const rect = targetElement.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		M_TouchInput( x, y, rect.width, rect.height );
		return;

	}

	// During demo playback, click to show menu
	if ( key_dest === key_game && cls.demoplayback && event.button === 0 ) {

		M_TouchInput( 0, 0, 1, 1 ); // Coordinates don't matter, just triggers menu toggle
		return;

	}

	// On mobile, request fullscreen + landscape and enable touch controls
	// Only when actually playing, not during demo playback
	if ( isMobile ) {

		// Request fullscreen only when actually playing a map (not menu, demo, or idle state)
		if ( key_dest === key_game && cls.state === ca_connected && ! cls.demoplayback ) {

			Touch_RequestFullscreen();

		}

		if ( key_dest === key_game && ! cls.demoplayback && ! Touch_IsEnabled() ) {

			Touch_Enable();
			mouseactive = true;
			requestWakeLock(); // Keep screen on while playing

		}

	} else {

		// Request pointer lock only when in-game (not menu/console or demos), and not on mobile
		if ( ! pointerLocked && targetElement && key_dest === key_game && ! cls.demoplayback && ! Touch_IsMobile() ) {

			targetElement.requestPointerLock();

		}

	}

	Key_Event( qkey, true );

}

function handleMouseUp( event ) {

	if ( ! in_initialized ) return;

	let qkey;
	switch ( event.button ) {

		case 0: qkey = K_MOUSE1; break;
		case 2: qkey = K_MOUSE2; break;
		case 1: qkey = K_MOUSE3; break;
		default: return;

	}

	Key_Event( qkey, false );

}

function handleWheel( event ) {

	if ( ! in_initialized ) return;

	if ( event.deltaY < 0 ) {

		Key_Event( K_MWHEELUP, true );
		Key_Event( K_MWHEELUP, false );

	} else if ( event.deltaY > 0 ) {

		Key_Event( K_MWHEELDOWN, true );
		Key_Event( K_MWHEELDOWN, false );

	}

}

function handlePointerLockChange() {

	const wasLocked = pointerLocked;
	pointerLocked = document.pointerLockElement === targetElement;

	if ( pointerLocked ) {

		mouseactive = true;
		requestWakeLock(); // Keep screen on while playing

	} else {

		mouseactive = false;

		// Show the menu when pointer lock is lost while in-game,
		// but only if we actually had pointer lock before (not on failed requests)
		// Skip this on mobile - touch controls handle menu via pause button
		if ( ! isMobile && wasLocked && key_dest === key_game ) {

			Key_Event( K_ESCAPE, true );
			Key_Event( K_ESCAPE, false );

		}

		// Release wake lock when not actively playing (desktop)
		if ( ! isMobile ) {

			releaseWakeLock();

		}

	}

}

function handleContextMenu( event ) {

	event.preventDefault();

}

/*
===========================================================================

			WAKE LOCK API

Prevents the screen from dimming or locking while the game is active.
===========================================================================
*/

async function requestWakeLock() {

	if ( wakeLock !== null ) return; // Already have a lock

	if ( 'wakeLock' in navigator ) {

		try {

			wakeLock = await navigator.wakeLock.request( 'screen' );
			Con_Printf( 'Wake Lock acquired - screen will stay on\n' );

			// Listen for the wake lock being released (e.g., tab becomes hidden)
			wakeLock.addEventListener( 'release', () => {

				wakeLock = null;

			} );

		} catch ( err ) {

			// Wake lock request can fail (e.g., low battery, permission denied)
			Con_Printf( 'Wake Lock request failed: ' + err.message + '\n' );

		}

	}

}

function releaseWakeLock() {

	if ( wakeLock !== null ) {

		wakeLock.release();
		wakeLock = null;
		Con_Printf( 'Wake Lock released\n' );

	}

}

function handleVisibilityChange() {

	// Re-acquire wake lock when tab becomes visible again (if we're in-game)
	if ( document.visibilityState === 'visible' && ( pointerLocked || ( isMobile && Touch_IsEnabled() ) ) ) {

		requestWakeLock();

	}

}

function handleTouchStart( event ) {

	if ( ! in_initialized ) return;

	// Unlock audio on first user gesture
	S_UnlockAudio();

	// On mobile, request fullscreen only when actually playing a map (not menu, demo, or idle state)
	if ( isMobile && key_dest === key_game && cls.state === ca_connected && ! cls.demoplayback ) {

		Touch_RequestFullscreen();

	}

	// During demo playback, tap to show menu
	if ( key_dest === key_game && cls.demoplayback ) {

		event.preventDefault();
		M_TouchInput( 0, 0, 1, 1 ); // Coordinates don't matter, just triggers menu toggle

	}

}

/*
===========================================================================

			PUBLIC API (matching in_win.c interface)

===========================================================================
*/

/*
===========
IN_Init
===========
*/
export function IN_Init( element ) {

	targetElement = element || document.body;

	// Register cvars
	Cvar_RegisterVariable( sensitivity );
	Cvar_RegisterVariable( m_filter );

	// Register commands
	Cmd_AddCommand( 'force_centerview', IN_ForceCenterView );

	// Set up event listeners
	document.addEventListener( 'keydown', handleKeyDown );
	document.addEventListener( 'keyup', handleKeyUp );

	targetElement.addEventListener( 'mousemove', handleMouseMove );
	targetElement.addEventListener( 'mousedown', handleMouseDown );
	targetElement.addEventListener( 'mouseup', handleMouseUp );
	targetElement.addEventListener( 'wheel', handleWheel );
	targetElement.addEventListener( 'contextmenu', handleContextMenu );

	document.addEventListener( 'pointerlockchange', handlePointerLockChange );

	// Add global touch handler for showing menu during demos
	targetElement.addEventListener( 'touchstart', handleTouchStart, { passive: false } );

	// Initialize touch controls for mobile
	isMobile = Touch_IsMobile();
	if ( isMobile ) {

		// Always append touch UI to document.body for consistent positioning
		Touch_Init( document.body );
		Touch_SetMenuCallback( M_TouchInput );
		Con_Printf( 'Mobile device detected - touch controls available\n' );

	}

	// Listen for visibility changes to re-acquire wake lock when tab becomes visible
	document.addEventListener( 'visibilitychange', handleVisibilityChange );

	mouseinitialized = true;
	in_initialized = true;

	Con_Printf( 'Browser input initialized\n' );

}

/*
===========
IN_Shutdown
===========
*/
export function IN_Shutdown() {

	if ( ! in_initialized ) return;

	document.removeEventListener( 'keydown', handleKeyDown );
	document.removeEventListener( 'keyup', handleKeyUp );

	if ( targetElement ) {

		targetElement.removeEventListener( 'mousemove', handleMouseMove );
		targetElement.removeEventListener( 'mousedown', handleMouseDown );
		targetElement.removeEventListener( 'mouseup', handleMouseUp );
		targetElement.removeEventListener( 'wheel', handleWheel );
		targetElement.removeEventListener( 'contextmenu', handleContextMenu );

	}

	document.removeEventListener( 'pointerlockchange', handlePointerLockChange );
	document.removeEventListener( 'visibilitychange', handleVisibilityChange );

	if ( pointerLocked && document.exitPointerLock ) {

		document.exitPointerLock();

	}

	// Release wake lock on shutdown
	releaseWakeLock();

	mouseactive = false;
	mouseinitialized = false;
	in_initialized = false;

}

/*
===========
IN_Commands

Joystick button events in original. Not needed for browser.
===========
*/
export function IN_Commands() {

	// No joystick handling needed in browser

}

/*
===========
IN_ForceCenterView
===========
*/
function IN_ForceCenterView() {

	// cl.viewangles[PITCH] = 0 -- set by the caller
	// In browser, we just need to reset accumulated mouse

}

/*
===========
IN_MouseMove

Called every frame to get mouse movement.
Returns accumulated movement since last call.
===========
*/
export function IN_MouseMove() {

	if ( ! mouseactive ) {

		return { mx: 0, my: 0 };

	}

	const currentMx = mx_accum;
	const currentMy = my_accum;

	mx_accum = 0;
	my_accum = 0;

	if ( m_filter.value ) {

		// average with last frame for smoothing
		mouse_x = ( currentMx + old_mouse_x ) * 0.5;
		mouse_y = ( currentMy + old_mouse_y ) * 0.5;

	} else {

		mouse_x = currentMx;
		mouse_y = currentMy;

	}

	old_mouse_x = currentMx;
	old_mouse_y = currentMy;

	mouse_x *= sensitivity.value;
	mouse_y *= sensitivity.value;

	return { mx: mouse_x, my: mouse_y };

}

/*
===========
IN_Move

Process all input movement for the current frame.
In the original, this called IN_MouseMove and IN_JoyMove.
===========
*/
export function IN_Move( cmd ) {

	// Check if we're in VR mode
	if ( VID_IsInVR() ) {

		// Get VR controller input
		const xrInput = XR_GetInputState();

		if ( ! cmd ) return;

		// Apply VR controller movement
		cmd.forwardmove += cl_forwardspeed.value * xrInput.moveForward;
		cmd.sidemove += cl_sidespeed.value * xrInput.moveRight;

		// Handle jump from VR controller (edge detection)
		if ( xrInput.jump && ! prevVRJumpPressed ) {

			// Rising edge - just pressed
			in_jump.state |= 1 + 2; // down + impulse down

		} else if ( xrInput.jump ) {

			// Held down
			in_jump.state |= 1; // down (no impulse)

		} else if ( prevVRJumpPressed ) {

			// Falling edge - just released
			in_jump.state &= ~1; // clear down
			in_jump.state |= 4; // impulse up

		}

		prevVRJumpPressed = xrInput.jump;

		// Handle attack from VR controller (edge detection)
		if ( xrInput.firePressed && ! prevVRFirePressed ) {

			// Rising edge - just pressed
			in_attack.state |= 1 + 2; // down + impulse down

		} else if ( xrInput.firePressed ) {

			// Held down - keep down bit set, clear impulse
			in_attack.state |= 1; // down (no impulse)
			in_attack.state &= ~2; // clear impulse down

		} else if ( prevVRFirePressed ) {

			// Falling edge - just released
			in_attack.state &= ~1; // clear down
			in_attack.state |= 4; // impulse up

		}

		prevVRFirePressed = xrInput.firePressed;

		// Apply right stick input to view angles (like mouse movement)
		// This controls the player's direction for movement
		const lookSpeed = sensitivity.value * 2.0; // Scale similar to mouse

		// Debug: always log joystick values
		if ( xrInput.moveForward !== 0 || xrInput.moveRight !== 0 || xrInput.lookX !== 0 || xrInput.lookY !== 0 ) {

			console.log( 'VR input: moveF=', xrInput.moveForward, 'moveR=', xrInput.moveRight, 'lookX=', xrInput.lookX, 'lookY=', xrInput.lookY );

		}

		if ( xrInput.lookX !== 0 || xrInput.lookY !== 0 ) {

			const oldYaw = cl.viewangles[ YAW ];
			cl.viewangles[ YAW ] -= xrInput.lookX * lookSpeed;
			cl.viewangles[ PITCH ] += xrInput.lookY * lookSpeed;
			console.log( 'VR look update: oldYaw=', oldYaw, 'newYaw=', cl.viewangles[ YAW ], 'delta=', ( cl.viewangles[ YAW ] - oldYaw ) );

		}

		// Clamp pitch
		if ( cl.viewangles[ PITCH ] > 80 )
			cl.viewangles[ PITCH ] = 80;
		if ( cl.viewangles[ PITCH ] < - 70 )
			cl.viewangles[ PITCH ] = - 70;

		return;

	}

	// Standard non-VR input handling
	let { mx, my } = IN_MouseMove();

	if ( ! cmd ) return;

	// Add touch input - touch look directly controls view angles (bypasses mlook checks)
	if ( Touch_IsEnabled() ) {

		const touchLook = Touch_GetLookDelta();

		// Apply touch look directly to view angles
		if ( touchLook.x !== 0 || touchLook.y !== 0 ) {

			cl.viewangles[ YAW ] -= m_yaw.value * touchLook.x * sensitivity.value * 2;

			cl.viewangles[ PITCH ] += m_pitch.value * touchLook.y * sensitivity.value * 2;
			if ( cl.viewangles[ PITCH ] > 80 )
				cl.viewangles[ PITCH ] = 80;
			if ( cl.viewangles[ PITCH ] < - 70 )
				cl.viewangles[ PITCH ] = - 70;

		}

		// Add touch joystick movement
		const touchMove = Touch_GetMoveInput();

		cmd.forwardmove += cl_forwardspeed.value * touchMove.forward;
		cmd.sidemove += cl_sidespeed.value * touchMove.right;

		// Check for jump from tap
		if ( Touch_CheckJump() ) {

			in_jump.state |= 1 + 2; // down + impulse down

		}

	}

	// add mouse X/Y movement to cmd (from in_win.c IN_MouseMove)
	if ( ( in_strafe.state & 1 ) || ( lookstrafe.value && ( in_mlook.state & 1 ) ) )
		cmd.sidemove += m_side.value * mx;
	else
		cl.viewangles[ YAW ] -= m_yaw.value * mx;

	if ( in_mlook.state & 1 )
		V_StopPitchDrift();

	if ( ( in_mlook.state & 1 ) && ! ( in_strafe.state & 1 ) ) {

		cl.viewangles[ PITCH ] += m_pitch.value * my;
		if ( cl.viewangles[ PITCH ] > 80 )
			cl.viewangles[ PITCH ] = 80;
		if ( cl.viewangles[ PITCH ] < - 70 )
			cl.viewangles[ PITCH ] = - 70;

	} else {

		cmd.forwardmove -= m_forward.value * my;

	}

}

/*
===========
IN_IsPointerLocked

Helper for browser-specific pointer lock state check
===========
*/
export function IN_IsPointerLocked() {

	return pointerLocked;

}

/*
===========
IN_RequestPointerLock

Request pointer lock from a user gesture context (e.g. menu selection).
Only applies on desktop; mobile uses fullscreen instead.
===========
*/
export function IN_RequestPointerLock() {

	if ( ! pointerLocked && targetElement && ! isMobile ) {

		targetElement.requestPointerLock();

	}

}

/*
===========
IN_IsMobile

Returns true if running on a mobile device
===========
*/
export function IN_IsMobile() {

	return isMobile;

}

/*
===========
IN_IsInVR

Returns true if currently in VR mode
===========
*/
export function IN_IsInVR() {

	return VID_IsInVR();

}

/*
===========
IN_UpdateTouch

Update touch control state based on key_dest.
Should be called each frame.
===========
*/
export function IN_UpdateTouch() {

	if ( ! isMobile ) return;

	if ( key_dest === key_game && ! cls.demoplayback ) {

		// In game (not demo) - show game controls, hide menu controls
		if ( ! Touch_IsEnabled() ) {

			Touch_Enable();
			mouseactive = true;

		}

		Touch_HideMenu();

	} else if ( key_dest === key_game && cls.demoplayback ) {

		// Demo playback - hide game controls, show menu overlay
		// Tapping will trigger menu via M_TouchInput which sends Escape
		if ( Touch_IsEnabled() ) {

			Touch_Disable();
			mouseactive = false;

		}

		Touch_ShowMenu();

	} else if ( key_dest === key_menu ) {

		// In menu - hide game controls, show menu controls
		if ( Touch_IsEnabled() ) {

			Touch_Disable();
			mouseactive = false;

		}

		Touch_ShowMenu();

	} else {

		// Console or other - hide all controls
		if ( Touch_IsEnabled() ) {

			Touch_Disable();
			mouseactive = false;

		}

		Touch_HideMenu();

	}

}
