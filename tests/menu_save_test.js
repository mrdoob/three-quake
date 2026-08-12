// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const cmd = await import( '../src/cmd.js' );
const keys = await import( '../src/keys.js' );
const menu = await import( '../src/menu.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'load menu discovers and opens browser save slots', () => {

	const oldStorageDescriptor = Object.getOwnPropertyDescriptor( globalThis, 'localStorage' );
	const oldWindowDescriptor = Object.getOwnPropertyDescriptor( globalThis, 'window' );
	const saved = new Map();
	const comment = 'THE_NECROPOLIS_KILLS_12_15_____________';
	saved.set( 'quake_save_s0', '5\n' + comment + '\nrest' );
	Object.defineProperty( globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem( key ) { return saved.has( key ) ? saved.get( key ) : null; }
		}
	} );
	Object.defineProperty( globalThis, 'window', {
		configurable: true,
		value: { devicePixelRatio: 1 }
	} );

	let keyDestination = keys.key_game;
	let loadedSlot = null;
	const glyphs = [];

	try {

		cmd.Cbuf_Init();
		cmd.Cmd_Init();
		cmd.Cmd_AddCommand( 'load', () => {

			loadedSlot = cmd.Cmd_Argv( 1 );

		} );
		menu.M_Init();
		menu.M_SetExternals( {
			key_dest_set: ( value ) => { keyDestination = value; },
			key_dest_get: () => keyDestination,
			Draw_CachePic: () => ( { width: 0, height: 0 } ),
			Draw_Character: ( x, y, code ) => {

				if ( y === 52 && x >= 16 && x < 16 + 39 * 8 )
					glyphs.push( code - 128 );

			},
			S_LocalSound: () => {},
			SCR_BeginLoadingPlaque: () => {},
			IN_RequestPointerLock: () => {}
		} );

		cmd.Cmd_ExecuteString( 'menu_load' );
		assertEqual( menu.m_state, menu.m_load, 'load menu state' );
		assertEqual( keyDestination, keys.key_menu, 'load menu key destination' );
		menu.M_Draw();
		const drawnComment = String.fromCharCode( ...glyphs.slice( 0, 39 ) );
		assertEqual( drawnComment, comment.replace( /_/g, ' ' ), 'save comment text' );

		menu.M_Keydown( keys.K_ENTER );
		cmd.Cbuf_Execute();
		assertEqual( loadedSlot, 's0', 'selected save slot' );
		assertEqual( menu.m_state, menu.m_none, 'closed load menu state' );
		assertEqual( keyDestination, keys.key_game, 'game key destination' );

	} finally {

		if ( oldStorageDescriptor === undefined ) {

			delete globalThis.localStorage;

		} else {

			Object.defineProperty( globalThis, 'localStorage', oldStorageDescriptor );

		}
		if ( oldWindowDescriptor === undefined ) {

			delete globalThis.window;

		} else {

			Object.defineProperty( globalThis, 'window', oldWindowDescriptor );

		}

	}

} );
