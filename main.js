// Three-Quake entry point
// Equivalent to WinQuake/sys_win.c WinMain() + main()

import { Sys_Init, Sys_Printf, Sys_Error } from './src/sys.js';
import { COM_InitArgv } from './src/common.js';
import { Host_Init, Host_Frame, Host_Shutdown } from './src/host.js';
import { COM_FetchPak, COM_AddPack, COM_PreloadMaps } from './src/pak.js';
import { Cbuf_AddText } from './src/cmd.js';
import { cls, cl } from './src/client.js';
import { sv } from './src/server.js';
import { scene, camera, R_GetScene, R_ResetVRBaseYaw } from './src/gl_rmain.js';
import { renderer, VID_InitXR, VID_IsInVR, VID_GetXRManager, VID_SetAnimationLoop, VID_RotateWorldForVR, VID_ResetWorldRotation } from './src/vid.js';
import { Draw_CachePicFromPNG } from './src/gl_draw.js';
import { XR_Update } from './src/xr_manager.js';
import { key_dest, key_menu, key_game, set_key_dest } from './src/keys.js';
import { M_ToggleMenu_f } from './src/menu.js';

const parms = {
	basedir: '.',
	argc: 0,
	argv: []
};

async function main() {

	try {

		Sys_Init();

		COM_InitArgv( parms.argv );

		// Loading bar
		const loadingProgress = document.getElementById( 'loading-progress' );
		const loadingOverlay = document.getElementById( 'loading' );

		function setProgress( value ) {

			if ( loadingProgress ) {

				loadingProgress.style.width = ( value * 100 ) + '%';

			}

		}

		// Load pak0.pak from the same directory
		Sys_Printf( 'Loading pak0.pak...\\n' );
		const pak0 = await COM_FetchPak( 'pak0.pak', 'pak0.pak', setProgress );
		if ( pak0 ) {

			COM_AddPack( pak0 );
			Sys_Printf( 'pak0.pak loaded successfully\\n' );

		} else {

			Sys_Printf( 'Warning: pak0.pak not found - game data will be missing\\n' );

		}

		// Optionally load pak1.pak (registered version)
		try {

			const pak1 = await COM_FetchPak( 'pak1.pak', 'pak1.pak' );
			if ( pak1 ) {

				COM_AddPack( pak1 );
				Sys_Printf( 'pak1.pak loaded successfully\\n' );

			}

		} catch ( e ) {

			// pak1.pak is optional (shareware doesn't have it)

		}

		// Preload custom deathmatch maps (not in PAK files)
		await COM_PreloadMaps( [
			'spinev2',   // Headshot
			'rapture1',  // Danimal
			'naked5',    // Gandhi
			'zed',       // Vondur
			'efdm9',     // Mr Fribbles
			'baldm6',    // Bal
			'edc',       // Tyrann
			'ultrav'     // Escher
		] );

		await Host_Init( parms );

		// Remove loading overlay
		if ( loadingOverlay ) {

			loadingOverlay.remove();

		}

		// Preload custom menu images
		try {

			await Draw_CachePicFromPNG( 'gfx/continue.lmp', 'img/continue.png' );
			Sys_Printf( 'Loaded custom menu images\\n' );

		} catch ( e ) {

			Sys_Printf( 'Warning: Could not load custom menu images\\n' );

		}

		// Check URL parameters for auto-join
		const urlParams = new URLSearchParams( window.location.search );
		const roomId = urlParams.get( 'room' );

		if ( roomId ) {

			const serverUrl = urlParams.get( 'server' ) || 'https://wts.mrdoob.com:4433';
			const connectUrl = serverUrl + '?room=' + encodeURIComponent( roomId );
			Sys_Printf( 'Auto-joining room: %s\\n', roomId );
			Cbuf_AddText( 'connect "' + connectUrl + '"\n' );

		}

		// Expose for debugging
		window.Cbuf_AddText = Cbuf_AddText;
		window.cls = cls;
		window.cl = cl;
		window.sv = sv;
		window.scene = scene;
		Object.defineProperty( window, 'camera', { get: () => camera } );
		Object.defineProperty( window, 'renderer', { get: () => renderer } );

		// Initialize WebXR if supported
		let xrManager = null;
		try {

			const gameScene = R_GetScene();
			xrManager = await VID_InitXR( gameScene, document.body );

			if ( xrManager ) {

				Sys_Printf( 'WebXR initialized\\n' );

				// Handle VR session start
				xrManager.onSessionStart = () => {

					console.log( 'VR session started (main.js)' );

					// Rotate world for VR coordinate system
					VID_RotateWorldForVR();

					// Add camera to XR rig when entering VR
					const cameraRig = xrManager.getCameraRig();
					cameraRig.add( camera );
					camera.position.set( 0, 0, 0 );
					camera.rotation.set( 0, 0, 0 );

					// If in menu, switch to game mode
					if ( key_dest === key_menu ) {

						set_key_dest( key_game );

					}

					// Start a new game if not already running
					if ( ! sv.active && ! cls.demoplayback ) {

						Cbuf_AddText( 'map start\\n' );

					}

				};

				// Handle VR session end
				xrManager.onSessionEnd = () => {

					console.log( 'VR session ended (main.js)' );

					// Remove camera from XR rig
					const cameraRig = xrManager.getCameraRig();
					cameraRig.remove( camera );
					gameScene.add( camera );

					// Reset world rotation and VR base yaw
					VID_ResetWorldRotation();
					R_ResetVRBaseYaw();

					// Show menu
					M_ToggleMenu_f();

				};

				// Handle trigger fire in VR
				xrManager.onFire = () => {

					// Fire is handled through input state polling in IN_Move
					// This callback is for immediate feedback if needed

				};

			}

		} catch ( e ) {

			Sys_Printf( 'WebXR initialization failed: ' + e.message + '\\n' );

		}

		let oldtime = performance.now() / 1000;

		function frame( time, xrFrame ) {

			const newtime = performance.now() / 1000;
			const frameTime = newtime - oldtime;
			oldtime = newtime;

			// Update XR input state each frame
			if ( VID_IsInVR() ) {

				XR_Update( frameTime );

			}

			Host_Frame( frameTime );

		}

		// Use setAnimationLoop for WebXR compatibility
		// This handles both VR and non-VR rendering properly
		VID_SetAnimationLoop( frame );

	} catch ( e ) {

		console.error( 'Three-Quake Fatal Error:', e );
		Sys_Error( e.message );

	}

}

main();
