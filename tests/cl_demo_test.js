// Bootstrap the renderer's existing circular module graph in its safe order.
await import( '../src/gl_rsurf.js' );

const common = await import( '../src/common.js' );
const cmd = await import( '../src/cmd.js' );
const demo = await import( '../src/cl_demo.js' );
const net = await import( '../src/net.js' );
const { cl, cls, ca_disconnected } = await import( '../src/client.js' );
const { svc_nop, svc_disconnect } = await import( '../src/protocol.js' );

function assertEqual( actual, expected, message ) {

	if ( actual !== expected )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

function assertNear( actual, expected, message ) {

	if ( Number.isFinite( actual ) === false || Math.abs( actual - expected ) > 0.00001 )
		throw new Error( `${message}: expected ${expected}, got ${actual}` );

}

Deno.test( 'demo recording writes each received non-keepalive message', async () => {

	const driver = net.net_drivers[ 7 ];
	const oldGetMessage = driver.QGetMessage;
	const oldCommonNetMessage = common.net_message;
	const oldNetData = net.net_message.data;
	const oldNetMaxsize = net.net_message.maxsize;
	const oldNetCursize = net.net_message.cursize;
	const oldState = cls.state;
	const oldNetcon = cls.netcon;
	const oldPlayback = cls.demoplayback;
	const oldRecording = cls.demorecording;
	const oldDemofile = cls.demofile;
	const oldForcetrack = cls.forcetrack;
	const oldAngles = new Float32Array( cl.viewangles );
	const oldURLDescriptor = Object.getOwnPropertyDescriptor( globalThis, 'URL' );
	const oldDocumentDescriptor = Object.getOwnPropertyDescriptor( globalThis, 'document' );
	let capturedBlob = null;
	let messageIndex = 0;
	let recordingStarted = false;

	Object.defineProperty( globalThis, 'URL', {
		configurable: true,
		value: {
			createObjectURL( blob ) { capturedBlob = blob; return 'blob:test-demo'; },
			revokeObjectURL() {}
		}
	} );
	Object.defineProperty( globalThis, 'document', {
		configurable: true,
		value: {
			createElement() {

				return { href: '', download: '', click() {} };

			}
		}
	} );

	try {

		common.SZ_Alloc( net.net_message, 256 );
		common.COM_SetNetMessage( net.net_message );
		cls.state = ca_disconnected;
		cls.demoplayback = false;
		cls.netcon = {
			driver: 7,
			disconnected: false,
			lastMessageTime: 0
		};
		cl.viewangles.set( [ 12.5, - 90.25, 3.75 ] );
		driver.QGetMessage = () => {

			common.SZ_Clear( net.net_message );
			if ( messageIndex ++ === 0 ) {

				net.net_message.data[ 0 ] = svc_nop;
				net.net_message.cursize = 1;
				return 1;

			}
			if ( messageIndex === 2 ) {

				net.net_message.data.set( [ 0x10, 0x20, 0x30 ], 0 );
				net.net_message.cursize = 3;
				return 2;

			}
			net.net_message.data.set( [ 0x40, 0x50 ], 0 );
			net.net_message.cursize = 2;
			return 1;

		};

		cmd.Cmd_TokenizeString( 'record capture' );
		demo.CL_Record_f();
		recordingStarted = true;
		assertEqual( demo.CL_GetMessage(), 2, 'unreliable network message result' );
		cl.viewangles.set( [ - 1.5, 2.25, 180 ] );
		assertEqual( demo.CL_GetMessage(), 1, 'reliable network message result' );
		cmd.Cmd_TokenizeString( 'stop' );
		demo.CL_Stop_f();
		recordingStarted = false;

		if ( capturedBlob === null ) throw new Error( 'demo download was not captured' );
		const bytes = new Uint8Array( await capturedBlob.arrayBuffer() );
		assertEqual( String.fromCharCode( bytes[ 0 ], bytes[ 1 ], bytes[ 2 ] ), '-1\n',
			'forced-track header' );
		let offset = 3;
		let view = new DataView( bytes.buffer, bytes.byteOffset + offset );
		assertEqual( view.getInt32( 0, true ), 3, 'recorded message length' );
		assertNear( view.getFloat32( 4, true ), 12.5, 'recorded pitch' );
		assertNear( view.getFloat32( 8, true ), - 90.25, 'recorded yaw' );
		assertNear( view.getFloat32( 12, true ), 3.75, 'recorded roll' );
		offset += 16;
		assertEqual( bytes[ offset ++ ], 0x10, 'recorded payload byte 0' );
		assertEqual( bytes[ offset ++ ], 0x20, 'recorded payload byte 1' );
		assertEqual( bytes[ offset ++ ], 0x30, 'recorded payload byte 2' );

		view = new DataView( bytes.buffer, bytes.byteOffset + offset );
		assertEqual( view.getInt32( 0, true ), 2, 'reliable message length' );
		assertNear( view.getFloat32( 4, true ), - 1.5, 'reliable message pitch' );
		assertNear( view.getFloat32( 8, true ), 2.25, 'reliable message yaw' );
		assertNear( view.getFloat32( 12, true ), 180, 'reliable message roll' );
		offset += 16;
		assertEqual( bytes[ offset ++ ], 0x40, 'reliable payload byte 0' );
		assertEqual( bytes[ offset ++ ], 0x50, 'reliable payload byte 1' );

		view = new DataView( bytes.buffer, bytes.byteOffset + offset );
		assertEqual( view.getInt32( 0, true ), 1, 'disconnect message length' );
		offset += 16;
		assertEqual( bytes[ offset ++ ], svc_disconnect, 'disconnect payload' );
		assertEqual( offset, bytes.length, 'demo file end' );

	} finally {

		if ( recordingStarted === true ) {

			cmd.Cmd_TokenizeString( 'stop' );
			demo.CL_Stop_f();

		}
		driver.QGetMessage = oldGetMessage;
		net.net_message.data = oldNetData;
		net.net_message.maxsize = oldNetMaxsize;
		net.net_message.cursize = oldNetCursize;
		common.COM_SetNetMessage( oldCommonNetMessage );
		cls.state = oldState;
		cls.netcon = oldNetcon;
		cls.demoplayback = oldPlayback;
		cls.demorecording = oldRecording;
		cls.demofile = oldDemofile;
		cls.forcetrack = oldForcetrack;
		cl.viewangles.set( oldAngles );
		if ( oldURLDescriptor === undefined ) delete globalThis.URL;
		else Object.defineProperty( globalThis, 'URL', oldURLDescriptor );
		if ( oldDocumentDescriptor === undefined ) delete globalThis.document;
		else Object.defineProperty( globalThis, 'document', oldDocumentDescriptor );

	}

} );
