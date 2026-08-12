// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const { sensitivity } = await import( '../src/cl_main.js' );
const cvar = await import( '../src/cvar.js' );
const input = await import( '../src/in_web.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function makeEventTarget() {

	const listeners = new Map();
	return {
		listeners: listeners,
		addEventListener( type, listener ) { listeners.set( type, listener ); },
		removeEventListener( type, listener ) {

			if ( listeners.get( type ) === listener ) listeners.delete( type );

		}
	};

}

Deno.test( 'mouse input uses the registered sensitivity cvar', () => {

	let registered = cvar.Cvar_FindVar( 'sensitivity' );
	if ( registered === null ) {

		cvar.Cvar_RegisterVariable( sensitivity );
		registered = cvar.Cvar_FindVar( 'sensitivity' );

	}
	assertEqual( registered, sensitivity, 'registered sensitivity binding' );

	const oldDocumentDescriptor = Object.getOwnPropertyDescriptor( globalThis, 'document' );
	const oldSensitivity = sensitivity.string;
	const documentTarget = makeEventTarget();
	const inputTarget = makeEventTarget();
	documentTarget.body = inputTarget;
	documentTarget.pointerLockElement = null;
	Object.defineProperty( globalThis, 'document', {
		configurable: true,
		value: documentTarget
	} );

	try {

		cvar.Cvar_Set( 'sensitivity', '7' );
		input.IN_Init( inputTarget );
		documentTarget.pointerLockElement = inputTarget;
		documentTarget.listeners.get( 'pointerlockchange' )();
		inputTarget.listeners.get( 'mousemove' )( { movementX: 2, movementY: - 1 } );

		const movement = input.IN_MouseMove();
		assertEqual( movement.mx, 14, 'horizontal mouse sensitivity' );
		assertEqual( movement.my, - 7, 'vertical mouse sensitivity' );

	} finally {

		input.IN_Shutdown();
		cvar.Cvar_Set( 'sensitivity', oldSensitivity );
		if ( oldDocumentDescriptor === undefined ) {

			delete globalThis.document;

		} else {

			Object.defineProperty( globalThis, 'document', oldDocumentDescriptor );

		}

	}

} );
