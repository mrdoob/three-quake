import { QUAKE_PALETTE } from '../loaders/Palette.js';

/**
 * Menu - Quake main menu system
 *
 * Displays the classic Quake menu with:
 * - Background plaque
 * - Title graphic
 * - Menu items (Single Player, Multiplayer, Options, Help, Quit)
 * - Animated cursor
 */

// Menu states
export const MENU_STATE = {
    NONE: 0,
    MAIN: 1,
    SINGLE_PLAYER: 2,
    MULTIPLAYER: 3,
    SETUP: 4,
    OPTIONS: 5,
    VIDEO_OPTIONS: 6
};

export class Menu {
    constructor(container, pak) {
        this.pak = pak;
        this.container = container;

        // Create canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.imageRendering = 'pixelated';
        this.canvas.style.zIndex = '150';
        this.canvas.style.display = 'block';
        container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        // Menu state
        this.state = MENU_STATE.MAIN;
        this.cursor = 0;
        this.time = 0;

        // Main menu has 5 items
        this.mainMenuItems = 5;
        // Single player menu has 3 items
        this.singlePlayerItems = 3;
        // Multiplayer menu has 3 items
        this.multiplayerItems = 3;
        // Setup menu has 5 items
        this.setupItems = 5;
        // Options menu items (matching original Quake)
        this.optionsItems = 10;

        // Player settings (for multiplayer setup)
        this.playerName = 'player';
        this.playerShirtColor = 0;  // 0-13
        this.playerPantsColor = 0;  // 0-13
        this.setupEditingField = -1;  // -1 = not editing, 0 = hostname, 1 = name

        // Cached player preview canvas (regenerated when colors change)
        this.playerPreviewCache = null;
        this.cachedShirtColor = -1;
        this.cachedPantsColor = -1;

        // Input manager reference (set externally)
        this.input = null;

        // Settings (with defaults, matching original Quake options)
        this.settings = {
            screenSize: 1.0,        // Viewport size (0.3-1.0)
            brightness: 0.5,        // Gamma (0-1)
            sensitivity: 0.15,      // Mouse speed
            musicVolume: 0.7,       // CD Music
            volume: 0.7,            // Sound effects
            alwaysRun: false,       // Always run toggle
            invertMouse: false,     // Invert mouse Y
            lookspring: false,      // Auto-center view
            lookstrafe: false,      // Mouse strafe instead of turn
            fov: 90,                // Field of view
            textureSmooth: false    // Texture filtering: false=pixelated, true=smooth
        };

        // Graphics
        this.pics = new Map();
        this.charsetCanvas = null;  // Quake bitmap font
        this.loaded = false;

        // Callbacks
        this.onNewGame = null;
        this.onQuit = null;
        this.onResume = null;  // Called when user wants to resume game
        this.onDismiss = null;  // Called when user dismisses menu (e.g., to return to demo)

        // Track if there's a game in progress (for showing Continue option)
        this.gameInProgress = false;

        // When true, use transparent fade overlay (demo/game visible behind)
        // When false, use solid background (no game running)
        this.transparentBackground = false;

        // Audio (set externally after creation)
        this.audio = null;

        // Console reference (set externally)
        this.gameConsole = null;

        // Input handling
        this.boundKeyDown = this.handleKeyDown.bind(this);
        document.addEventListener('keydown', this.boundKeyDown);

        // Touch/click handling for menu items
        this.boundPointerDown = this.handlePointerDown.bind(this);
        this.boundPointerMove = this.handlePointerMove.bind(this);
        this.canvas.addEventListener('pointerdown', this.boundPointerDown);
        this.canvas.addEventListener('pointermove', this.boundPointerMove);

        // Start loading graphics (call init() to await completion)
        this.loadPromise = this.loadGraphics();
    }

    async init() {
        // Wait for graphics to load
        await this.loadPromise;
    }

    async loadGraphics() {
        try {
            // Menu graphics are stored as .lmp files in PAK under gfx/
            // LMP format: width (int32) + height (int32) + palette indices
            this.loadLmp('qplaque');     // Background plaque
            this.loadLmp('ttl_main');    // Main menu title
            this.loadLmp('ttl_sgl');     // Single player title
            this.loadLmp('mainmenu');    // Main menu items
            this.loadLmp('sp_menu');     // Single player menu items
            this.loadLmp('p_option');    // Options menu title
            this.loadLmp('p_multi');     // Multiplayer title
            this.loadLmp('mp_menu');     // Multiplayer menu items
            this.loadLmp('bigbox');      // Big box for player preview
            this.loadLmp('menuplyr');    // Player model image

            // Load animated cursor (6 frames)
            for (let i = 1; i <= 6; i++) {
                this.loadLmp(`menudot${i}`);
            }

            // Load Quake bitmap font (conchars)
            await this.loadCharset();

            // Load continue button image from assets
            await this.loadExternalImage('continue', 'assets/continue.png');

            this.loaded = true;
            console.log('Menu graphics loaded, pics count:', this.pics.size);
            console.log('Loaded pics:', Array.from(this.pics.keys()));
        } catch (error) {
            console.error('Menu: Error loading graphics:', error);
        }
    }

    async loadCharset() {
        // Original Quake loads conchars from gfx.wad, not gfx/conchars.lmp
        // Try WAD first (like original), then fall back to .lmp file
        let data = null;

        // Try loading from gfx.wad
        const wadData = this.pak.get('gfx.wad');
        if (wadData) {
            const { WADLoader } = await import('../loaders/WADLoader.js');
            const wad = new WADLoader();
            wad.load(wadData);

            // Debug: list all entries in WAD
            console.log('WAD entries:', wad.list());

            const conchars = wad.get('conchars');
            if (conchars && conchars.data) {
                data = conchars.data;
                console.log('Loaded conchars from gfx.wad, size:', data.length);
            } else {
                console.log('conchars not found in gfx.wad');
            }
        }

        // Fallback to .lmp file
        if (!data) {
            data = this.pak.get('gfx/conchars.lmp');
        }

        if (!data) {
            // Generate pixel font if conchars not found anywhere
            this.generateBitmapFont();
            return;
        }

        const width = 128;
        const height = 128;
        const expectedSize = width * height; // 16384 bytes

        // Raw pixel data (no width/height header for conchars)
        const pixelData = new Uint8Array(data);

        // Verify data size
        if (pixelData.length !== expectedSize) {
            console.warn(`conchars unexpected size: ${pixelData.length} (expected ${expectedSize})`);
        }

        // Convert to RGBA (index 0 = transparent for charset)
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < pixelData.length && i < width * height; i++) {
            const palIdx = pixelData[i];
            const dstIdx = i * 4;

            if (palIdx === 0) {
                // Transparent (charset uses 0 for transparency)
                rgba[dstIdx] = 0;
                rgba[dstIdx + 1] = 0;
                rgba[dstIdx + 2] = 0;
                rgba[dstIdx + 3] = 0;
            } else {
                rgba[dstIdx] = QUAKE_PALETTE[palIdx * 3];
                rgba[dstIdx + 1] = QUAKE_PALETTE[palIdx * 3 + 1];
                rgba[dstIdx + 2] = QUAKE_PALETTE[palIdx * 3 + 2];
                rgba[dstIdx + 3] = 255;
            }
        }

        // Create canvas for charset
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer), width, height);
        ctx.putImageData(imageData, 0, 0);

        this.charsetCanvas = canvas;
    }

    generateBitmapFont() {
        // Generate an 8x8 pixel font when conchars.lmp is not available
        // Creates a 128x128 canvas with 16x16 grid of 8x8 characters
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Clear with transparency
        ctx.clearRect(0, 0, 128, 128);

        // 8x8 pixel font definitions (simplified pixel art style)
        // Each character is 8 bytes, each byte is a row (bits = pixels)
        const font = {
            32: [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00], // space
            33: [0x18,0x18,0x18,0x18,0x18,0x00,0x18,0x00], // !
            34: [0x6C,0x6C,0x24,0x00,0x00,0x00,0x00,0x00], // "
            39: [0x18,0x18,0x08,0x00,0x00,0x00,0x00,0x00], // '
            40: [0x0C,0x18,0x30,0x30,0x30,0x18,0x0C,0x00], // (
            41: [0x30,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x00], // )
            43: [0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00], // +
            44: [0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x30], // ,
            45: [0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00], // -
            46: [0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00], // .
            47: [0x06,0x0C,0x18,0x30,0x60,0xC0,0x80,0x00], // /
            48: [0x3C,0x66,0x6E,0x76,0x66,0x66,0x3C,0x00], // 0
            49: [0x18,0x38,0x18,0x18,0x18,0x18,0x7E,0x00], // 1
            50: [0x3C,0x66,0x06,0x0C,0x18,0x30,0x7E,0x00], // 2
            51: [0x3C,0x66,0x06,0x1C,0x06,0x66,0x3C,0x00], // 3
            52: [0x0C,0x1C,0x3C,0x6C,0x7E,0x0C,0x0C,0x00], // 4
            53: [0x7E,0x60,0x7C,0x06,0x06,0x66,0x3C,0x00], // 5
            54: [0x1C,0x30,0x60,0x7C,0x66,0x66,0x3C,0x00], // 6
            55: [0x7E,0x06,0x0C,0x18,0x30,0x30,0x30,0x00], // 7
            56: [0x3C,0x66,0x66,0x3C,0x66,0x66,0x3C,0x00], // 8
            57: [0x3C,0x66,0x66,0x3E,0x06,0x0C,0x38,0x00], // 9
            58: [0x00,0x18,0x18,0x00,0x18,0x18,0x00,0x00], // :
            60: [0x0C,0x18,0x30,0x60,0x30,0x18,0x0C,0x00], // <
            62: [0x30,0x18,0x0C,0x06,0x0C,0x18,0x30,0x00], // >
            63: [0x3C,0x66,0x06,0x0C,0x18,0x00,0x18,0x00], // ?
            65: [0x3C,0x66,0x66,0x7E,0x66,0x66,0x66,0x00], // A
            66: [0x7C,0x66,0x66,0x7C,0x66,0x66,0x7C,0x00], // B
            67: [0x3C,0x66,0x60,0x60,0x60,0x66,0x3C,0x00], // C
            68: [0x78,0x6C,0x66,0x66,0x66,0x6C,0x78,0x00], // D
            69: [0x7E,0x60,0x60,0x7C,0x60,0x60,0x7E,0x00], // E
            70: [0x7E,0x60,0x60,0x7C,0x60,0x60,0x60,0x00], // F
            71: [0x3C,0x66,0x60,0x6E,0x66,0x66,0x3E,0x00], // G
            72: [0x66,0x66,0x66,0x7E,0x66,0x66,0x66,0x00], // H
            73: [0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x00], // I
            74: [0x06,0x06,0x06,0x06,0x66,0x66,0x3C,0x00], // J
            75: [0x66,0x6C,0x78,0x70,0x78,0x6C,0x66,0x00], // K
            76: [0x60,0x60,0x60,0x60,0x60,0x60,0x7E,0x00], // L
            77: [0xC6,0xEE,0xFE,0xD6,0xC6,0x00,0x00,0x00], // M
            78: [0x66,0x76,0x7E,0x7E,0x6E,0x66,0x66,0x00], // N
            79: [0x3C,0x66,0x66,0x66,0x66,0x66,0x3C,0x00], // O
            80: [0x7C,0x66,0x66,0x7C,0x60,0x60,0x60,0x00], // P
            81: [0x3C,0x66,0x66,0x66,0x6E,0x3C,0x06,0x00], // Q
            82: [0x7C,0x66,0x66,0x7C,0x6C,0x66,0x66,0x00], // R
            83: [0x3C,0x66,0x60,0x3C,0x06,0x66,0x3C,0x00], // S
            84: [0x7E,0x18,0x18,0x18,0x18,0x18,0x18,0x00], // T
            85: [0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x00], // U
            86: [0x66,0x66,0x66,0x3C,0x3C,0x18,0x00,0x00], // V
            87: [0xC6,0xC6,0xC6,0xD6,0xFE,0xEE,0xC6,0x00], // W
            88: [0x66,0x66,0x3C,0x18,0x3C,0x66,0x66,0x00], // X
            89: [0x66,0x66,0x66,0x3C,0x18,0x18,0x18,0x00], // Y
            90: [0x7E,0x06,0x0C,0x18,0x30,0x60,0x7E,0x00], // Z
            91: [0x3C,0x30,0x30,0x30,0x30,0x30,0x3C,0x00], // [
            93: [0x3C,0x0C,0x0C,0x0C,0x0C,0x0C,0x3C,0x00], // ]
            95: [0x00,0x00,0x00,0x00,0x00,0x00,0x7E,0x00], // _
            97: [0x00,0x00,0x3C,0x06,0x3E,0x66,0x3E,0x00], // a
            98: [0x60,0x60,0x7C,0x66,0x66,0x66,0x7C,0x00], // b
            99: [0x00,0x00,0x3C,0x66,0x60,0x66,0x3C,0x00], // c
            100:[0x06,0x06,0x3E,0x66,0x66,0x66,0x3E,0x00], // d
            101:[0x00,0x00,0x3C,0x66,0x7E,0x60,0x3C,0x00], // e
            102:[0x1C,0x30,0x7C,0x30,0x30,0x30,0x30,0x00], // f
            103:[0x00,0x00,0x3E,0x66,0x66,0x3E,0x06,0x3C], // g
            104:[0x60,0x60,0x7C,0x66,0x66,0x66,0x66,0x00], // h
            105:[0x18,0x00,0x18,0x18,0x18,0x18,0x18,0x00], // i
            106:[0x0C,0x00,0x0C,0x0C,0x0C,0x0C,0x6C,0x38], // j
            107:[0x60,0x60,0x66,0x6C,0x78,0x6C,0x66,0x00], // k
            108:[0x38,0x18,0x18,0x18,0x18,0x18,0x3C,0x00], // l
            109:[0x00,0x00,0xEC,0xFE,0xD6,0xC6,0xC6,0x00], // m
            110:[0x00,0x00,0x7C,0x66,0x66,0x66,0x66,0x00], // n
            111:[0x00,0x00,0x3C,0x66,0x66,0x66,0x3C,0x00], // o
            112:[0x00,0x00,0x7C,0x66,0x66,0x7C,0x60,0x60], // p
            113:[0x00,0x00,0x3E,0x66,0x66,0x3E,0x06,0x06], // q
            114:[0x00,0x00,0x7C,0x66,0x60,0x60,0x60,0x00], // r
            115:[0x00,0x00,0x3E,0x60,0x3C,0x06,0x7C,0x00], // s
            116:[0x30,0x30,0x7C,0x30,0x30,0x30,0x1C,0x00], // t
            117:[0x00,0x00,0x66,0x66,0x66,0x66,0x3E,0x00], // u
            118:[0x00,0x00,0x66,0x66,0x66,0x3C,0x18,0x00], // v
            119:[0x00,0x00,0xC6,0xC6,0xD6,0xFE,0x6C,0x00], // w
            120:[0x00,0x00,0x66,0x3C,0x18,0x3C,0x66,0x00], // x
            121:[0x00,0x00,0x66,0x66,0x66,0x3E,0x06,0x3C], // y
            122:[0x00,0x00,0x7E,0x0C,0x18,0x30,0x7E,0x00], // z
        };

        // Colors
        const whiteColor = [192, 192, 192, 255];  // Light gray
        const goldColor = [192, 128, 0, 255];     // Gold/bronze

        // Create image data
        const imageData = ctx.createImageData(128, 128);
        const data = imageData.data;

        // Draw characters for both normal (0-127) and gold (128-255) ranges
        for (let charCode = 0; charCode < 256; charCode++) {
            const col = charCode % 16;
            const row = Math.floor(charCode / 16);
            const baseX = col * 8;
            const baseY = row * 8;

            // Get the font data (gold chars 128-255 use same glyph as 0-127)
            const lookupCode = charCode < 128 ? charCode : charCode - 128;
            const charData = font[lookupCode] || font[32]; // Default to space

            if (!charData) continue;

            // Choose color based on character range
            const color = charCode >= 128 ? goldColor : whiteColor;

            // Draw 8x8 character
            for (let py = 0; py < 8; py++) {
                const rowBits = charData[py] || 0;
                for (let px = 0; px < 8; px++) {
                    if (rowBits & (0x80 >> px)) {
                        const x = baseX + px;
                        const y = baseY + py;
                        const idx = (y * 128 + x) * 4;
                        data[idx] = color[0];
                        data[idx + 1] = color[1];
                        data[idx + 2] = color[2];
                        data[idx + 3] = color[3];
                    }
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        this.charsetCanvas = canvas;
    }

    loadLmp(name) {
        // Load .lmp file from PAK (gfx/name.lmp)
        const path = `gfx/${name}.lmp`;
        const data = this.pak.get(path);
        if (!data) {
            console.warn(`Menu LMP not found: ${path}`);
            return;
        }

        // LMP format: width (uint32) + height (uint32) + pixel data
        const view = new DataView(data);
        const width = view.getUint32(0, true);
        const height = view.getUint32(4, true);

        // Read pixel data (palette indices)
        const pixelData = new Uint8Array(data, 8, width * height);

        // Convert to RGBA with transparency (index 255 = transparent)
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < pixelData.length; i++) {
            const palIdx = pixelData[i];
            const dstIdx = i * 4;

            if (palIdx === 255) {
                // Transparent
                rgba[dstIdx] = 0;
                rgba[dstIdx + 1] = 0;
                rgba[dstIdx + 2] = 0;
                rgba[dstIdx + 3] = 0;
            } else {
                rgba[dstIdx] = QUAKE_PALETTE[palIdx * 3];
                rgba[dstIdx + 1] = QUAKE_PALETTE[palIdx * 3 + 1];
                rgba[dstIdx + 2] = QUAKE_PALETTE[palIdx * 3 + 2];
                rgba[dstIdx + 3] = 255;
            }
        }

        // Create ImageData
        const imageData = new ImageData(
            new Uint8ClampedArray(rgba.buffer),
            width,
            height
        );

        // Create offscreen canvas for this pic
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        const picData = {
            canvas,
            width,
            height
        };

        // For menuplyr, store the raw pixel data for color translation
        if (name === 'menuplyr') {
            picData.pixelData = new Uint8Array(pixelData);
        }

        this.pics.set(name, picData);

        console.log(`Loaded menu pic: ${name} (${width}x${height})`);
    }

    async loadExternalImage(name, path) {
        // Load an external image file (PNG, etc.) from the assets folder
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Create canvas from image
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                this.pics.set(name, {
                    canvas,
                    width: img.width,
                    height: img.height
                });

                console.log(`Loaded external image: ${name} (${img.width}x${img.height})`);
                resolve();
            };
            img.onerror = () => {
                console.warn(`Failed to load external image: ${path}`);
                resolve(); // Don't reject, just continue without the image
            };
            img.src = path;
        });
    }

    resize() {
        const containerWidth = this.container.clientWidth;
        const containerHeight = this.container.clientHeight;

        // Calculate scale to fit 320x200 screen, capped at 2x for reasonable size
        const scaleX = containerWidth / 320;
        const scaleY = containerHeight / 200;
        this.scale = Math.min(scaleX, scaleY, 2);

        // Set canvas to container size
        this.canvas.width = containerWidth;
        this.canvas.height = containerHeight;

        // Calculate offset to center the 320x200 area
        this.offsetX = (containerWidth - 320 * this.scale) / 2;
        this.offsetY = (containerHeight - 200 * this.scale) / 2;

        // Disable smoothing for pixel-perfect scaling
        this.ctx.imageSmoothingEnabled = false;
    }

    update(deltaTime) {
        this.time += deltaTime;
    }

    draw() {
        this.resize();

        const ctx = this.ctx;

        // Draw background based on mode
        if (this.transparentBackground) {
            // Clear canvas to fully transparent
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            // Draw semi-transparent black fade overlay (like Draw_FadeScreen in gl_draw.c)
            // Original Quake uses glColor4f(0, 0, 0, 0.8) = 80% opacity
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        } else {
            // Solid dark brown background (no game behind)
            ctx.fillStyle = '#1a0a00';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        if (!this.loaded) {
            // Show loading message while graphics load
            ctx.fillStyle = '#c06020';
            ctx.font = '24px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Loading...', this.canvas.width / 2, this.canvas.height / 2);
            return;
        }

        // Draw based on state
        switch (this.state) {
            case MENU_STATE.MAIN:
                this.drawMain();
                break;
            case MENU_STATE.SINGLE_PLAYER:
                this.drawSinglePlayer();
                break;
            case MENU_STATE.MULTIPLAYER:
                this.drawMultiplayer();
                break;
            case MENU_STATE.SETUP:
                this.drawSetup();
                break;
            case MENU_STATE.OPTIONS:
                this.drawOptions();
                break;
            case MENU_STATE.VIDEO_OPTIONS:
                this.drawVideoOptions();
                break;
        }

        // Fallback text if no pics loaded
        if (this.pics.size === 0) {
            ctx.fillStyle = '#c06020';
            ctx.font = '24px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('QUAKE', this.canvas.width / 2, 100);
            ctx.font = '16px monospace';
            ctx.fillText('Menu graphics not loaded', this.canvas.width / 2, 150);
            ctx.fillText('Check console for errors', this.canvas.width / 2, 180);
        }
    }

    drawMain() {
        // Draw background plaque (at 16, 4)
        this.drawPic(16, 4, 'qplaque');

        // Draw main menu title (at 64, 4) - adjusted for centering
        const title = this.pics.get('ttl_main');
        if (title) {
            const titleX = (320 - title.width) / 2;
            this.drawPic(titleX, 4, 'ttl_main');
        }

        // If game is in progress, show Continue option above main menu
        let menuOffset = 0;
        if (this.gameInProgress) {
            // Draw Continue image at first menu position (2x text size)
            this.drawPicSized(72, 32, 'continue', 128, 16);
            menuOffset = 20;  // Shift main menu down
        }

        // Draw main menu items (shifted down if Continue is shown)
        this.drawPic(72, 32 + menuOffset, 'mainmenu');

        // Draw animated cursor
        const dotFrame = Math.floor(this.time * 10) % 6 + 1;
        // Cursor position accounts for Continue option offset
        let cursorY;
        if (this.gameInProgress) {
            cursorY = 32 + this.cursor * 20;
        } else {
            cursorY = 32 + this.cursor * 20;
        }
        this.drawPic(54, cursorY, `menudot${dotFrame}`);
    }

    drawSinglePlayer() {
        // Draw background plaque
        this.drawPic(16, 4, 'qplaque');

        // Draw single player title
        const title = this.pics.get('ttl_sgl');
        if (title) {
            const titleX = (320 - title.width) / 2;
            this.drawPic(titleX, 4, 'ttl_sgl');
        }

        // Draw single player menu items (at 72, 32)
        this.drawPic(72, 32, 'sp_menu');

        // Draw animated cursor
        const dotFrame = Math.floor(this.time * 10) % 6 + 1;
        this.drawPic(54, 32 + this.cursor * 20, `menudot${dotFrame}`);
    }

    drawMultiplayer() {
        // Draw background plaque
        this.drawPic(16, 4, 'qplaque');

        // Draw multiplayer title
        const title = this.pics.get('p_multi');
        if (title) {
            const titleX = (320 - title.width) / 2;
            this.drawPic(titleX, 4, 'p_multi');
        }

        // Draw multiplayer menu items (at 72, 32)
        this.drawPic(72, 32, 'mp_menu');

        // Draw animated cursor
        const dotFrame = Math.floor(this.time * 10) % 6 + 1;
        this.drawPic(54, 32 + this.cursor * 20, `menudot${dotFrame}`);

        // Draw "No Communications Available" message (like original)
        // M_PrintWhite ((320/2) - ((27*8)/2), 148, "No Communications Available");
        this.drawCenteredText(148, 'No Communications Available', 1, true);
    }

    drawSetup() {
        // Draw background plaque
        this.drawPic(16, 4, 'qplaque');

        // Draw multiplayer title (same as multiplayer menu)
        const title = this.pics.get('p_multi');
        if (title) {
            const titleX = (320 - title.width) / 2;
            this.drawPic(titleX, 4, 'p_multi');
        }

        // Setup menu items (matching original Quake layout exactly)
        // M_Print (64, 40, "Hostname");
        this.drawText(64, 40, 'Hostname');
        // M_DrawTextBox (160, 32, 16, 1);
        this.drawTextBox(160, 32, 16, 1);
        // M_Print (168, 40, setup_hostname);
        this.drawText(168, 40, 'QUAKE');

        // M_Print (64, 56, "Your name");
        this.drawText(64, 56, 'Your name');
        // M_DrawTextBox (160, 48, 16, 1);
        this.drawTextBox(160, 48, 16, 1);
        // M_Print (168, 56, setup_myname);
        this.drawText(168, 56, this.playerName);

        // M_Print (64, 80, "Shirt color");
        this.drawText(64, 80, 'Shirt color');
        // M_DrawTextBox (64, 76-8, 14, 1); M_SlideBar (64, 76, setup_top);
        this.drawColorSlider(176, 80, this.playerShirtColor);

        // M_Print (64, 104, "Pants color");
        this.drawText(64, 104, 'Pants color');
        // M_DrawTextBox (64, 100-8, 14, 1); M_SlideBar (64, 100, setup_bottom);
        this.drawColorSlider(176, 104, this.playerPantsColor);

        // M_DrawTextBox (64, 140-8, 14, 1);
        this.drawTextBox(64, 132, 14, 1);
        // M_Print (72, 140, "Accept Changes");
        this.drawText(72, 140, 'Accept Changes');

        // p = Draw_CachePic ("gfx/bigbox.lmp");
        // M_DrawTransPic (160, 64, p);
        this.drawPic(160, 64, 'bigbox');

        // p = Draw_CachePic ("gfx/menuplyr.lmp");
        // M_DrawTransPicTranslate (172, 72, p);
        this.drawPlayerPreview(172, 72);

        // M_DrawCharacter (56, setup_cursor_table [setup_cursor], 12+((int)(realtime*4)&1));
        // setup_cursor_table[] = {40, 56, 80, 104, 140};
        const cursorY = [40, 56, 80, 104, 140][this.cursor];
        const cursorChar = 12 + (Math.floor(this.time * 4) & 1);
        this.drawChar(56, cursorY, cursorChar);

        // Text cursor for editable fields (blinking underscore)
        if (this.cursor === 0) {
            // Hostname field - cursor after text
            const textCursor = 10 + (Math.floor(this.time * 4) & 1);
            this.drawChar(168 + 5 * 8, 40, textCursor);  // After "QUAKE"
        } else if (this.cursor === 1) {
            // Name field - cursor after text
            const textCursor = 10 + (Math.floor(this.time * 4) & 1);
            this.drawChar(168 + this.playerName.length * 8, 56, textCursor);
        }
    }

    drawPlayerPreview(x, y) {
        const pic = this.pics.get('menuplyr');
        if (!pic || !pic.pixelData) return;

        const s = this.scale;
        const dx = Math.round(this.offsetX + x * s);
        const dy = Math.round(this.offsetY + y * s);
        const dw = Math.round(pic.width * s);
        const dh = Math.round(pic.height * s);

        // Only rebuild the translated image if colors changed
        if (!this.playerPreviewCache ||
            this.cachedShirtColor !== this.playerShirtColor ||
            this.cachedPantsColor !== this.playerPantsColor) {

            // Build translation table (like M_BuildTranslationTable)
            // TOP_RANGE = 16 (shirt), BOTTOM_RANGE = 96 (pants)
            const TOP_RANGE = 16;
            const BOTTOM_RANGE = 96;
            const top = this.playerShirtColor * 16;
            const bottom = this.playerPantsColor * 16;

            // Create translation table (identity mapping first)
            const translationTable = new Uint8Array(256);
            for (let i = 0; i < 256; i++) {
                translationTable[i] = i;
            }

            // Translate shirt colors (TOP_RANGE 16-31 -> top color row)
            // Original: if (top < 128) copy normally, else reverse
            if (top < 128) {
                for (let j = 0; j < 16; j++) {
                    translationTable[TOP_RANGE + j] = top + j;
                }
            } else {
                for (let j = 0; j < 16; j++) {
                    translationTable[TOP_RANGE + j] = top + 15 - j;
                }
            }

            // Translate pants colors (BOTTOM_RANGE 96-111 -> bottom color row)
            if (bottom < 128) {
                for (let j = 0; j < 16; j++) {
                    translationTable[BOTTOM_RANGE + j] = bottom + j;
                }
            } else {
                for (let j = 0; j < 16; j++) {
                    translationTable[BOTTOM_RANGE + j] = bottom + 15 - j;
                }
            }

            // Create translated image
            const rgba = new Uint8Array(pic.width * pic.height * 4);
            for (let i = 0; i < pic.pixelData.length; i++) {
                const srcIdx = pic.pixelData[i];
                const palIdx = translationTable[srcIdx];
                const dstIdx = i * 4;

                if (srcIdx === 255) {
                    // Transparent
                    rgba[dstIdx] = 0;
                    rgba[dstIdx + 1] = 0;
                    rgba[dstIdx + 2] = 0;
                    rgba[dstIdx + 3] = 0;
                } else {
                    rgba[dstIdx] = QUAKE_PALETTE[palIdx * 3];
                    rgba[dstIdx + 1] = QUAKE_PALETTE[palIdx * 3 + 1];
                    rgba[dstIdx + 2] = QUAKE_PALETTE[palIdx * 3 + 2];
                    rgba[dstIdx + 3] = 255;
                }
            }

            // Create cached canvas
            this.playerPreviewCache = document.createElement('canvas');
            this.playerPreviewCache.width = pic.width;
            this.playerPreviewCache.height = pic.height;
            const cacheCtx = this.playerPreviewCache.getContext('2d');
            const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer), pic.width, pic.height);
            cacheCtx.putImageData(imageData, 0, 0);

            this.cachedShirtColor = this.playerShirtColor;
            this.cachedPantsColor = this.playerPantsColor;
        }

        // Draw cached translated image scaled to main canvas
        this.ctx.drawImage(this.playerPreviewCache, dx, dy, dw, dh);
    }

    drawTextBox(x, y, width, height) {
        // Draw a text input box using characters from the charset
        // Simplified: just draw a dark rectangle
        const s = this.scale;
        const dx = Math.round(this.offsetX + x * s);
        const dy = Math.round(this.offsetY + y * s);
        const dw = Math.round((width * 8 + 16) * s);
        const dh = Math.round((height * 8 + 16) * s);

        this.ctx.fillStyle = '#2a1500';
        this.ctx.fillRect(dx, dy, dw, dh);
        this.ctx.strokeStyle = '#604020';
        this.ctx.lineWidth = s;
        this.ctx.strokeRect(dx, dy, dw, dh);
    }

    drawColorBar(x, y, colorIndex) {
        // Draw a color bar showing the Quake palette color
        // Quake uses palette indices 0-13 for player colors
        // Each color row in the palette is 16 entries
        const s = this.scale;
        const dx = Math.round(this.offsetX + x * s);
        const dy = Math.round(this.offsetY + y * s);
        const barWidth = Math.round(64 * s);
        const barHeight = Math.round(8 * s);

        // Get the main color from the palette (middle of the color row)
        const palIndex = colorIndex * 16 + 8;
        const r = QUAKE_PALETTE[palIndex * 3];
        const g = QUAKE_PALETTE[palIndex * 3 + 1];
        const b = QUAKE_PALETTE[palIndex * 3 + 2];

        // Draw the color bar
        this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        this.ctx.fillRect(dx, dy, barWidth, barHeight);

        // Draw border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(dx, dy, barWidth, barHeight);
    }

    drawColorSlider(x, y, colorIndex) {
        // Draw a color selection slider showing all 14 color options
        // Original uses M_SlideBar which shows a gradient-like bar with position marker
        const s = this.scale;
        const barWidth = 112;  // Width to show all 14 colors
        const barHeight = 8;
        const dx = Math.round(this.offsetX + x * s);
        const dy = Math.round(this.offsetY + y * s);

        // Draw color gradient bar (14 segments, 8 pixels each)
        const segmentWidth = 8;
        for (let i = 0; i < 14; i++) {
            const palIndex = i * 16 + 8;  // Middle of each color row
            const r = QUAKE_PALETTE[palIndex * 3];
            const g = QUAKE_PALETTE[palIndex * 3 + 1];
            const b = QUAKE_PALETTE[palIndex * 3 + 2];

            this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            this.ctx.fillRect(
                dx + Math.round(i * segmentWidth * s),
                dy,
                Math.round(segmentWidth * s),
                Math.round(barHeight * s)
            );
        }

        // Draw selection marker (white box around current color)
        const markerX = dx + Math.round(colorIndex * segmentWidth * s);
        const markerW = Math.round(segmentWidth * s);
        const markerH = Math.round(barHeight * s);

        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = Math.max(1, s);
        this.ctx.strokeRect(markerX, dy, markerW, markerH);

        // Draw outer border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(dx, dy, Math.round(barWidth * s), Math.round(barHeight * s));
    }

    drawPic(x, y, name) {
        const pic = this.pics.get(name);
        if (!pic) return;

        const s = this.scale;
        // Round to prevent sub-pixel rendering artifacts
        const dx = Math.round(this.offsetX + x * s);
        const dy = Math.round(this.offsetY + y * s);
        const dw = Math.round(pic.width * s);
        const dh = Math.round(pic.height * s);

        this.ctx.drawImage(pic.canvas, dx, dy, dw, dh);
    }

    drawPicSized(x, y, name, width, height) {
        // Draw a pic at a specific size (in Quake 320x200 coordinates)
        const pic = this.pics.get(name);
        if (!pic) return;

        const s = this.scale;
        const dx = Math.round(this.offsetX + x * s);
        const dy = Math.round(this.offsetY + y * s);
        const dw = Math.round(width * s);
        const dh = Math.round(height * s);

        this.ctx.drawImage(pic.canvas, dx, dy, dw, dh);
    }

    handleKeyDown(e) {
        if (this.state === MENU_STATE.NONE) return;

        // Don't handle keys if console is visible (console has priority)
        if (this.gameConsole && this.gameConsole.isVisible()) return;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.cursorUp();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.cursorDown();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.adjustValue(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.adjustValue(1);
                break;
            case 'Enter':
                e.preventDefault();
                this.select();
                break;
            case 'Escape':
                e.preventDefault();
                this.back();
                break;
        }
    }

    /**
     * Handle pointer (touch/mouse) down on menu canvas
     * Selects menu items when tapped/clicked
     */
    handlePointerDown(e) {
        if (this.state === MENU_STATE.NONE) return;
        if (this.gameConsole && this.gameConsole.isVisible()) return;

        // Convert pointer position to menu item index
        const menuItem = this.getMenuItemAtPosition(e.clientX, e.clientY);

        if (menuItem !== -1) {
            // Move cursor to this item and select it
            this.cursor = menuItem;
            this.select();
        }
    }

    /**
     * Handle pointer move to highlight menu items on hover
     */
    handlePointerMove(e) {
        if (this.state === MENU_STATE.NONE) return;
        if (this.gameConsole && this.gameConsole.isVisible()) return;

        const menuItem = this.getMenuItemAtPosition(e.clientX, e.clientY);

        if (menuItem !== -1 && menuItem !== this.cursor) {
            this.cursor = menuItem;
            // Don't play sound on hover to avoid spam
        }
    }

    /**
     * Get menu item index at screen position
     * Returns -1 if no menu item at that position
     */
    getMenuItemAtPosition(clientX, clientY) {
        // Convert screen coordinates to Quake 320x200 coordinates
        const rect = this.canvas.getBoundingClientRect();
        const x = (clientX - rect.left - this.offsetX) / this.scale;
        const y = (clientY - rect.top - this.offsetY) / this.scale;

        // Check if within menu bounds based on current state
        const itemHeight = 20;  // Menu items are 20 pixels apart
        let startY = 32;
        let startX = 54;  // Left edge of menu items
        let endX = 200;   // Right edge of menu items
        let maxItems = this.getMaxItems();

        // Adjust for specific menu states
        if (this.state === MENU_STATE.OPTIONS || this.state === MENU_STATE.VIDEO_OPTIONS) {
            startY = 32;
            startX = 16;
            endX = 300;
            const itemHeightOptions = 8;

            // Check if in valid X range
            if (x < startX || x > endX) return -1;

            // Calculate which item (8 pixel height for options)
            const itemIndex = Math.floor((y - startY) / itemHeightOptions);
            if (itemIndex >= 0 && itemIndex < maxItems) {
                return itemIndex;
            }
            return -1;
        }

        if (this.state === MENU_STATE.SETUP) {
            // Setup menu has specific Y positions: 40, 56, 80, 104, 140
            const cursorYPositions = [40, 56, 80, 104, 140];
            for (let i = 0; i < cursorYPositions.length; i++) {
                if (y >= cursorYPositions[i] - 4 && y <= cursorYPositions[i] + 12) {
                    return i;
                }
            }
            return -1;
        }

        // Standard menus (main, single player, multiplayer)
        // Check if in valid X range
        if (x < startX || x > endX) return -1;

        // Account for Continue option in main menu
        let menuStartY = startY;
        if (this.state === MENU_STATE.MAIN && this.gameInProgress) {
            // Continue is at position 0, others shifted down
            if (y >= startY && y < startY + itemHeight) {
                return 0;  // Continue
            }
            menuStartY = startY + itemHeight;  // Regular items start after Continue
        }

        // Calculate which item
        const itemIndex = Math.floor((y - startY) / itemHeight);
        if (itemIndex >= 0 && itemIndex < maxItems) {
            return itemIndex;
        }

        return -1;
    }

    cursorUp() {
        this.cursor--;
        if (this.cursor < 0) {
            this.cursor = this.getMaxItems() - 1;
        }
        this.playSound('misc/menu1.wav');
    }

    cursorDown() {
        this.cursor++;
        if (this.cursor >= this.getMaxItems()) {
            this.cursor = 0;
        }
        this.playSound('misc/menu1.wav');
    }

    getMaxItems() {
        switch (this.state) {
            case MENU_STATE.MAIN:
                // Add 1 for Continue option when game is in progress
                return this.gameInProgress ? this.mainMenuItems + 1 : this.mainMenuItems;
            case MENU_STATE.SINGLE_PLAYER:
                return this.singlePlayerItems;
            case MENU_STATE.MULTIPLAYER:
                return this.multiplayerItems;
            case MENU_STATE.SETUP:
                return this.setupItems;
            case MENU_STATE.OPTIONS:
                return this.optionsItems;
            case MENU_STATE.VIDEO_OPTIONS:
                return 3;  // FOV, Texture Filtering, Back
            default:
                return 1;
        }
    }

    select() {
        this.playSound('misc/menu2.wav');

        switch (this.state) {
            case MENU_STATE.MAIN:
                this.selectMainMenu();
                break;
            case MENU_STATE.SINGLE_PLAYER:
                this.selectSinglePlayerMenu();
                break;
            case MENU_STATE.MULTIPLAYER:
                this.selectMultiplayerMenu();
                break;
            case MENU_STATE.SETUP:
                this.selectSetupMenu();
                break;
            case MENU_STATE.OPTIONS:
                this.selectOptionsMenu();
                break;
            case MENU_STATE.VIDEO_OPTIONS:
                this.selectVideoOptionsMenu();
                break;
        }
    }

    selectMainMenu() {
        // When game is in progress, cursor 0 is Continue, shifting all others
        const offset = this.gameInProgress ? 1 : 0;
        const selection = this.cursor - offset;

        // Handle Continue option (only when game is in progress)
        if (this.gameInProgress && this.cursor === 0) {
            if (this.onResume) {
                this.onResume();
            }
            return;
        }

        switch (selection) {
            case 0: // Single Player
                this.state = MENU_STATE.SINGLE_PLAYER;
                this.cursor = 0;
                break;
            case 1: // Multiplayer
                this.state = MENU_STATE.MULTIPLAYER;
                this.cursor = 0;
                break;
            case 2: // Options
                this.state = MENU_STATE.OPTIONS;
                this.cursor = 0;
                // Load current settings from game
                this.loadCurrentSettings();
                break;
            case 3: // Help
                // Not implemented
                console.log('Help not implemented');
                break;
            case 4: // Quit
                alert('Thanks for playing!');
                window.location.href = 'https://x.com/mrdoob/status/2015076521531355583';
                break;
        }
    }

    selectSinglePlayerMenu() {
        switch (this.cursor) {
            case 0: // New Game
                if (this.onNewGame) {
                    this.onNewGame();
                }
                break;
            case 1: // Load Game
                // Not implemented
                console.log('Load Game not implemented');
                break;
            case 2: // Save Game
                // Not implemented
                console.log('Save Game not implemented');
                break;
        }
    }

    selectMultiplayerMenu() {
        switch (this.cursor) {
            case 0: // Join a Game
                // Would need WebRTC/WebSocket - show message
                console.log('Network play not available in browser');
                break;
            case 1: // New Game (host)
                // Would need WebRTC/WebSocket - show message
                console.log('Network play not available in browser');
                break;
            case 2: // Setup
                this.state = MENU_STATE.SETUP;
                this.cursor = 4;  // Start on "Accept Changes"
                break;
        }
    }

    selectSetupMenu() {
        switch (this.cursor) {
            case 0: // Hostname - not editable in browser
                break;
            case 1: // Player name - not editable in browser (would need text input)
                break;
            case 2: // Shirt color - cycle with Enter
                this.playerShirtColor = (this.playerShirtColor + 1) % 14;
                break;
            case 3: // Pants color - cycle with Enter
                this.playerPantsColor = (this.playerPantsColor + 1) % 14;
                break;
            case 4: // Accept Changes
                this.state = MENU_STATE.MULTIPLAYER;
                this.cursor = 2;  // Return to Setup option
                break;
        }
    }

    back() {
        this.playSound('misc/menu3.wav');

        switch (this.state) {
            case MENU_STATE.SINGLE_PLAYER:
                this.state = MENU_STATE.MAIN;
                this.cursor = 0;
                break;
            case MENU_STATE.MULTIPLAYER:
                this.state = MENU_STATE.MAIN;
                this.cursor = 1;  // Return to Multiplayer item
                break;
            case MENU_STATE.SETUP:
                this.state = MENU_STATE.MULTIPLAYER;
                this.cursor = 2;  // Return to Setup item
                break;
            case MENU_STATE.OPTIONS:
                this.state = MENU_STATE.MAIN;
                this.cursor = 2;  // Return to Options item
                break;
            case MENU_STATE.VIDEO_OPTIONS:
                this.state = MENU_STATE.OPTIONS;
                this.cursor = 9;  // Return to Video Options item
                break;
            case MENU_STATE.MAIN:
                // At main menu with transparent background (demo playing),
                // Escape dismisses menu and returns to demo
                if (this.transparentBackground && this.onDismiss) {
                    this.onDismiss();
                }
                // Otherwise Escape does nothing - user must select an option
                break;
        }
    }

    playSound(name) {
        if (this.audio) {
            // Resume audio context if suspended (requires user interaction)
            this.audio.resume();
            this.audio.playLocal(`sound/${name}`);
        }
    }

    drawOptions() {
        // Draw background plaque (original: M_DrawTransPic (16, 4, ...))
        this.drawPic(16, 4, 'qplaque');

        // Draw title - try to load p_option.lmp, fall back to text
        const titlePic = this.pics.get('p_option');
        if (titlePic) {
            this.drawPic((320 - titlePic.width) / 2, 4, 'p_option');
        } else {
            this.drawCenteredText(4, 'OPTIONS');
        }

        // Original Quake layout: labels start at x=16, values at x=220
        // Items are 8 pixels apart, starting at y=32
        const startY = 32;
        const itemHeight = 8;
        let y = startY;

        // Matching original M_Options_Draw exactly:
        // M_Print (16, 32, "    Customize controls");
        this.drawText(16, y, '    Customize controls'); y += itemHeight;
        // M_Print (16, 40, "         Go to console");
        this.drawText(16, y, '         Go to console'); y += itemHeight;
        // M_Print (16, 48, "     Reset to defaults");
        this.drawText(16, y, '     Reset to defaults'); y += itemHeight;

        // M_Print (16, 56, "           Screen size");
        this.drawText(16, y, '           Screen size');
        this.drawSlider(220, y, (this.settings.screenSize - 0.3) / 0.7);
        y += itemHeight;

        // M_Print (16, 64, "            Brightness");
        this.drawText(16, y, '            Brightness');
        this.drawSlider(220, y, this.settings.brightness);
        y += itemHeight;

        // M_Print (16, 72, "           Mouse Speed");
        this.drawText(16, y, '           Mouse Speed');
        this.drawSlider(220, y, (this.settings.sensitivity - 0.01) / 0.49);
        y += itemHeight;

        // M_Print (16, 80, "          Sound Volume");
        this.drawText(16, y, '          Sound Volume');
        this.drawSlider(220, y, this.settings.volume);
        y += itemHeight;

        // M_Print (16, 88,  "            Always Run");
        this.drawText(16, y, '            Always Run');
        this.drawCheckbox(220, y, this.settings.alwaysRun);
        y += itemHeight;

        // M_Print (16, 96, "          Invert Mouse");
        this.drawText(16, y, '          Invert Mouse');
        this.drawCheckbox(220, y, this.settings.invertMouse);
        y += itemHeight;

        // M_Print (16, 104, "         Video Options");
        this.drawText(16, y, '         Video Options');

        // Draw cursor (original: character 12+((int)(realtime*4)&1) at x=200)
        const cursorChar = 12 + (Math.floor(this.time * 4) & 1);
        this.drawChar(200, startY + this.cursor * itemHeight, cursorChar);
    }

    drawVideoOptions() {
        // Draw background plaque
        this.drawPic(16, 4, 'qplaque');

        // Draw title
        const titlePic = this.pics.get('p_option');
        if (titlePic) {
            this.drawPic((320 - titlePic.width) / 2, 4, 'p_option');
        } else {
            this.drawCenteredText(4, 'VIDEO');
        }

        const startY = 32;
        const itemHeight = 8;

        // Right-aligned labels
        this.drawText(16, startY + 0 * itemHeight, '        Field of View');
        this.drawSlider(220, startY + 0 * itemHeight, (this.settings.fov - 60) / 60);
        // Show actual FOV value after slider
        this.drawText(220 + 11 * 8, startY + 0 * itemHeight, String(Math.round(this.settings.fov)));

        // Texture filtering option (gl_texturemode equivalent)
        this.drawText(16, startY + 1 * itemHeight, '    Texture Filtering');
        this.drawText(220, startY + 1 * itemHeight, this.settings.textureSmooth ? 'Smooth' : 'Pixelated');

        this.drawText(16, startY + 2 * itemHeight, '                 Back');

        // Draw cursor
        const cursorChar = 12 + (Math.floor(this.time * 4) & 1);
        this.drawChar(200, startY + this.cursor * itemHeight, cursorChar);
    }

    drawText(x, y, text, scale = 1, white = false) {
        // Original M_Print adds 128 to each char for bronze/gold color
        // M_PrintWhite uses chars as-is for white color
        // Default to bronze (like M_Print) since most menu text is bronze
        this.drawBitmapText(x, y, text, scale, !white);
    }

    drawBitmapText(x, y, text, scale = 1, bronze = true) {
        if (!this.charsetCanvas) return;

        const s = this.scale;
        const charWidth = 8;
        const charHeight = 8;

        // Pre-calculate scaled dimensions (round to prevent sub-pixel artifacts)
        const scaledCharWidth = Math.round(charWidth * scale * s);
        const scaledCharHeight = Math.round(charHeight * scale * s);
        const baseX = Math.round(this.offsetX + x * s);
        const baseY = Math.round(this.offsetY + y * s);
        const charSpacing = Math.round(charWidth * scale * s);

        for (let i = 0; i < text.length; i++) {
            let charCode = text.charCodeAt(i);

            // Convert to valid range
            if (charCode < 32 || charCode > 127) {
                charCode = 32; // Default to space
            }

            // Original: M_DrawCharacter (cx, cy, (*str)+128) for bronze
            // Characters 128-255 are bronze/gold versions of 0-127
            let charIndex = charCode;
            if (bronze) {
                charIndex = charCode + 128;
            }
            charIndex = charIndex & 255;

            // Original: row = num>>4; col = num&15;
            const col = charIndex & 15;
            const row = charIndex >> 4;
            const srcX = col * charWidth;
            const srcY = row * charHeight;

            // Original: x += 8 after each character
            const dx = baseX + i * charSpacing;

            this.ctx.drawImage(
                this.charsetCanvas,
                srcX, srcY, charWidth, charHeight,
                dx, baseY, scaledCharWidth, scaledCharHeight
            );
        }
    }

    drawSlider(x, y, value) {
        // Original Quake slider uses charset characters:
        // 128 = left bracket [
        // 129 = middle bar -
        // 130 = right bracket ]
        // 131 = slider knob/indicator
        // SLIDER_RANGE = 10 characters wide

        const SLIDER_RANGE = 10;

        // Clamp value
        if (value < 0) value = 0;
        if (value > 1) value = 1;

        // Draw left bracket at x-8
        this.drawChar(x - 8, y, 128);

        // Draw middle bars
        for (let i = 0; i < SLIDER_RANGE; i++) {
            this.drawChar(x + i * 8, y, 129);
        }

        // Draw right bracket
        this.drawChar(x + SLIDER_RANGE * 8, y, 130);

        // Draw slider knob at position based on value
        // Original: M_DrawCharacter (x + (SLIDER_RANGE-1)*8 * range, y, 131);
        const knobPos = Math.floor((SLIDER_RANGE - 1) * 8 * value);
        this.drawChar(x + knobPos, y, 131);
    }

    drawCheckbox(x, y, on) {
        // Original: M_Print (x, y, on ? "on" : "off");
        this.drawText(x, y, on ? 'on' : 'off');
    }

    drawChar(x, y, charIndex) {
        // Draw a single character from the charset
        if (!this.charsetCanvas) return;

        const s = this.scale;
        const charWidth = 8;
        const charHeight = 8;

        // Original: row = num>>4; col = num&15;
        charIndex = charIndex & 255;
        const col = charIndex & 15;
        const row = charIndex >> 4;
        const srcX = col * charWidth;
        const srcY = row * charHeight;

        // Round destination coordinates to prevent sub-pixel rendering artifacts
        const dx = Math.round(this.offsetX + x * s);
        const dy = Math.round(this.offsetY + y * s);
        const dw = Math.round(charWidth * s);
        const dh = Math.round(charHeight * s);

        this.ctx.drawImage(
            this.charsetCanvas,
            srcX, srcY, charWidth, charHeight,
            dx, dy, dw, dh
        );
    }

    drawCenteredText(y, text, scale = 1, white = false) {
        // Center text horizontally on the 320-pixel virtual screen
        const x = (320 - text.length * 8 * scale) / 2;
        this.drawText(x, y, text, scale, white);
    }

    selectOptionsMenu() {
        switch (this.cursor) {
            case 0: // Customize controls
                // Not implemented - would need key binding menu
                console.log('Customize controls not implemented');
                break;
            case 1: // Go to console
                // Hide menu and show console (like original)
                console.log('Menu: Go to console selected, gameConsole:', this.gameConsole ? 'exists' : 'null');
                this.hide();
                if (this.gameConsole) {
                    this.gameConsole.toggle();
                } else {
                    console.error('Menu: gameConsole is not set!');
                }
                break;
            case 2: // Reset to defaults
                this.resetToDefaults();
                break;
            case 3: // Screen size - adjust with Enter
                this.settings.screenSize = this.cycleValue(this.settings.screenSize, 0.1, 1.0);
                if (this.settings.screenSize < 0.3) this.settings.screenSize = 0.3;
                this.applySettings();
                break;
            case 4: // Brightness - adjust with Enter
                this.settings.brightness = this.cycleValue(this.settings.brightness, 0.1);
                this.applySettings();
                break;
            case 5: // Mouse Speed - adjust with Enter
                this.settings.sensitivity = this.cycleValue(this.settings.sensitivity, 0.05, 0.5);
                if (this.settings.sensitivity < 0.01) this.settings.sensitivity = 0.01;
                this.applySettings();
                break;
            case 6: // Sound Volume - adjust with Enter
                this.settings.volume = this.cycleValue(this.settings.volume, 0.1);
                this.applySettings();
                break;
            case 7: // Always Run
                this.settings.alwaysRun = !this.settings.alwaysRun;
                this.applySettings();
                break;
            case 8: // Invert Mouse
                this.settings.invertMouse = !this.settings.invertMouse;
                this.applySettings();
                break;
            case 9: // Video Options
                this.state = MENU_STATE.VIDEO_OPTIONS;
                this.cursor = 0;
                break;
        }
    }

    selectVideoOptionsMenu() {
        switch (this.cursor) {
            case 0: // FOV - cycle through values
                this.settings.fov = this.cycleFOV(this.settings.fov);
                this.applySettings();
                break;
            case 1: // Texture Filtering - toggle
                this.settings.textureSmooth = !this.settings.textureSmooth;
                this.applySettings();
                break;
            case 2: // Back
                this.back();
                break;
        }
    }

    adjustValue(direction) {
        // Only adjust values in options menus
        if (this.state === MENU_STATE.OPTIONS) {
            switch (this.cursor) {
                case 3: // Screen size
                    this.settings.screenSize = Math.max(0.3, Math.min(1, this.settings.screenSize + direction * 0.1));
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
                case 4: // Brightness
                    this.settings.brightness = Math.max(0, Math.min(1, this.settings.brightness + direction * 0.1));
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
                case 5: // Mouse Speed
                    this.settings.sensitivity = Math.max(0.01, Math.min(0.5, this.settings.sensitivity + direction * 0.02));
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
                case 6: // Sound Volume
                    this.settings.volume = Math.max(0, Math.min(1, this.settings.volume + direction * 0.1));
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
                case 7: // Always Run (left/right toggles)
                    this.settings.alwaysRun = !this.settings.alwaysRun;
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
                case 8: // Invert Mouse (left/right toggles)
                    this.settings.invertMouse = !this.settings.invertMouse;
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
            }
        } else if (this.state === MENU_STATE.VIDEO_OPTIONS) {
            switch (this.cursor) {
                case 0: // FOV
                    this.settings.fov = Math.max(60, Math.min(120, this.settings.fov + direction * 5));
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
                case 1: // Texture Filtering (left/right toggles)
                    this.settings.textureSmooth = !this.settings.textureSmooth;
                    this.applySettings();
                    this.playSound('misc/menu3.wav');
                    break;
            }
        } else if (this.state === MENU_STATE.SETUP) {
            switch (this.cursor) {
                case 2: // Shirt color
                    this.playerShirtColor = (this.playerShirtColor + direction + 14) % 14;
                    this.playSound('misc/menu3.wav');
                    break;
                case 3: // Pants color
                    this.playerPantsColor = (this.playerPantsColor + direction + 14) % 14;
                    this.playSound('misc/menu3.wav');
                    break;
            }
        }
    }

    cycleValue(current, step, max = 1) {
        let value = current + step;
        if (value > max) value = 0;
        return Math.round(value * 100) / 100;
    }

    cycleFOV(current) {
        const values = [60, 70, 80, 90, 100, 110, 120];
        const idx = values.indexOf(current);
        if (idx === -1 || idx === values.length - 1) return values[0];
        return values[idx + 1];
    }

    resetToDefaults() {
        // Reset all settings to default values (like original "Reset to defaults")
        this.settings = {
            screenSize: 1.0,
            brightness: 0.5,
            sensitivity: 0.15,
            musicVolume: 0.7,
            volume: 0.7,
            alwaysRun: false,
            invertMouse: false,
            lookspring: false,
            lookstrafe: false,
            fov: 90,
            textureSmooth: false
        };
        this.applySettings();
        this.playSound('misc/menu2.wav');
    }

    loadCurrentSettings() {
        // Load settings from audio/input managers if available
        if (this.audio) {
            this.settings.volume = this.audio.volume ?? 0.7;
            this.settings.musicVolume = this.audio.musicVolume ?? 0.7;
        }
        if (this.input) {
            this.settings.sensitivity = this.input.sensitivity ?? 0.15;
            this.settings.invertMouse = this.input.invertMouse ?? false;
            this.settings.alwaysRun = this.input.alwaysRun ?? false;
        }
    }

    applySettings() {
        // Apply volume settings
        if (this.audio) {
            this.audio.setVolume(this.settings.volume);
            if (this.audio.setMusicVolume) {
                this.audio.setMusicVolume(this.settings.musicVolume);
            }
        }

        // Apply input settings
        if (this.input) {
            this.input.sensitivity = this.settings.sensitivity;
            this.input.invertMouse = this.settings.invertMouse;
            this.input.alwaysRun = this.settings.alwaysRun;
        }

        // Apply FOV, brightness, screen size via callback
        if (this.onSettingsChange) {
            this.onSettingsChange(this.settings);
        }
    }

    show() {
        this.state = MENU_STATE.MAIN;
        this.cursor = 0;
        this.canvas.style.display = 'block';
    }

    hide() {
        this.state = MENU_STATE.NONE;
        this.canvas.style.display = 'none';
    }

    isVisible() {
        return this.state !== MENU_STATE.NONE;
    }

    destroy() {
        document.removeEventListener('keydown', this.boundKeyDown);
        if (this.canvas) {
            this.canvas.removeEventListener('pointerdown', this.boundPointerDown);
            this.canvas.removeEventListener('pointermove', this.boundPointerMove);
            if (this.canvas.parentNode) {
                this.canvas.parentNode.removeChild(this.canvas);
            }
        }
    }
}
