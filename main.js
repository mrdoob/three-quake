import { Game } from './src/Game.js';
import { Menu } from './src/ui/Menu.js';
import { Console } from './src/ui/Console.js';
import { setConsole, Con_Printf } from './src/system/Logger.js';

/**
 * Quake Three.js Port - Entry Point
 */

let game = null;
let menu = null;
let gameConsole = null;
let menuAnimationId = null;

// Mobile detection
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                 (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
let mobileFullscreenActivated = false;

// Demo loop state
let demoList = [];         // List of available demos
let currentDemoIndex = 0;  // Current demo in the loop
let demoLoopActive = false; // True when attract mode is running

// UI Elements
const loadingScreen = document.getElementById('loading-screen');
const startScreen = document.getElementById('start-screen');
const hud = document.getElementById('hud');
const crosshair = document.getElementById('crosshair');

/**
 * Request fullscreen and lock to landscape orientation on mobile
 */
async function requestMobileFullscreen() {
    if (mobileFullscreenActivated) return;

    try {
        // Request fullscreen
        const container = document.documentElement;
        if (container.requestFullscreen) {
            await container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
            await container.webkitRequestFullscreen();
        }

        // Lock to landscape orientation
        if (screen.orientation && screen.orientation.lock) {
            try {
                await screen.orientation.lock('landscape');
                console.log('Orientation locked to landscape');
            } catch (e) {
                // Orientation lock may not be supported or allowed
                console.log('Could not lock orientation:', e.message);
            }
        }

        mobileFullscreenActivated = true;
    } catch (e) {
        console.log('Could not enter fullscreen:', e.message);
    }
}

async function init() {
    const container = document.getElementById('game-container');

    // Create game instance
    game = new Game(container);
    await game.init();

    // Start screen click handler
    startScreen.addEventListener('click', async () => {
        // On mobile, request fullscreen + landscape lock on first interaction
        if (isMobile) {
            await requestMobileFullscreen();
        }
        startGame();
    });

    // Load pak0.pak
    try {
        const response = await fetch('pak0.pak');
        if (!response.ok) {
            throw new Error('pak0.pak not found');
        }
        console.log('Loading pak0.pak...');
        const arrayBuffer = await response.arrayBuffer();
        await loadPAKFromBuffer(arrayBuffer);
    } catch (error) {
        console.error('Failed to load PAK:', error);
        game.setLoadingText(`Error: ${error.message}`);
    }
}

async function loadPAKFromBuffer(arrayBuffer) {
    try {
        game.setLoadingText('Loading PAK...');
        game.setLoadingProgress(0.2);

        // Load PAK
        await game.loadPAK(arrayBuffer);
        game.setLoadingProgress(1.0);

        // List available maps
        const maps = game.pak.list('maps/').filter(f => f.endsWith('.bsp'));
        console.log('Available maps:', maps);

        // Create and show menu
        const container = document.getElementById('game-container');
        menu = new Menu(container, game.pak);

        // Wait for menu graphics to load
        console.log('Waiting for menu graphics to load...');
        await menu.init();
        console.log('Menu graphics loaded, menu.loaded:', menu.loaded);

        // Initialize audio for menu sounds
        console.log('Initializing audio...');
        await game.audio.init();
        menu.audio = game.audio;
        menu.input = game.input;

        // Handle settings changes from menu
        menu.onSettingsChange = (settings) => {
            if (game.renderer) {
                if (settings.fov !== undefined) {
                    game.renderer.setFOV(settings.fov);
                }
                if (settings.brightness !== undefined) {
                    game.renderer.setBrightness(settings.brightness);
                }
                if (settings.textureSmooth !== undefined) {
                    game.renderer.setTextureFiltering(settings.textureSmooth);
                }
            }
        };

        // Preload menu sounds
        try {
            await game.audio.loadSoundFromPAK(game.pak, 'sound/misc/menu1.wav');
            await game.audio.loadSoundFromPAK(game.pak, 'sound/misc/menu2.wav');
            await game.audio.loadSoundFromPAK(game.pak, 'sound/misc/menu3.wav');
        } catch (e) {
            console.warn('Could not load menu sounds:', e);
        }

        // Create console
        gameConsole = new Console(container, game.pak);
        await gameConsole.init();

        // Set up Logger to use in-game console
        setConsole(gameConsole);

        // Attach console to game for update/draw in game loop
        game.console = gameConsole;

        // Give menu access to console
        menu.gameConsole = gameConsole;

        // Handle console commands
        gameConsole.onCommand = (cmd, args) => {
            if (cmd === 'map' && args.length > 0) {
                loadMap(args[0]);
            } else if (cmd === 'god') {
                if (game.player) {
                    game.player.godMode = !game.player.godMode;
                    gameConsole.print(`God mode ${game.player.godMode ? 'ON' : 'OFF'}\n`);
                }
            } else if (cmd === 'noclip') {
                if (game.player) {
                    game.player.noClip = !game.player.noClip;
                    gameConsole.print(`Noclip ${game.player.noClip ? 'ON' : 'OFF'}\n`);
                }
            } else if (cmd === 'give') {
                gameConsole.print('Give command not implemented\n');
            } else if (cmd === 'play' && args.length > 0) {
                // Play a sound
                const soundName = args[0];
                if (game.audio) {
                    game.audio.playLocal(soundName);
                    gameConsole.print(`Playing: ${soundName}\n`);
                }
            } else if (cmd === 'playvol' && args.length >= 2) {
                // Play a sound with volume
                const soundName = args[0];
                const volume = parseFloat(args[1]) || 1.0;
                if (game.audio) {
                    game.audio.playLocal(soundName, volume);
                    gameConsole.print(`Playing: ${soundName} at volume ${volume}\n`);
                }
            } else if (cmd === 'kill') {
                // Kill the player
                if (game.player) {
                    game.player.health = 0;
                    gameConsole.print("Killed.\n");
                }
            } else if (cmd === 'impulse' && args.length > 0) {
                // Handle impulse commands (weapon switching)
                const impulseNum = parseInt(args[0]);
                if (!isNaN(impulseNum)) {
                    if (impulseNum >= 1 && impulseNum <= 8) {
                        // Weapon switch (1-8)
                        gameConsole.print(`Weapon ${impulseNum}\n`);
                    } else if (impulseNum === 9) {
                        // Cheat: give all weapons
                        gameConsole.print('All weapons\n');
                    } else if (impulseNum === 255) {
                        // Quad damage cheat
                        gameConsole.print('Quad damage!\n');
                    }
                }
            } else if (cmd === 'soundlist') {
                // List loaded sounds
                if (game.audio && game.audio.sounds) {
                    gameConsole.print('Loaded sounds:\n');
                    for (const name of game.audio.sounds.keys()) {
                        gameConsole.print(`  ${name}\n`);
                    }
                    gameConsole.print(`Total: ${game.audio.sounds.size} sounds\n`);
                }
            } else if (cmd === 'soundinfo') {
                // Show sound system info
                if (game.audio) {
                    gameConsole.print('Sound system info:\n');
                    gameConsole.print(`  Initialized: ${game.audio.initialized}\n`);
                    gameConsole.print(`  Muted: ${game.audio.muted}\n`);
                    gameConsole.print(`  Volume: ${game.audio.volume}\n`);
                    gameConsole.print(`  Active sounds: ${game.audio.activeSounds?.length || 0}\n`);
                }
            } else if (cmd === 'status') {
                // Show game status
                gameConsole.print('Game status:\n');
                gameConsole.print(`  Running: ${game.running}\n`);
                gameConsole.print(`  Paused: ${game.paused}\n`);
                if (game.player) {
                    gameConsole.print(`  Health: ${game.player.health}\n`);
                    gameConsole.print(`  Armor: ${game.player.armor}\n`);
                    gameConsole.print(`  Position: ${Math.floor(game.player.position.x)}, ${Math.floor(game.player.position.y)}, ${Math.floor(game.player.position.z)}\n`);
                }
            }
        };

        // Handle console closing - show menu
        gameConsole.onClose = () => {
            menu.show();
            startMenuLoop();
        };

        // Register "demos" command to return to demo loop
        gameConsole.registerCommand('demos', () => {
            if (demoList.length > 0) {
                gameConsole.print('Returning to demos...\n');
                gameConsole.toggle();  // Close console
                menu.hide();
                // Stop menu loop
                if (menuAnimationId) {
                    cancelAnimationFrame(menuAnimationId);
                    menuAnimationId = null;
                }
                startDemoLoop();
            } else {
                gameConsole.print('No demos available\n');
            }
        });

        // Register map command to list available maps
        gameConsole.registerCommand('maps', () => {
            const maps = game.pak.list('maps/').filter(f => f.endsWith('.bsp'));
            gameConsole.print('Available maps:\n');
            for (const map of maps) {
                const name = map.replace('maps/', '').replace('.bsp', '');
                gameConsole.print('  ' + name + '\n');
            }
        });

        // Set up menu callbacks
        menu.onNewGame = () => {
            startNewGame();
        };

        menu.onQuit = () => {
            console.log('Quit requested');
            // In browser, we can't really quit - just show a message
            alert('Thanks for playing!');
        };

        // Called when user dismisses menu while demo is playing (Escape at main menu)
        menu.onDismiss = () => {
            if (demoLoopActive) {
                // Hide menu and return to watching demo
                menu.hide();
                // Stop menu animation loop, demo loop continues
                if (menuAnimationId) {
                    cancelAnimationFrame(menuAnimationId);
                    menuAnimationId = null;
                }
                // Re-add demo input listeners
                document.addEventListener('keydown', onDemoKeyPress);
                document.addEventListener('mousedown', onDemoKeyPress);
                document.addEventListener('touchstart', onDemoKeyPress, { passive: false });
            }
        };

        // Find available demos in PAK
        demoList = findDemos();
        console.log('Available demos:', demoList);

        // Hide loading screen
        setTimeout(() => {
            loadingScreen.classList.add('hidden');

            // Start demo loop (attract mode) if demos are available
            if (demoList.length > 0) {
                startDemoLoop();
            } else {
                // No demos, just show menu
                menu.show();
                startMenuLoop();
            }
        }, 500);

    } catch (error) {
        console.error('Failed to load PAK:', error);
        game.setLoadingText(`Error: ${error.message}`);
    }
}

function startMenuLoop() {
    // Don't start another loop if one is already running
    if (menuAnimationId !== null) {
        return;
    }

    console.log('Starting menu loop, menu visible:', menu?.isVisible());
    let lastTime = performance.now();

    function menuLoop() {
        // Continue loop if menu OR console is visible (and game not running)
        const menuVisible = menu && menu.isVisible();
        const consoleVisible = gameConsole && gameConsole.isVisible();

        if (!menuVisible && !consoleVisible) {
            console.log('Menu loop exiting - neither menu nor console visible');
            menuAnimationId = null;
            return;
        }

        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000;
        lastTime = now;

        // Update and draw menu if visible
        if (menuVisible) {
            menu.update(deltaTime);
            menu.draw();
        }

        // Update and draw console if visible
        if (consoleVisible) {
            gameConsole.update(deltaTime);
            gameConsole.draw();
        } else if (gameConsole && gameConsole.visible) {
            // Console is marked visible but isVisible() is false - log this discrepancy
            console.log('Console visible but isVisible false:', gameConsole.visible, gameConsole.visibleLines);
        }

        menuAnimationId = requestAnimationFrame(menuLoop);
    }

    menuAnimationId = requestAnimationFrame(menuLoop);
}

async function startNewGame() {
    // On mobile, request fullscreen
    if (isMobile) {
        await requestMobileFullscreen();
    }

    // Stop menu animation
    if (menuAnimationId) {
        cancelAnimationFrame(menuAnimationId);
        menuAnimationId = null;
    }

    // Stop demo if playing
    if (demoLoopActive) {
        demoLoopActive = false;
        document.removeEventListener('keydown', onDemoKeyPress);
        document.removeEventListener('mousedown', onDemoKeyPress);
        document.removeEventListener('touchstart', onDemoKeyPress);
        if (game) {
            game.stopDemo();
            game.stop();
        }
    }

    // Reset menu background mode
    menu.transparentBackground = false;

    // Hide menu
    menu.hide();

    // Show loading screen temporarily
    loadingScreen.classList.remove('hidden');

    // Determine which map to load
    let mapName = 'start';
    if (!game.pak.has('maps/start.bsp')) {
        if (game.pak.has('maps/e1m1.bsp')) {
            mapName = 'e1m1';
        } else {
            const maps = game.pak.list('maps/').filter(f => f.endsWith('.bsp'));
            if (maps.length > 0) {
                mapName = maps[0].replace('maps/', '').replace('.bsp', '');
            }
        }
    }

    try {
        game.setLoadingProgress(0.4);
        await game.loadLevel(mapName);
        game.setLoadingProgress(1.0);

        // Hide loading and start game directly
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            startGame();
        }, 500);
    } catch (error) {
        console.error('Failed to load level:', error);
        game.setLoadingText(`Error: ${error.message}`);
    }
}

function startGame() {
    // Request pointer lock (or enable touch controls on mobile)
    game.input.requestPointerLock();

    // Enable touch controls on mobile
    if (isMobile && game.input.touchControls) {
        game.input.enableTouchControls();

        // Set up pause callback
        game.input.touchControls.onPause = () => {
            if (game && game.running && !game.paused) {
                game.pause();
                game.input.disableTouchControls();
                menu.show();
                startMenuLoop();
            }
        };
    }

    // Hide start screen
    startScreen.classList.remove('visible');

    // Show crosshair (HUD is now graphical, rendered by HUD.js)
    // Hide crosshair on mobile (touch controls visible instead)
    if (!isMobile) {
        crosshair.classList.add('visible');
    }

    // Resume audio context
    game.audio.resume();

    // Mark game as in progress (shows Continue option in menu)
    menu.gameInProgress = true;

    // Set up resume callback for menu
    menu.onResume = async () => {
        // Re-enter fullscreen on mobile if needed
        if (isMobile) {
            await requestMobileFullscreen();
        }
        menu.hide();
        game.input.requestPointerLock();
        if (isMobile && game.input.touchControls) {
            game.input.enableTouchControls();
        }
        // Resume game
        if (game.paused) {
            game.audio.resume();
            game.resume();
        }
    };

    // Start game loop
    game.start();
}

// Handle pointer lock changes (desktop only)
document.addEventListener('pointerlockchange', () => {
    // Skip on mobile (uses touch controls, not pointer lock)
    if (isMobile) return;

    if (!document.pointerLockElement && game && game.running && !game.paused) {
        // Pointer lock lost while game running - pause and show menu
        game.pause();
        crosshair.classList.remove('visible');
        menu.show();
        startMenuLoop();
    } else if (document.pointerLockElement && game && game.paused) {
        // Pointer lock acquired while paused - resume game
        game.audio.resume();
        game.resume();
        crosshair.classList.add('visible');
    }
});

// Handle escape key during gameplay
document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;

    // Console is open - let console handle it
    if (gameConsole && gameConsole.isVisible()) {
        return;
    }

    // Menu is open - let menu handle it
    if (menu && menu.isVisible()) {
        return;
    }

    // Game is running - pause and show menu
    if (game && game.running && document.pointerLockElement) {
        document.exitPointerLock();
    }
});

// Handle click to resume game (browser requires click for pointer lock)
document.getElementById('game-container').addEventListener('click', () => {
    // Only handle if game is paused and no UI is visible
    if (game && game.running && game.paused &&
        (!menu || !menu.isVisible()) &&
        (!gameConsole || !gameConsole.isVisible())) {
        game.input.requestPointerLock();
    }
});

// Load a map by name
async function loadMap(mapName) {
    if (!game || !game.pak) return;

    // Check if map exists
    const mapPath = `maps/${mapName}.bsp`;
    if (!game.pak.has(mapPath)) {
        if (gameConsole) {
            gameConsole.print(`Map not found: ${mapName}\n`);
        }
        return;
    }

    try {
        if (gameConsole) {
            gameConsole.print(`Loading ${mapName}...\n`);
            gameConsole.toggle();  // Close console
        }

        await game.loadLevel(mapName);

        if (gameConsole) {
            gameConsole.print(`Loaded ${mapName}\n`);
        }
    } catch (error) {
        console.error('Failed to load map:', error);
        if (gameConsole) {
            gameConsole.print(`Error loading ${mapName}: ${error.message}\n`);
        }
    }
}

// === Demo Loop (Attract Mode) ===

/**
 * Find available demo files in the PAK
 */
function findDemos() {
    if (!game || !game.pak) return [];

    const demos = [];
    // Standard Quake demos
    const standardDemos = ['demo1', 'demo2', 'demo3'];

    for (const name of standardDemos) {
        if (game.pak.has(`${name}.dem`)) {
            demos.push(name);
        }
    }

    // Also check for any other .dem files
    const allFiles = game.pak.list('');
    for (const file of allFiles) {
        if (file.endsWith('.dem') && !file.includes('/')) {
            const name = file.replace('.dem', '');
            if (!demos.includes(name)) {
                demos.push(name);
            }
        }
    }

    return demos;
}

/**
 * Start the demo loop (attract mode)
 */
async function startDemoLoop() {
    if (demoList.length === 0) {
        console.log('No demos available');
        menu.show();
        startMenuLoop();
        return;
    }

    // Hide menu while demo plays (will be shown with transparent bg on key press)
    menu.hide();

    // Stop any existing menu loop
    if (menuAnimationId) {
        cancelAnimationFrame(menuAnimationId);
        menuAnimationId = null;
    }

    demoLoopActive = true;
    currentDemoIndex = 0;

    // Set up key/touch listener to interrupt demo
    document.addEventListener('keydown', onDemoKeyPress);
    document.addEventListener('mousedown', onDemoKeyPress);
    document.addEventListener('touchstart', onDemoKeyPress, { passive: false });

    // Play first demo
    await playNextDemo();
}

/**
 * Stop the demo loop and show menu
 */
function stopDemoLoop() {
    demoLoopActive = false;
    document.removeEventListener('keydown', onDemoKeyPress);
    document.removeEventListener('mousedown', onDemoKeyPress);
    document.removeEventListener('touchstart', onDemoKeyPress);

    if (game) {
        game.stopDemo();
        game.stop();
    }

    // Show menu with solid background (no demo behind)
    menu.transparentBackground = false;
    menu.show();
    startMenuLoop();
}

let demoFailCount = 0;  // Track consecutive failures to prevent infinite loops

/**
 * Play the next demo in the loop
 */
async function playNextDemo() {
    if (!demoLoopActive || demoList.length === 0) return;

    // Prevent infinite loop if all demos fail
    if (demoFailCount >= demoList.length) {
        console.error('All demos failed to load, stopping demo loop');
        demoFailCount = 0;
        stopDemoLoop();
        return;
    }

    const demoName = demoList[currentDemoIndex];
    console.log(`Playing demo: ${demoName} (${currentDemoIndex + 1}/${demoList.length})`);

    // Show loading screen briefly
    loadingScreen.classList.remove('hidden');
    game.setLoadingText(`Loading ${demoName}...`);

    try {
        // Set up demo finished callback to play next
        // Use setTimeout to break call stack and let game loop exit cleanly
        // COMMENTED OUT: Auto-advance to next demo disabled for debugging
        // game.onDemoFinished = () => {
        //     if (demoLoopActive) {
        //         // Move to next demo after a short delay
        //         setTimeout(() => {
        //             currentDemoIndex = (currentDemoIndex + 1) % demoList.length;
        //             demoFailCount = 0;  // Reset fail count on successful playback
        //             playNextDemo();
        //         }, 100);
        //     }
        // };

        // Start playing the demo
        const success = await game.playDemo(demoName);
        if (!success) {
            console.error('Failed to load demo:', demoName);
            // COMMENTED OUT: Auto-advance on failure disabled for debugging
            // demoFailCount++;
            // currentDemoIndex = (currentDemoIndex + 1) % demoList.length;
            // if (demoLoopActive) {
            //     setTimeout(() => playNextDemo(), 100);
            // }
            stopDemoLoop();  // Just stop and show menu on failure
            return;
        }

        // Demo loaded successfully
        demoFailCount = 0;

        // Hide loading screen
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
        }, 100);

        // Start demo game loop
        game.startDemoLoop();

    } catch (error) {
        console.error('Error playing demo:', error);
        loadingScreen.classList.add('hidden');
        stopDemoLoop();
    }
}

/**
 * Handle key/mouse/touch during demo - shows menu overlay while demo continues
 * Like original Quake, the demo keeps playing in the background with menu on top
 */
async function onDemoKeyPress(e) {
    // Ignore modifier keys alone
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
    }

    // If menu is already visible, let it handle the input
    if (menu && menu.isVisible()) {
        return;
    }

    console.log('Demo interrupted - showing menu overlay');

    // On mobile, request fullscreen on first interaction
    if (isMobile && e.type === 'touchstart') {
        await requestMobileFullscreen();
    }

    // Remove demo input listeners (menu will handle input now)
    document.removeEventListener('keydown', onDemoKeyPress);
    document.removeEventListener('mousedown', onDemoKeyPress);
    document.removeEventListener('touchstart', onDemoKeyPress);

    // Show menu with transparent background (demo visible behind)
    menu.transparentBackground = true;
    menu.show();

    // Demo continues playing - we just need to render menu on top
    // Start a loop that draws the menu while demo renders in background
    startMenuOverDemoLoop();
}

/**
 * Start menu overlay loop while demo continues playing
 * The game's demo loop handles rendering; we just update/draw menu on top
 */
function startMenuOverDemoLoop() {
    if (menuAnimationId !== null) {
        return;
    }

    let lastTime = performance.now();

    function menuOverDemoLoop() {
        const menuVisible = menu && menu.isVisible();
        const consoleVisible = gameConsole && gameConsole.isVisible();

        // If neither menu nor console is visible, re-enable demo input listeners
        if (!menuVisible && !consoleVisible) {
            menuAnimationId = null;
            // Re-add demo input listeners
            if (demoLoopActive) {
                document.addEventListener('keydown', onDemoKeyPress);
                document.addEventListener('mousedown', onDemoKeyPress);
                document.addEventListener('touchstart', onDemoKeyPress, { passive: false });
            }
            return;
        }

        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000;
        lastTime = now;

        // Update and draw menu if visible
        if (menuVisible) {
            menu.update(deltaTime);
            menu.draw();
        }

        // Update and draw console if visible
        if (consoleVisible) {
            gameConsole.update(deltaTime);
            gameConsole.draw();
        }

        menuAnimationId = requestAnimationFrame(menuOverDemoLoop);
    }

    menuAnimationId = requestAnimationFrame(menuOverDemoLoop);
}

/**
 * Resume demo loop (called when menu is closed without starting a game)
 */
function resumeDemoLoop() {
    if (demoList.length > 0 && !game.running) {
        startDemoLoop();
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', init);

// Export for debugging
window.game = () => game;
window.demos = () => demoList;
