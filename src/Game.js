import * as THREE from 'three';
import { Renderer } from './render/Renderer.js';
import { Physics } from './physics/Physics.js';
import { EntityManager } from './entities/EntityManager.js';
import { EntitySpawner } from './entities/EntitySpawner.js';
import { InputManager } from './input/InputManager.js';
import { AudioManager } from './audio/AudioManager.js';
import { HUD } from './ui/HUD.js';
import { DebugOverlay } from './ui/DebugOverlay.js';
import { createPlayer, playerThink, playerSelectWeapon } from './entities/Player.js';
import { monsterTakeDamage } from './entities/Monster.js';
import { fireWeapon, canFire } from './game/Weapons.js';
import { updateItems } from './game/Items.js';
import { PAKLoader } from './loaders/PAKLoader.js';
import { BSPLoader } from './loaders/BSPLoader.js';
import { DemoPlayer, EF } from './DemoPlayer.js';
import { Intermission } from './ui/Intermission.js';
import { MusicManager } from './audio/MusicManager.js';
import { SaveSystem } from './SaveSystem.js';
import { setConsole, Con_Printf } from './system/Logger.js';

/**
 * Game - Main game class
 *
 * Manages game loop, state, and subsystems
 */

// Fixed physics timestep (72 Hz like Quake)
const PHYSICS_TIMESTEP = 1 / 72;
const MAX_FRAME_TIME = 0.25; // Prevent spiral of death

export class Game {
    constructor(container) {
        this.container = container;

        // Subsystems
        this.renderer = null;
        this.physics = null;
        this.entities = null;
        this.spawner = null;
        this.input = null;
        this.audio = null;
        this.hud = null;
        this.console = null;

        // Assets
        this.pak = null;
        this.bsp = null;

        // Game state
        this.running = false;
        this.paused = false;
        this.time = 0;
        this.deltaTime = 0;
        this.physicsAccumulator = 0;
        this.skill = 1;  // Difficulty: 0=easy, 1=normal, 2=hard, 3=nightmare

        // Level stats
        this.stats = {
            levelName: '',
            levelStartTime: 0,
            kills: 0,
            totalKills: 0,
            secrets: 0,
            totalSecrets: 0
        };

        // Intermission screen
        this.intermission = null;

        // Player
        this.player = null;

        // Demo playback
        this.demoPlayer = null;
        this.demoMode = false;  // True when playing a demo
        this.demoTransitioning = false;  // True while loading next demo
        this.demoVisualEntities = new Map();  // entityNum -> { mesh, modelPath }
        this.demoStaticEntities = [];  // Array of static entity visuals (torches, etc.)
        this.demoList = [];  // List of available demos
        this.currentDemoIndex = -1;  // Index of currently playing demo

        // Callbacks
        this.onLoadProgress = null;
        this.onReady = null;

        // Frame timing
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        this.fpsTime = 0;
    }

    async init() {
        // Create renderer
        this.renderer = new Renderer(this.container);

        // Create input manager
        this.input = new InputManager(this.renderer.getCanvas());

        // Create audio manager
        this.audio = new AudioManager();

        // Create music manager
        this.music = new MusicManager();

        // Create save system
        this.saveSystem = new SaveSystem(this);

        // Setup save/load key bindings (F5/F9 like classic shooters)
        this.setupSaveLoadKeys();

        console.log('Game systems initialized');
    }

    async loadPAK(arrayBuffer) {
        this.setLoadingText('Loading PAK file...');

        this.pak = new PAKLoader();
        await this.pak.load(arrayBuffer);

        console.log(`PAK loaded: ${this.pak.files.size} files`);

        // Load palette if present
        if (this.pak.has('gfx/palette.lmp')) {
            // Could override default palette
        }

        return this.pak;
    }

    async loadLevel(mapName) {
        if (!this.pak) {
            throw new Error('PAK file not loaded');
        }

        const mapPath = `maps/${mapName}.bsp`;
        this.setLoadingText(`Loading ${mapName}...`);

        // Get BSP data from PAK
        const bspData = this.pak.get(mapPath);
        if (!bspData) {
            throw new Error(`Map not found: ${mapPath}`);
        }

        // Store current map name
        this.currentMap = mapName;

        // Parse BSP
        this.setLoadingText('Parsing BSP...');
        this.bsp = new BSPLoader();
        this.bsp.load(bspData);

        // Initialize physics
        this.setLoadingText('Initializing physics...');
        this.physics = new Physics(this.bsp, this);

        // Initialize entities
        this.entities = new EntityManager(this);
        this.spawner = new EntitySpawner(this);

        // Load level into renderer
        this.setLoadingText('Building geometry...');
        await this.renderer.loadLevel(this.bsp, this.pak);

        // Spawn entities from BSP
        this.setLoadingText('Spawning entities...');
        await this.spawner.spawnEntities(this.bsp);

        // Create player
        const playerStart = this.bsp.getPlayerStart();
        this.player = createPlayer(this.entities, playerStart.position, { pitch: 0, yaw: playerStart.angle, roll: 0 });

        // Add player to physics
        this.physics.addEntity(this.player);

        // Initialize audio and preload sounds
        await this.audio.init();
        await this.preloadSounds();

        // Create HUD
        this.hud = new HUD(this.container, this.pak);

        // Create debug overlay (toggle with F3)
        if (!this.debugOverlay) {
            this.debugOverlay = new DebugOverlay(this);
        }

        // Create intermission screen
        if (!this.intermission) {
            this.intermission = new Intermission(this.container);
        }

        // Initialize level stats
        this.stats = {
            levelName: this.bsp.getLevelName() || mapName,
            levelStartTime: this.time,
            kills: 0,
            totalKills: this.entities.monsters.filter(m => m.active).length,
            secrets: 0,
            totalSecrets: this.countSecrets()
        };

        // Play level music (from worldspawn 'sounds' field)
        const musicTrack = this.bsp.getMusicTrack();
        if (musicTrack && this.music) {
            this.music.play(musicTrack);
        }

        console.log(`Level ${mapName} loaded - ${this.stats.totalKills} monsters, ${this.stats.totalSecrets} secrets`);

        if (this.onReady) {
            this.onReady();
        }
    }

    start() {
        if (this.running) return;

        this.running = true;
        this.lastFrameTime = performance.now();
        this.gameLoop();
    }

    stop() {
        this.running = false;
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
        this.lastFrameTime = performance.now();
    }

    gameLoop() {
        if (!this.running) return;

        const now = performance.now();
        let frameTime = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        // Clamp frame time
        if (frameTime > MAX_FRAME_TIME) {
            frameTime = MAX_FRAME_TIME;
        }

        // FPS counter
        this.frameCount++;
        this.fpsTime += frameTime;
        if (this.fpsTime >= 1.0) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.fpsTime -= 1.0;
        }

        if (!this.paused) {
            // Update input
            this.input.update();

            // Fixed timestep physics
            this.physicsAccumulator += frameTime;
            while (this.physicsAccumulator >= PHYSICS_TIMESTEP) {
                this.fixedUpdate(PHYSICS_TIMESTEP);
                this.physicsAccumulator -= PHYSICS_TIMESTEP;
            }

            // Variable update
            this.update(frameTime);
        }

        // Render
        this.render();

        // Clear per-frame input state
        this.input.clearFrame();

        // Next frame
        requestAnimationFrame(() => this.gameLoop());
    }

    fixedUpdate(dt) {
        this.deltaTime = dt;
        this.time += dt;

        // Update player input
        if (this.player) {
            this.updatePlayerInput();
        }

        // Physics update
        if (this.physics) {
            this.physics.update(dt);
        }

        // Entity updates
        if (this.entities) {
            this.entities.update(dt, this.time);

            // Check player touching triggers
            if (this.player) {
                this.entities.checkTouches(this.player);
            }
        }
    }

    update(dt) {
        // Player think
        if (this.player) {
            playerThink(this.player, this);
        }

        // Items update
        updateItems(this, dt);

        // Update monster animations
        this.updateMonsterAnimations(dt);

        // Renderer update (animations, effects)
        if (this.renderer) {
            this.renderer.update(dt);

            // Update weapon viewmodel
            if (this.player) {
                this.renderer.updateWeapon(dt, this.player);
            }

            // Update view effects (damage flash, powerups, underwater)
            if (this.player) {
                this.renderer.updateViewEffects(this.player, dt);
            }
        }

        // Update HUD
        this.updateHUD();
    }

    updateMonsterAnimations(dt) {
        if (!this.entities || !this.renderer) return;

        for (const monster of this.entities.monsters) {
            if (monster.mesh && monster.active) {
                // Sync mesh position with physics position every frame for smooth movement
                // (Physics updates entity.position, but mesh was only updated in think() every 0.1s)
                monster.mesh.position.set(
                    monster.position.x,
                    monster.position.y,
                    monster.position.z
                );
                monster.mesh.rotation.z = monster.angles.yaw * Math.PI / 180;

                // Update animation
                if (this.renderer.aliasRenderer) {
                    this.renderer.aliasRenderer.updateAnimation(monster.mesh, dt);

                    // Update model lighting based on position (R_LightPoint)
                    // Original Quake samples light at model position for shading
                    if (this.renderer.bspRenderer) {
                        const lightLevel = this.renderer.bspRenderer.lightPoint(monster.position);
                        this.renderer.aliasRenderer.updateShading(monster.mesh, lightLevel);
                    }
                }
            }
        }
    }

    updatePlayerInput() {
        if (!this.player || !this.input.pointerLocked) return;

        // Get input
        const moveInput = this.input.getMoveInput();
        this.player.input = moveInput;

        // Mouse look
        const mouseDelta = this.input.getMouseDelta();
        this.player.angles.yaw -= mouseDelta.x;
        this.player.angles.pitch += mouseDelta.y;

        // Clamp pitch
        this.player.angles.pitch = Math.max(-89, Math.min(89, this.player.angles.pitch));

        // Weapon selection
        const weaponSelect = this.input.getWeaponSelect();
        if (weaponSelect > 0) {
            playerSelectWeapon(this.player, weaponSelect, this);
        }

        // Attack
        if (moveInput.attack) {
            if (canFire(this.player, this)) {
                fireWeapon(this.player, this);
                // Trigger weapon viewmodel animation
                if (this.renderer) {
                    this.renderer.fireWeapon();
                }
            }
        }

        // Use key - activate buttons/doors when looking at them
        if (moveInput.use) {
            this.tryUseEntity();
        }
    }

    /**
     * Try to use an entity the player is looking at
     */
    tryUseEntity() {
        if (!this.player || !this.physics) return;

        const USE_RANGE = 96; // Max distance to use an entity

        // Calculate view direction
        const yawRad = this.player.angles.yaw * Math.PI / 180;
        const pitchRad = this.player.angles.pitch * Math.PI / 180;
        const cosPitch = Math.cos(pitchRad);

        const viewDir = {
            x: Math.cos(yawRad) * cosPitch,
            y: Math.sin(yawRad) * cosPitch,
            z: -Math.sin(pitchRad)
        };

        // Eye position (player position + eye height)
        const eyePos = {
            x: this.player.position.x,
            y: this.player.position.y,
            z: this.player.position.z + 22 // Eye height
        };


        // Check func entities for use
        let closestDist = USE_RANGE;
        let closestEntity = null;

        for (const func of this.entities.funcs) {
            if (!func.active || !func.hull) continue;
            if (!func.use && !func.touch) continue;

            // Get entity bounds in world space
            const mins = {
                x: func.position.x + func.hull.mins.x,
                y: func.position.y + func.hull.mins.y,
                z: func.position.z + func.hull.mins.z
            };
            const maxs = {
                x: func.position.x + func.hull.maxs.x,
                y: func.position.y + func.hull.maxs.y,
                z: func.position.z + func.hull.maxs.z
            };

            // Simple ray-box intersection test
            const hit = this.rayBoxIntersect(eyePos, viewDir, mins, maxs, USE_RANGE);
            if (hit !== null && hit < closestDist) {
                closestDist = hit;
                closestEntity = func;
            }
        }

        if (closestEntity) {
            // Prefer use callback, fall back to touch
            if (closestEntity.use) {
                closestEntity.use(closestEntity, this.player, this);
            } else if (closestEntity.touch) {
                closestEntity.touch(closestEntity, this.player, this);
            }
        }
    }

    /**
     * Ray-box intersection test
     * Returns distance to intersection or null if no hit
     */
    rayBoxIntersect(origin, dir, mins, maxs, maxDist) {
        let tmin = 0;
        let tmax = maxDist;

        for (let i = 0; i < 3; i++) {
            const axis = ['x', 'y', 'z'][i];
            const invD = 1.0 / dir[axis];
            let t0 = (mins[axis] - origin[axis]) * invD;
            let t1 = (maxs[axis] - origin[axis]) * invD;

            if (invD < 0) {
                const tmp = t0;
                t0 = t1;
                t1 = tmp;
            }

            tmin = Math.max(tmin, t0);
            tmax = Math.min(tmax, t1);

            if (tmax < tmin) {
                return null;
            }
        }

        return tmin;
    }

    render() {
        if (!this.renderer || !this.player) return;

        // Update camera from player (strafe roll and view bob are calculated in Renderer)
        this.renderer.updateCamera(this.player.position, this.player.angles, this.player.velocity, {
            viewHeight: this.player.viewHeight || 22,
            onGround: this.player.onGround,
            time: this.time,
            deltaTime: this.deltaTime
        });

        // Update audio listener
        this.updateAudioListener();

        // Render scene
        this.renderer.render();

        // Update debug overlay
        if (this.debugOverlay) {
            this.debugOverlay.update();
        }

        // Update and draw console (always, even when paused)
        if (this.console) {
            this.console.update(this.deltaTime);
            this.console.draw();
        }
    }

    updateHUD() {
        if (!this.player || !this.hud) return;

        // Draw the graphical HUD
        this.hud.draw(this.player);
    }

    setLoadingText(text) {
        const el = document.getElementById('loading-text');
        if (el) {
            el.textContent = text;
        }
    }

    setLoadingProgress(progress) {
        const el = document.getElementById('loading-bar');
        if (el) {
            el.style.width = `${progress * 100}%`;
        }
    }

    async preloadSounds() {
        if (!this.pak || !this.audio) return;

        this.setLoadingText('Loading sounds...');

        // Common weapon sounds
        const weaponSounds = [
            'weapons/ax1.wav',
            'weapons/guncock.wav',
            'weapons/shotgn2.wav',
            'weapons/rocket1i.wav',
            'weapons/spike2.wav',
            'weapons/grenade.wav',
            'weapons/bounce.wav',   // Grenade bounce sound
            'weapons/sgun1.wav',
            'weapons/lhit.wav',
            'weapons/lstart.wav',   // Lightning gun start sound
            'weapons/r_exp3.wav',
            'weapons/ric1.wav',
            'weapons/ric2.wav',
            'weapons/ric3.wav',
            'weapons/tink1.wav'
        ];

        // Player sounds
        const playerSounds = [
            'player/pain1.wav',
            'player/pain2.wav',
            'player/pain3.wav',
            'player/pain4.wav',
            'player/pain5.wav',
            'player/pain6.wav',
            'player/death1.wav',
            'player/death2.wav',
            'player/death3.wav',
            'player/death4.wav',
            'player/death5.wav',
            'player/udeath.wav',  // Gib sound (underwater/overkill death)
            'player/axhit2.wav',  // Axe wall hit sound
            'player/land.wav',
            'player/land2.wav',
            'player/plyrjmp8.wav',
            'misc/water1.wav',
            'misc/water2.wav'
        ];

        // Item sounds
        const itemSounds = [
            'items/armor1.wav',
            'items/health1.wav',
            'items/r_item2.wav',
            'items/itembk2.wav',
            'weapons/lock4.wav',
            'weapons/pkup.wav',
            'items/protect.wav',
            'items/protect2.wav',
            'items/protect3.wav',
            'items/damage.wav',
            'items/damage2.wav',
            'items/damage3.wav',
            'items/inv1.wav',
            'items/inv2.wav',
            'items/inv3.wav',
            'items/suit.wav',
            'misc/medkey.wav',
            'misc/runekey.wav'
        ];

        // Monster sounds (common)
        const monsterSounds = [
            'soldier/sight1.wav',
            'soldier/pain1.wav',
            'soldier/death1.wav',
            'soldier/sattck1.wav',
            'dog/dsight.wav',
            'dog/dpain1.wav',
            'dog/ddeath.wav',
            'dog/dattack1.wav',
            'ogre/ogwake.wav',
            'ogre/ogpain1.wav',
            'ogre/ogdth.wav',
            'knight/ksight.wav',
            'knight/khurt.wav',
            'knight/kdeath.wav',
            'demon/sight2.wav',
            'demon/dpain1.wav',
            'demon/ddeath.wav',
            'wizard/wsight.wav',
            'wizard/wpain.wav',
            'wizard/wdeath.wav',
            'zombie/z_idle.wav',
            'zombie/z_pain.wav',
            'zombie/z_gib.wav',
            'zombie/z_shot1.wav',
            'wizard/wattack.wav',
            'shambler/ssight.wav',
            'shambler/shurt2.wav',
            'shambler/sdeath.wav',
            'hknight/sight1.wav',
            'hknight/pain1.wav',
            'hknight/death1.wav',
            'enforcer/sight1.wav',
            'enforcer/pain1.wav',
            'enforcer/death1.wav',
            'shalrath/sight.wav',
            'shalrath/pain.wav',
            'shalrath/death.wav',
            'blob/sight1.wav',
            'blob/hit1.wav',
            'blob/death1.wav',
            'fish/pain.wav',
            'fish/death.wav'
        ];

        // Misc sounds
        const miscSounds = [
            'misc/secret.wav',
            'misc/talk.wav',
            'misc/r_tele1.wav',
            'misc/r_tele2.wav',
            'misc/r_tele3.wav',
            'misc/r_tele4.wav',
            'misc/r_tele5.wav',
            'doors/doormv1.wav',
            'doors/drcls4.wav',
            'buttons/switch21.wav',
            'plats/train2.wav',
            'ambience/wind2.wav'
        ];

        const allSounds = [
            ...weaponSounds,
            ...playerSounds,
            ...itemSounds,
            ...monsterSounds,
            ...miscSounds
        ];

        let loaded = 0;
        for (const sound of allSounds) {
            try {
                await this.audio.loadSoundFromPAK(this.pak, `sound/${sound}`);
                loaded++;
            } catch (e) {
                // Sound not found, skip silently
            }
        }

        console.log(`Loaded ${loaded}/${allSounds.length} sounds`);

        // Load ambient sounds (water, sky, slime, lava) for BSP leaf-based ambient system
        // Original: S_UpdateAmbientSounds from snd_dma.c
        await this.audio.loadAmbientSounds(this.pak);
    }

    updateAudioListener() {
        if (!this.audio || !this.player) return;

        const pos = this.player.position;
        const yaw = this.player.angles.yaw * Math.PI / 180;
        const pitch = this.player.angles.pitch * Math.PI / 180;

        // Calculate forward vector
        const forward = {
            x: Math.cos(yaw) * Math.cos(pitch),
            y: Math.sin(yaw) * Math.cos(pitch),
            z: -Math.sin(pitch)
        };

        // Up vector (Quake uses Z-up)
        const up = { x: 0, y: 0, z: 1 };

        this.audio.updateListener(
            { x: pos.x, y: pos.y, z: pos.z + 22 },
            forward,
            up
        );

        // Update ambient sounds based on current BSP leaf
        // Original: S_UpdateAmbientSounds from snd_dma.c
        if (this.bspCollision) {
            const ambientLevels = this.bspCollision.getAmbientLevels(pos);
            this.audio.updateAmbientSounds(ambientLevels, this.deltaTime);
        }
    }

    // Utility methods
    get effects() {
        return this.renderer?.effects;
    }

    countSecrets() {
        let count = 0;
        for (const trigger of this.entities.triggers) {
            if (trigger.active && trigger.classname === 'trigger_secret') {
                count++;
            }
        }
        return count;
    }

    incrementKills() {
        this.stats.kills++;
    }

    incrementSecrets() {
        this.stats.secrets++;
    }

    /**
     * Show intermission screen before level change
     * Original Quake: execute_changelevel in client.qc
     */
    async showIntermission(nextMap) {
        if (!nextMap) {
            console.error('showIntermission called with empty nextMap!');
            return;
        }

        console.log(`Changing level to: ${nextMap}`);

        // Set intermission flag to prevent player movement
        this.intermissionRunning = true;

        try {
            // TODO: Actually show intermission screen with stats
            // For now, just load the next level directly
            await this.loadLevel(nextMap);
            this.intermissionRunning = false;
        } catch (e) {
            console.error(`Failed to load level ${nextMap}:`, e);
            this.intermissionRunning = false;
        }
    }

    traceLine(start, end) {
        return this.physics.traceLine(start, end);
    }

    /**
     * Deal damage to an entity
     * @param {Object} target - Entity taking damage
     * @param {number} damage - Amount of damage
     * @param {Object} attacker - Entity responsible for the damage
     * @param {Object} inflictor - Source of damage (projectile position, etc.) - optional
     */
    dealDamage(target, damage, attacker, inflictor = null) {
        if (!target || !target.health) return;

        // Get inflictor position for knockback (default to attacker position)
        const inflictorPos = inflictor?.position || attacker?.position;

        if (target.classname === 'player') {
            // Apply armor absorption (combat.qc:134-143)
            // save = ceil(targ.armortype*damage)
            let absorbed = 0;
            if (target.armor > 0 && target.armorType > 0) {
                absorbed = Math.ceil(damage * target.armorType);
                absorbed = Math.min(absorbed, target.armor);
                target.armor -= absorbed;

                // Remove armor item if depleted (combat.qc:137-139)
                if (target.armor <= 0) {
                    target.armorType = 0;
                }
            }

            const take = Math.ceil(damage - absorbed);
            target.health -= take;

            // Apply knockback (combat.qc:159-177)
            // dir = targ.origin - inflictor center
            // targ.velocity = targ.velocity + dir * damage * 8
            if (inflictorPos && target.velocity) {
                const dir = {
                    x: target.position.x - inflictorPos.x,
                    y: target.position.y - inflictorPos.y,
                    z: target.position.z - inflictorPos.z
                };
                const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
                if (len > 0) {
                    dir.x /= len;
                    dir.y /= len;
                    dir.z /= len;

                    // Knockback formula: damage * 8
                    const knockback = damage * 8;
                    target.velocity.x += dir.x * knockback;
                    target.velocity.y += dir.y * knockback;
                    target.velocity.z += dir.z * knockback;
                }
            }

            // Damage flash - original Quake formula from V_ParseDamage (view.c:331-360)
            // count = blood*0.5 + armor*0.5; if (count < 10) count = 10;
            // percent += 3*count; capped at 150
            let count = take * 0.5 + absorbed * 0.5;
            if (count < 10) count = 10;
            target.damagePercent = Math.min((target.damagePercent || 0) + 3 * count, 150);

            // Set damage color based on armor vs blood (view.c:343-360)
            // armor > blood: (200, 100, 100) - brownish red
            // armor > 0: (220, 50, 50) - red-orange
            // blood only: (255, 0, 0) - pure red
            if (absorbed > take) {
                target.damageColor = { r: 200, g: 100, b: 100 };
            } else if (absorbed > 0) {
                target.damageColor = { r: 220, g: 50, b: 50 };
            } else {
                target.damageColor = { r: 255, g: 0, b: 0 };
            }

            // Calculate view kick from damage direction (view.c:362-378)
            // Original: from = damage_source - player_origin
            //           v_dmg_roll = count * DotProduct(from, right) * v_kickroll
            //           v_dmg_pitch = count * DotProduct(from, forward) * v_kickpitch
            if (inflictorPos && this.renderer) {
                const V_KICKROLL = 0.6;
                const V_KICKPITCH = 0.6;

                // Get direction from player to damage source (normalized earlier as 'dir')
                // But we need damage source to player, so negate
                const from = {
                    x: inflictorPos.x - target.position.x,
                    y: inflictorPos.y - target.position.y,
                    z: inflictorPos.z - target.position.z
                };
                const fromLen = Math.sqrt(from.x * from.x + from.y * from.y + from.z * from.z);
                if (fromLen > 0) {
                    from.x /= fromLen;
                    from.y /= fromLen;
                    from.z /= fromLen;
                }

                // Get player's forward and right vectors from angles
                // angles: pitch (x), yaw (y), roll (z) in degrees
                const yawRad = (target.angles?.y || 0) * Math.PI / 180;
                const pitchRad = (target.angles?.x || 0) * Math.PI / 180;

                // Forward vector (Quake: cos(yaw)*cos(pitch), sin(yaw)*cos(pitch), -sin(pitch))
                const forward = {
                    x: Math.cos(yawRad) * Math.cos(pitchRad),
                    y: Math.sin(yawRad) * Math.cos(pitchRad),
                    z: -Math.sin(pitchRad)
                };

                // Right vector (Quake: sin(yaw), -cos(yaw), 0) - perpendicular in XY plane
                const right = {
                    x: Math.sin(yawRad),
                    y: -Math.cos(yawRad),
                    z: 0
                };

                // Calculate kick amounts
                const sideKick = from.x * right.x + from.y * right.y + from.z * right.z;
                const forwardKick = from.x * forward.x + from.y * forward.y + from.z * forward.z;

                const kickRoll = count * sideKick * V_KICKROLL;
                const kickPitch = count * forwardKick * V_KICKPITCH;

                // Apply view kick to renderer
                this.renderer.setViewKick(kickPitch, kickRoll);
            }

            if (target.health <= 0) {
                target.health = 0;

                // Check for gib (health < -40 typically causes gib in Quake)
                if (target.health < -40) {
                    console.log('Player gibbed!');
                    // Would spawn gib effect
                    if (this.effects) {
                        this.effects.blood(target.position, 10); // More blood for gib
                    }
                } else {
                    console.log('Player died!');
                }
                // Would trigger death sequence
            }
        } else if (target.category === 'monster') {
            // Pass inflictor to monster damage for knockback
            monsterTakeDamage(target, damage, attacker, this, inflictor);
        }
    }

    // === Demo Playback ===

    /**
     * Get list of available demos from PAK
     */
    getDemoList() {
        if (!this.pak) return [];

        if (this.demoList.length === 0) {
            this.demoList = this.pak.listByExtension('.dem').sort();
            console.log(`Found ${this.demoList.length} demos:`, this.demoList);
        }

        return this.demoList;
    }

    /**
     * Play the next demo in the list
     */
    async playNextDemo() {
        const demos = this.getDemoList();
        if (demos.length === 0) {
            console.log('No demos available');
            return false;
        }

        // Advance to next demo (wrap around)
        this.currentDemoIndex = (this.currentDemoIndex + 1) % demos.length;
        const demoName = demos[this.currentDemoIndex];

        console.log(`Playing demo ${this.currentDemoIndex + 1}/${demos.length}: ${demoName}`);
        return this.playDemo(demoName);
    }

    /**
     * Load and play a demo file
     */
    async playDemo(demoName) {
        if (!this.pak) {
            console.error('PAK not loaded');
            return false;
        }

        // Initialize demo list and track index
        const demos = this.getDemoList();
        const demoIndex = demos.indexOf(demoName.toLowerCase());
        if (demoIndex >= 0) {
            this.currentDemoIndex = demoIndex;
        }

        // Create demo player if needed
        if (!this.demoPlayer) {
            this.demoPlayer = new DemoPlayer(this);
        }

        // Load the demo
        const loaded = await this.demoPlayer.load(this.pak, demoName);
        if (!loaded) {
            return false;
        }

        // Find the map name from the demo
        const mapName = this.demoPlayer.findMapName();
        if (!mapName) {
            // If we can't determine the map, the demo is likely corrupted or incompatible
            console.warn('Could not determine map from demo - skipping');
            // Try the next demo
            return this.playNextDemo();
        }

        console.log(`Demo requires map: ${mapName}`);
        try {
            await this.loadLevelForDemo(mapName);
        } catch (e) {
            console.error('Failed to load map for demo:', e);
            // Try the next demo
            return this.playNextDemo();
        }

        // Set up demo finished callback to auto-advance
        this.demoPlayer.onFinished = async () => {
            // Prevent re-entry during transition
            if (this.demoTransitioning) return;

            console.log('Demo finished, playing next...');
            this.demoTransitioning = true;

            try {
                if (this.onDemoFinished) {
                    this.onDemoFinished();
                }

                // Auto-advance to next demo
                await this.playNextDemo();
            } finally {
                this.demoTransitioning = false;
            }

            // Restart the game loop if it stopped
            if (this.demoMode && !this.running) {
                this.running = true;
                this.lastFrameTime = performance.now();
                this.demoGameLoop();
            }
        };

        // Start demo playback
        this.demoMode = true;
        this.demoPlayer.play();

        return true;
    }

    /**
     * Load a level specifically for demo playback (no player creation)
     */
    async loadLevelForDemo(mapName) {
        if (!this.pak) {
            throw new Error('PAK file not loaded');
        }

        const mapPath = `maps/${mapName}.bsp`;
        this.setLoadingText(`Loading ${mapName}...`);

        // Get BSP data from PAK
        const bspData = this.pak.get(mapPath);
        if (!bspData) {
            throw new Error(`Map not found: ${mapPath}`);
        }

        // Clear existing level
        if (this.renderer) {
            this.renderer.clearLevel();
        }
        this.entities = null;
        this.spawner = null;
        this.physics = null;
        this.player = null;
        this.hud = null;

        // Clear demo visual entities with proper disposal
        for (const [entityNum, visual] of this.demoVisualEntities) {
            if (visual.mesh) {
                this.renderer.removeFromScene(visual.mesh);
                if (visual.mesh.geometry) {
                    visual.mesh.geometry.dispose();
                }
                if (visual.mesh.material) {
                    if (Array.isArray(visual.mesh.material)) {
                        visual.mesh.material.forEach(m => m && m.dispose && m.dispose());
                    } else if (visual.mesh.material.dispose) {
                        visual.mesh.material.dispose();
                    }
                }
            }
        }
        this.demoVisualEntities.clear();

        // Clean up static entity visuals
        for (const visual of this.demoStaticEntities) {
            if (visual.mesh) {
                this.renderer.removeFromScene(visual.mesh);
                if (visual.mesh.geometry) {
                    visual.mesh.geometry.dispose();
                }
                if (visual.mesh.material) {
                    if (Array.isArray(visual.mesh.material)) {
                        visual.mesh.material.forEach(m => m && m.dispose && m.dispose());
                    } else if (visual.mesh.material.dispose) {
                        visual.mesh.material.dispose();
                    }
                }
            }
        }
        this.demoStaticEntities = [];

        // Store current map name
        this.currentMap = mapName;

        // Parse BSP
        this.setLoadingText('Parsing BSP...');
        this.bsp = new BSPLoader();
        this.bsp.load(bspData);

        // Initialize physics (needed for collision)
        this.physics = new Physics(this.bsp, this);

        // Initialize entities
        this.entities = new EntityManager(this);
        this.spawner = new EntitySpawner(this);

        // Load level into renderer
        this.setLoadingText('Building geometry...');
        await this.renderer.loadLevel(this.bsp, this.pak);

        // Spawn entities from BSP (skip monsters/items - they come from demo protocol)
        this.setLoadingText('Spawning entities...');
        await this.spawner.spawnEntities(this.bsp, { skipVisuals: true });

        // Create a dummy player for camera position
        const playerStart = this.bsp.getPlayerStart();
        this.player = {
            position: { ...playerStart.position },
            angles: { pitch: 0, yaw: playerStart.angle, roll: 0 },
            viewBob: 0,
            viewRoll: 0
        };

        console.log(`Level ${mapName} loaded for demo`);
    }

    /**
     * Stop demo playback
     */
    stopDemo() {
        if (this.demoPlayer) {
            this.demoPlayer.stop();
        }
        this.demoMode = false;
        this.demoTransitioning = false;

        // Clean up demo visual entities with proper disposal
        for (const [entityNum, visual] of this.demoVisualEntities) {
            if (visual.mesh) {
                this.renderer.removeFromScene(visual.mesh);
                if (visual.mesh.geometry) {
                    visual.mesh.geometry.dispose();
                }
                if (visual.mesh.material) {
                    if (Array.isArray(visual.mesh.material)) {
                        visual.mesh.material.forEach(m => m && m.dispose && m.dispose());
                    } else if (visual.mesh.material.dispose) {
                        visual.mesh.material.dispose();
                    }
                }
            }
        }
        this.demoVisualEntities.clear();

        // Clean up static entity visuals
        for (const visual of this.demoStaticEntities) {
            if (visual.mesh) {
                this.renderer.removeFromScene(visual.mesh);
                if (visual.mesh.geometry) {
                    visual.mesh.geometry.dispose();
                }
                if (visual.mesh.material) {
                    if (Array.isArray(visual.mesh.material)) {
                        visual.mesh.material.forEach(m => m && m.dispose && m.dispose());
                    } else if (visual.mesh.material.dispose) {
                        visual.mesh.material.dispose();
                    }
                }
            }
        }
        this.demoStaticEntities = [];
    }

    /**
     * Sync demo entity data to visual meshes
     */
    syncDemoEntitiesToVisuals() {
        if (!this.demoPlayer || !this.renderer) return;

        const precache = this.demoPlayer.modelPrecache;
        if (!precache || precache.length === 0) return;

        // Calculate interpolation fraction for smooth movement
        const frac = this.demoPlayer.calcLerpFrac();

        // Track which entities are still active
        const activeEntities = new Set();

        for (const [entityNum, ent] of this.demoPlayer.entities) {
            // Skip view entity (player) - handled separately
            if (entityNum === this.demoPlayer.viewEntity) continue;

            // Skip entities with no model
            if (!ent.modelIndex || ent.modelIndex <= 0) continue;
            if (ent.modelIndex >= precache.length) continue;

            // Skip entities not updated in current message packet
            // (matching CL_RelinkEntities: if (ent->msgtime != cl.mtime[0]) continue)
            if (ent.msgtime !== this.demoPlayer.mtime[0]) continue;

            const modelPath = precache[ent.modelIndex];
            if (!modelPath) continue;

            // Skip the map model (index 1, ends with .bsp)
            if (modelPath.endsWith('.bsp')) continue;

            // Skip entities with EF_NODRAW (server.h:177)
            if (ent.effects & EF.NODRAW) continue;

            activeEntities.add(entityNum);

            // Check if this is a brush model (doors, platforms, etc.)
            const isBrushModel = modelPath.startsWith('*');

            // Interpolate position
            const origin = {
                x: ent.msg_origins[1].x + frac * (ent.msg_origins[0].x - ent.msg_origins[1].x),
                y: ent.msg_origins[1].y + frac * (ent.msg_origins[0].y - ent.msg_origins[1].y),
                z: ent.msg_origins[1].z + frac * (ent.msg_origins[0].z - ent.msg_origins[1].z)
            };

            // Interpolate angles with wraparound
            const angles = {
                pitch: this.demoPlayer.lerpAngle(ent.msg_angles[1].pitch, ent.msg_angles[0].pitch, frac),
                yaw: this.demoPlayer.lerpAngle(ent.msg_angles[1].yaw, ent.msg_angles[0].yaw, frac),
                roll: this.demoPlayer.lerpAngle(ent.msg_angles[1].roll, ent.msg_angles[0].roll, frac)
            };

            // Get or create visual entity
            let visual = this.demoVisualEntities.get(entityNum);

            if (!visual || visual.modelPath !== modelPath) {
                // Need to create new visual for this entity
                if (visual && visual.mesh) {
                    this.renderer.removeFromScene(visual.mesh);
                    // Dispose old mesh resources
                    if (visual.mesh.geometry) {
                        visual.mesh.geometry.dispose();
                    }
                    if (visual.mesh.material) {
                        if (Array.isArray(visual.mesh.material)) {
                            visual.mesh.material.forEach(m => m && m.dispose && m.dispose());
                        } else if (visual.mesh.material.dispose) {
                            visual.mesh.material.dispose();
                        }
                    }
                }

                visual = { mesh: null, modelPath, loading: true, isBrushModel };
                this.demoVisualEntities.set(entityNum, visual);

                // Load model asynchronously
                this.loadDemoEntityModel(entityNum, modelPath, isBrushModel);
            }

            // Update position and rotation if mesh exists
            if (visual.mesh) {
                visual.mesh.position.set(origin.x, origin.y, origin.z);

                // Match Quake's R_RotateForEntity from gl_rmain.c:
                // glRotatef(yaw, 0, 0, 1);   // Z axis (first)
                // glRotatef(-pitch, 0, 1, 0); // Y axis (second, local)
                // glRotatef(roll, 1, 0, 0);   // X axis (third, local)
                // This is intrinsic rotation order: Z, then Y, then X
                // Three.js order 'ZYX' = intrinsic Z first, then Y, then X
                //
                // Note: For brush models, there's a "stupid quake bug" (gl_rsurf.c:1144)
                // where pitch is negated before and after R_RotateForEntity, so pitch
                // is NOT negated for brush models.
                visual.mesh.rotation.order = 'ZYX';
                visual.mesh.rotation.z = angles.yaw * Math.PI / 180;
                visual.mesh.rotation.y = (isBrushModel ? angles.pitch : -angles.pitch) * Math.PI / 180;
                visual.mesh.rotation.x = angles.roll * Math.PI / 180;

                // Update animation frame (only for alias models, not brush models or sprites)
                if (!visual.isBrushModel && !visual.isSprite && this.renderer.aliasRenderer) {
                    this.renderer.aliasRenderer.setFrame(visual.mesh, ent.frame);
                }
            }

            // Apply entity effects (EF_ flags from server.h:169-177)
            this.applyEntityEffects(visual, ent, origin);
        }

        // Remove visuals for entities no longer in demo
        for (const [entityNum, visual] of this.demoVisualEntities) {
            if (!activeEntities.has(entityNum)) {
                if (visual.mesh) {
                    this.renderer.removeFromScene(visual.mesh);
                    // Dispose cloned geometry to prevent memory leaks
                    if (visual.mesh.geometry) {
                        visual.mesh.geometry.dispose();
                    }
                    // Handle both single materials and material arrays
                    if (visual.mesh.material) {
                        if (Array.isArray(visual.mesh.material)) {
                            visual.mesh.material.forEach(m => m && m.dispose && m.dispose());
                        } else if (visual.mesh.material.dispose) {
                            visual.mesh.material.dispose();
                        }
                    }
                }
                // Clean up entity effect lights
                if (visual.brightLight) {
                    this.renderer.scene.remove(visual.brightLight);
                    visual.brightLight.dispose();
                }
                if (visual.dimLight) {
                    this.renderer.scene.remove(visual.dimLight);
                    visual.dimLight.dispose();
                }
                this.demoVisualEntities.delete(entityNum);
            }
        }
    }

    /**
     * Apply entity effects (EF_ flags) from server.h:169-177
     * - EF_BRIGHTFIELD (1): Glowing particles around entity
     * - EF_MUZZLEFLASH (2): Gun flash
     * - EF_BRIGHTLIGHT (4): 400 radius dynamic light
     * - EF_DIMLIGHT (8): 200 radius dynamic light
     */
    applyEntityEffects(visual, ent, origin) {
        if (!this.renderer.effects) return;

        const effects = this.renderer.effects;

        // EF_BRIGHTLIGHT - 400 radius dynamic light (server.h:171)
        if (ent.effects & EF.BRIGHTLIGHT) {
            if (!visual.brightLight) {
                visual.brightLight = effects.spawnDynamicLight(origin, {
                    color: 0xffffcc,
                    radius: 400,
                    duration: 1000, // Long duration, we'll update position each frame
                    decay: 0
                });
            } else {
                // Update light position
                visual.brightLight.position.set(origin.x, origin.y, origin.z);
            }
        } else if (visual.brightLight) {
            // Remove light if effect is no longer active
            this.renderer.scene.remove(visual.brightLight);
            visual.brightLight.dispose();
            visual.brightLight = null;
        }

        // EF_DIMLIGHT - 200 radius dynamic light (server.h:172)
        if (ent.effects & EF.DIMLIGHT) {
            if (!visual.dimLight) {
                visual.dimLight = effects.spawnDynamicLight(origin, {
                    color: 0xffcc88,
                    radius: 200,
                    duration: 1000, // Long duration, we'll update position each frame
                    decay: 0
                });
            } else {
                // Update light position
                visual.dimLight.position.set(origin.x, origin.y, origin.z);
            }
        } else if (visual.dimLight) {
            // Remove light if effect is no longer active
            this.renderer.scene.remove(visual.dimLight);
            visual.dimLight.dispose();
            visual.dimLight = null;
        }

        // EF_MUZZLEFLASH - brief light flash (server.h:170)
        // Only trigger once when effect first appears
        if ((ent.effects & EF.MUZZLEFLASH) && !visual.lastMuzzleFlash) {
            // Calculate forward direction from angles
            const yawRad = (ent.msg_angles[0].yaw || 0) * Math.PI / 180;
            const pitchRad = (ent.msg_angles[0].pitch || 0) * Math.PI / 180;
            const forward = {
                x: Math.cos(yawRad) * Math.cos(pitchRad),
                y: Math.sin(yawRad) * Math.cos(pitchRad),
                z: -Math.sin(pitchRad)
            };
            effects.muzzleFlash(origin, forward);
            visual.lastMuzzleFlash = true;
        } else if (!(ent.effects & EF.MUZZLEFLASH)) {
            visual.lastMuzzleFlash = false;
        }
    }

    /**
     * Sync static entities (torches, decorations) from demo to visuals
     * Static entities are spawned once via svc_spawnstatic and never change
     */
    syncDemoStaticEntities() {
        if (!this.demoPlayer || !this.renderer) return;

        const staticEnts = this.demoPlayer.staticEntities;
        const precache = this.demoPlayer.modelPrecache;

        if (!staticEnts || staticEnts.length === 0) return;
        if (!precache || precache.length === 0) return;

        // Only spawn visuals once (static entities don't change)
        if (this.demoStaticEntities.length > 0) return;

        for (let i = 0; i < staticEnts.length; i++) {
            const ent = staticEnts[i];
            if (!ent.modelIndex || ent.modelIndex >= precache.length) continue;

            const modelPath = precache[ent.modelIndex];
            if (!modelPath) continue;

            // Skip brush models (shouldn't happen for static entities)
            if (modelPath.startsWith('*') || modelPath.endsWith('.bsp')) continue;

            // Create visual entry
            const visual = {
                mesh: null,
                modelPath,
                loading: true,
                origin: { ...ent.origin },
                angles: { ...ent.angles },
                frame: ent.frame
            };
            this.demoStaticEntities.push(visual);

            // Load model asynchronously
            this.loadStaticEntityModel(i, modelPath, ent);
        }

        console.log(`Spawning ${staticEnts.length} static entities`);
    }

    /**
     * Load a model for a static entity
     */
    async loadStaticEntityModel(index, modelPath, ent) {
        try {
            const modelData = await this.renderer.loadModel(modelPath, this.pak);
            if (!modelData) return;

            const mesh = this.renderer.createModelInstance(modelData);
            if (!mesh) return;

            // Position the mesh
            mesh.position.set(ent.origin.x, ent.origin.y, ent.origin.z);

            // Rotation order ZYX to match Quake's R_RotateForEntity
            mesh.rotation.order = 'ZYX';
            mesh.rotation.z = ent.angles.yaw * Math.PI / 180;
            mesh.rotation.y = -ent.angles.pitch * Math.PI / 180;
            mesh.rotation.x = ent.angles.roll * Math.PI / 180;

            // Store and add to scene
            const visual = this.demoStaticEntities[index];
            if (visual && visual.modelPath === modelPath) {
                visual.mesh = mesh;
                visual.loading = false;

                // Register flame models with lightStyles for frame group animation
                // GLQuake: flame models use frame groups that auto-cycle based on time
                const isFlame = modelPath === 'progs/flame.mdl' || modelPath === 'progs/flame2.mdl';
                if (isFlame && this.renderer.lightStyles) {
                    const flameData = {
                        mesh,
                        modelData,
                        light: null,
                        time: Math.random() * 10  // Random offset for variety
                    };
                    this.renderer.lightStyles.addFlame(flameData);
                } else if (this.renderer.aliasRenderer && ent.frame) {
                    // Set frame for non-flame models
                    this.renderer.aliasRenderer.setFrame(mesh, ent.frame);
                }

                this.renderer.addToScene(mesh);
            }
        } catch (e) {
            console.warn(`Failed to load static entity model ${modelPath}:`, e);
        }
    }

    /**
     * Load a model for a demo entity
     */
    async loadDemoEntityModel(entityNum, modelPath, isBrushModel = false) {
        try {
            let mesh;

            if (isBrushModel) {
                // Brush model (doors, platforms) - extract index from "*N" path
                const modelIndex = parseInt(modelPath.substring(1), 10);
                if (isNaN(modelIndex) || !this.renderer.bspRenderer) {
                    return;
                }
                mesh = this.renderer.bspRenderer.createBrushModelMesh(modelIndex);
                if (!mesh) return;
            } else {
                // Regular model (MDL or SPR)
                const modelData = await this.renderer.loadModel(modelPath, this.pak);
                if (!modelData) return;

                mesh = this.renderer.createModelInstance(modelData);
                if (!mesh) return;
            }

            // Store the loaded mesh
            const visual = this.demoVisualEntities.get(entityNum);
            if (visual && visual.modelPath === modelPath) {
                visual.mesh = mesh;
                visual.loading = false;
                visual.isSprite = modelPath.endsWith('.spr');
                this.renderer.addToScene(mesh);
            }
        } catch (e) {
            console.warn(`Failed to load demo entity model ${modelPath}:`, e);
        }
    }

    /**
     * Check if a demo is currently playing
     */
    isDemoPlaying() {
        return this.demoMode && this.demoPlayer && this.demoPlayer.isPlaying();
    }

    /**
     * Start the demo game loop (separate from regular game loop)
     */
    startDemoLoop() {
        if (this.running) return;

        this.running = true;
        this.lastFrameTime = performance.now();
        this.demoGameLoop();
    }

    /**
     * Demo-specific game loop
     */
    demoGameLoop() {
        if (!this.running || !this.demoMode) {
            this.running = false;
            return;
        }

        // Ensure audio context stays active (browser autoplay policies can suspend it)
        if (this.audio) {
            this.audio.resume();
        }

        const now = performance.now();
        let frameTime = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        // Clamp frame time
        if (frameTime > MAX_FRAME_TIME) {
            frameTime = MAX_FRAME_TIME;
        }

        // FPS counter
        this.frameCount++;
        this.fpsTime += frameTime;
        if (this.fpsTime >= 1.0) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.fpsTime -= 1.0;
        }

        // Skip processing during demo transition (loading next demo)
        if (this.demoTransitioning) {
            requestAnimationFrame(() => this.demoGameLoop());
            return;
        }

        // Update demo
        if (this.demoPlayer) {
            this.demoPlayer.update(frameTime);

            // Update player position/angles from demo
            if (this.player) {
                const viewState = this.demoPlayer.getViewState();

                // Update view angles
                this.player.angles.pitch = viewState.angles.pitch;
                this.player.angles.yaw = viewState.angles.yaw;
                this.player.angles.roll = viewState.angles.roll;

                // Update position from view entity if available
                if (viewState.origin.x !== 0 || viewState.origin.y !== 0 || viewState.origin.z !== 0) {
                    this.player.position.x = viewState.origin.x;
                    this.player.position.y = viewState.origin.y;
                    this.player.position.z = viewState.origin.z;
                }

                // Sync velocity and onGround for weapon bob
                const dv = this.demoPlayer.velocity;
                if (!this.player.velocity) this.player.velocity = { x: 0, y: 0, z: 0 };
                this.player.velocity.x = dv.x;
                this.player.velocity.y = dv.y;
                this.player.velocity.z = dv.z;
                this.player.onGround = this.demoPlayer.onGround;
            }

            // Sync demo entity positions to visual meshes
            this.syncDemoEntitiesToVisuals();

            // Sync static entities (torches, decorations) once they're available
            this.syncDemoStaticEntities();
        }

        // Update entities and renderer
        if (this.entities) {
            this.entities.update(frameTime, this.time);
        }
        if (this.renderer) {
            this.renderer.update(frameTime);

            // Sync demo stats to player before weapon update so currentWeapon is set
            if (this.demoPlayer && this.player) {
                this.syncDemoStatsToPlayer();
                this.renderer.updateWeapon(frameTime, this.player);
            }
        }

        // Update audio listener position for spatial audio during demo playback
        this.updateAudioListener();

        // Render
        this.renderDemo();

        // Next frame
        requestAnimationFrame(() => this.demoGameLoop());
    }

    /**
     * Render during demo playback
     */
    renderDemo() {
        if (!this.renderer || !this.player) return;

        // Get velocity from demo player if available (for view bob)
        const velocity = this.demoPlayer?.velocity || null;
        const viewHeight = this.demoPlayer?.viewHeight || 22;
        const onGround = this.demoPlayer?.onGround !== false;
        const time = this.demoPlayer?.time || 0;

        // Update camera from demo view angles
        this.renderer.updateCamera(this.player.position, this.player.angles, velocity, {
            viewHeight: viewHeight,
            onGround: onGround,
            time: time,
            deltaTime: this.deltaTime
        });

        // Render scene
        this.renderer.render();

        // Update HUD from demo stats
        if (this.hud && this.demoPlayer && this.player) {
            this.syncDemoStatsToPlayer();
            this.hud.draw(this.player);
        }
    }

    /**
     * Sync demo stats to player object for HUD display
     */
    syncDemoStatsToPlayer() {
        if (!this.demoPlayer || !this.player) return;

        const stats = this.demoPlayer.stats;
        // Import STAT indices
        const STAT = {
            HEALTH: 0, WEAPON: 2, AMMO: 3, ARMOR: 4,
            WEAPONFRAME: 5,
            SHELLS: 6, NAILS: 7, ROCKETS: 8, CELLS: 9,
            ACTIVEWEAPON: 10,
            TOTALSECRETS: 11, TOTALMONSTERS: 12,
            SECRETS: 13, MONSTERS: 14
        };

        // Sync basic stats
        this.player.health = stats[STAT.HEALTH];
        this.player.armor = stats[STAT.ARMOR];

        // Sync ammo
        if (!this.player.ammo) this.player.ammo = {};
        this.player.ammo.shells = stats[STAT.SHELLS];
        this.player.ammo.nails = stats[STAT.NAILS];
        this.player.ammo.rockets = stats[STAT.ROCKETS];
        this.player.ammo.cells = stats[STAT.CELLS];

        // Sync active weapon (for ammo display)
        this.player.currentWeapon = this.weaponBitmaskToIndex(stats[STAT.ACTIVEWEAPON]);

        // Sync weapon frame for viewmodel animation
        this.player.weaponFrame = stats[STAT.WEAPONFRAME] || 0;

        // Sync level stats
        this.player.totalSecrets = stats[STAT.TOTALSECRETS];
        this.player.totalMonsters = stats[STAT.TOTALMONSTERS];
        this.player.foundSecrets = stats[STAT.SECRETS];
        this.player.killedMonsters = stats[STAT.MONSTERS];
    }

    /**
     * Convert weapon bitmask to weapon index
     */
    weaponBitmaskToIndex(bitmask) {
        // IT_SHOTGUN = 1, IT_SUPER_SHOTGUN = 2, IT_NAILGUN = 4, etc.
        if (bitmask & 1) return 2;       // Shotgun
        if (bitmask & 2) return 3;       // Super Shotgun
        if (bitmask & 4) return 4;       // Nailgun
        if (bitmask & 8) return 5;       // Super Nailgun
        if (bitmask & 16) return 6;      // Grenade Launcher
        if (bitmask & 32) return 7;      // Rocket Launcher
        if (bitmask & 64) return 8;      // Lightning Gun
        return 1;                         // Default: Axe
    }

    /**
     * Setup keyboard shortcuts for save/load
     * F5 = Quick Save, F9 = Quick Load
     */
    setupSaveLoadKeys() {
        document.addEventListener('keydown', async (event) => {
            // Only handle save/load when game is running and not in demo mode
            if (this.demoMode) return;

            if (event.key === 'F5') {
                event.preventDefault();
                if (this.saveSystem && this.running && !this.paused) {
                    if (this.saveSystem.quickSave()) {
                        // Visual/audio feedback
                        if (this.audio) {
                            this.audio.playLocal('sound/misc/menu2.wav');
                        }
                        console.log('Quick Save successful');
                    }
                }
            } else if (event.key === 'F9') {
                event.preventDefault();
                if (this.saveSystem) {
                    const info = this.saveSystem.getSaveInfo(0);
                    if (info) {
                        if (this.audio) {
                            this.audio.playLocal('sound/misc/menu2.wav');
                        }
                        console.log('Quick Load...');
                        await this.saveSystem.quickLoad();
                    } else {
                        console.log('No quick save to load');
                    }
                }
            }
        });
    }
}
