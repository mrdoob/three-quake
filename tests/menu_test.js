const cmd = await import( '../src/cmd.js' );
const keys = await import( '../src/keys.js' );
const menu = await import( '../src/menu.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'customize controls binds printable and named keys', () => {

	const oldBindings = keys.keybindings.slice();

	try {

		cmd.Cbuf_Init();
		cmd.Cmd_Init();
		keys.Key_Init();
		menu.M_Init();
		keys.keybindings.fill( null );

		cmd.Cmd_ExecuteString( 'menu_keys' );
		menu.M_Keydown( keys.K_ENTER );
		menu.M_Keydown( 49 );
		cmd.Cbuf_Execute();
		assertEqual( keys.keybindings[ 49 ], '+attack', 'printable key binding' );

		menu.M_Keydown( keys.K_ENTER );
		menu.M_Keydown( keys.K_MOUSE1 );
		cmd.Cbuf_Execute();
		assertEqual( keys.keybindings[ keys.K_MOUSE1 ], '+attack', 'mouse key binding' );

	} finally {

		keys.keybindings.splice( 0, keys.keybindings.length, ...oldBindings );

	}

} );
