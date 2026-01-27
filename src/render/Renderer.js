import * as THREE from 'three';
import { BSPRenderer } from './BSPRenderer.js';
import { AliasRenderer } from './AliasRenderer.js';
import { SkyRenderer } from './SkyRenderer.js';
import { WeaponRenderer } from './WeaponRenderer.js';
import { Effects } from './Effects.js';
import { LightStyles } from './LightStyles.js';
import { ViewEffects } from './ViewEffects.js';
import { SpriteRenderer } from './SpriteRenderer.js';
import { updateDynamicLights, MAX_DLIGHTS } from './LightmapMaterial.js';

/**
 * Renderer - Main Three.js scene management
 */
export class Renderer {
    constructor(container) {
        this.container = container;
        this.width = container.clientWidth;
        this.height = container.clientHeight;

        // Three.js setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a0a00);

        // Camera (Quake FOV is typically 90)
        this.camera = new THREE.PerspectiveCamera(90, this.width / this.height, 1, 8192);
        this.camera.up.set(0, 0, 1); // Quake uses Z-up

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.LinearToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        // Position absolutely so it doesn't affect document flow
        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';

        container.appendChild(canvas);

        // Sub-renderers
        this.bspRenderer = null;
        this.aliasRenderer = null;
        this.skyRenderer = null;
        this.weaponRenderer = null;
        this.spriteRenderer = null;

        // Effects system (pass this renderer for BSP dynamic lighting, and camera for distance scaling)
        this.effects = new Effects(this.scene, this, this.camera);

        // Light styles system
        this.lightStyles = new LightStyles();

        // View effects system (screen overlays)
        this.viewEffects = new ViewEffects(container);

        // Dynamic lights system (like cl_dlights[] in client.h)
        // Original Quake: MAX_DLIGHTS = 32, we use 8 for performance
        this.dynamicLights = [];

        // Model cache
        this.models = new Map();

        // View state
        this.viewBob = 0;

        // View bob cvars (from view.c)
        this.cl_bob = 0.02;
        this.cl_bobcycle = 0.6;
        this.cl_bobup = 0.5;

        // Stair smoothing state (from view.c V_CalcRefdef)
        this.oldZ = 0;

        // View kick from damage (time-based decay like original Quake)
        // Original: v_kicktime = 0.5, v_kickroll = 0.6, v_kickpitch = 0.6
        this.viewKick = {
            pitch: 0,       // Target kick pitch from damage
            roll: 0,        // Target kick roll from damage
            time: 0         // Remaining kick time (decays from v_kicktime)
        };
        this.v_kicktime = 0.5;  // Time to decay kick (from view.c)

        // Idle view sway cvars (from view.c V_AddIdle)
        // Default v_idlescale is 0 (disabled), set > 0 to enable
        this.v_idlescale = 0;  // Scale of idle sway (0 = disabled)
        this.v_iyaw_cycle = 2;
        this.v_iroll_cycle = 0.5;
        this.v_ipitch_cycle = 1;
        this.v_iyaw_level = 0.3;
        this.v_iroll_level = 0.1;
        this.v_ipitch_level = 0.3;

        // Weapon punch angle (from view.c:958)
        // cl.punchangle is set by weapon firing and decays exponentially
        // VectorAdd (r_refdef.viewangles, cl.punchangle, r_refdef.viewangles)
        // Original Quake decays at 10Hz physics with *= 0.9 per tick
        // We decay continuously: punchangle *= pow(0.9, deltaTime * 72)
        // This gives ~0.9^72 ≈ 0.0003 decay per second (nearly gone in 0.2s)
        this.punchangle = { pitch: 0, yaw: 0, roll: 0 };

        // V_DriftPitch state (view.c:146-239)
        // Auto-centers pitch when player is on ground and moving forward
        this.pitchDrift = {
            nodrift: true,
            driftmove: 0,
            pitchvel: 0,
            laststop: 0
        };
        this.v_centermove = 0.15;  // seconds of forward movement before drift starts
        this.v_centerspeed = 500;  // degrees/sec pitch centering speed

        // CalcGunAngle state (view.c:705-756)
        this.gunAngle = {
            oldYaw: 0,
            oldPitch: 0
        };

        // Bind resize handler
        window.addEventListener('resize', () => this.onResize());

        // Debug helpers
        this.debugMode = false;
    }

    onResize() {
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;

        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(this.width, this.height);

        // Update weapon camera aspect ratio
        if (this.weaponRenderer) {
            this.weaponRenderer.updateAspect(this.camera.aspect);
        }
    }

    setFOV(fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
    }

    setBrightness(value) {
        // Original Quake gamma: lower gamma = brighter (gamma 0.5-1.0 range)
        // Our brightness: 0 = dark, 0.5 = normal, 1 = bright
        // Map 0-1 brightness to tone mapping exposure (0.5 to 2.0)
        this.renderer.toneMappingExposure = 0.5 + value * 1.5;
    }

    /**
     * Set texture filtering mode (gl_texturemode equivalent)
     * @param {boolean} smooth - true for linear filtering, false for nearest (pixelated)
     */
    setTextureFiltering(smooth) {
        // Update world textures
        if (this.bspRenderer) {
            this.bspRenderer.setTextureFiltering(smooth);
        }
        // Update model textures
        if (this.aliasRenderer) {
            this.aliasRenderer.setTextureFiltering(smooth);
        }
    }

    async loadLevel(bsp, pak) {
        // Clear existing level
        this.clearLevel();

        // Reset light styles for new level
        this.lightStyles.reset();

        // Create BSP renderer
        this.bspRenderer = new BSPRenderer(bsp, pak);
        const levelMesh = this.bspRenderer.createMesh();
        this.scene.add(levelMesh);

        // Hook up light styles to lightmap builder for dynamic updates
        if (this.bspRenderer.lightmapBuilder) {
            this.lightStyles.onUpdate = (values) => {
                this.bspRenderer.lightmapBuilder.updateLightStyles(values);
            };
        }

        // Create sky renderer if needed
        const skyTexture = this.findSkyTexture(bsp);
        if (skyTexture) {
            this.skyRenderer = new SkyRenderer(bsp, pak, skyTexture);
            const skyMesh = this.skyRenderer.createMesh();
            this.scene.add(skyMesh);
        }

        // Create alias renderer for models
        this.aliasRenderer = new AliasRenderer(pak);

        // Create sprite renderer for sprite effects
        this.spriteRenderer = new SpriteRenderer(pak);

        // Create weapon renderer for first-person viewmodel
        this.weaponRenderer = new WeaponRenderer(this.aliasRenderer);
        this.weaponRenderer.attachToCamera(this.camera);
        await this.weaponRenderer.loadWeaponModels();

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(ambientLight);

        console.log('Level loaded');
    }

    findSkyTexture(bsp) {
        for (const texture of bsp.textures) {
            if (texture && texture.name.startsWith('sky')) {
                return texture.name;
            }
        }
        return null;
    }

    clearLevel() {
        // Remove all objects from scene
        while (this.scene.children.length > 0) {
            const obj = this.scene.children[0];
            this.scene.remove(obj);

            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        }

        this.bspRenderer = null;
        this.aliasRenderer = null;
        this.skyRenderer = null;
        if (this.weaponRenderer) {
            this.weaponRenderer.clear();
            this.weaponRenderer = null;
        }
        if (this.spriteRenderer) {
            this.spriteRenderer.clear();
            this.spriteRenderer = null;
        }
        this.models.clear();

        // Clear effects
        if (this.effects) {
            this.effects.clear();
        }

        // Clear light styles
        if (this.lightStyles) {
            this.lightStyles.clear();
        }
    }

    async loadModel(name, pak) {
        if (this.models.has(name)) {
            return this.models.get(name);
        }

        // Handle sprites (.spr) vs alias models (.mdl)
        if (name.endsWith('.spr')) {
            if (!this.spriteRenderer) {
                this.spriteRenderer = new SpriteRenderer(pak);
            }
            const sprite = await this.spriteRenderer.loadSprite(name);
            if (sprite) {
                // Mark as sprite for createModelInstance
                sprite.isSprite = true;
                this.models.set(name, sprite);
            }
            return sprite;
        }

        // Default: alias model (.mdl)
        if (!this.aliasRenderer) {
            this.aliasRenderer = new AliasRenderer(pak);
        }

        const model = await this.aliasRenderer.loadModel(name);
        this.models.set(name, model);
        return model;
    }

    createModelInstance(modelData) {
        if (!modelData) return null;

        // Handle sprites
        if (modelData.isSprite) {
            if (!this.spriteRenderer) return null;
            return this.spriteRenderer.createInstance(modelData);
        }

        // Default: alias model
        if (!this.aliasRenderer) return null;
        return this.aliasRenderer.createInstance(modelData);
    }

    addToScene(object) {
        this.scene.add(object);
    }

    removeFromScene(object) {
        this.scene.remove(object);
    }

    /**
     * Calculate view bob from player velocity (V_CalcBob from view.c)
     *
     * Original Quake view.c:112-136:
     *   cycle = cl.time - (int)(cl.time/cl_bobcycle.value)*cl_bobcycle.value
     *   cycle /= cl_bobcycle.value
     *   if (cycle < cl_bobup.value)
     *     cycle = M_PI * cycle / cl_bobup.value
     *   else
     *     cycle = M_PI + M_PI*(cycle-cl_bobup.value)/(1.0 - cl_bobup.value)
     *   bob = sqrt(vel[0]^2 + vel[1]^2) * cl_bob.value
     *   bob = bob*0.3 + bob*0.7*sin(cycle)
     *   clamp to [-7, 4]
     *
     * @param {number} time - Current game time
     * @param {Object} velocity - Player velocity {x, y, z}
     * @returns {number} Bob offset in units
     */
    calcBob(time, velocity) {
        if (!velocity) return 0;

        // Calculate cycle position
        let cycle = time - Math.floor(time / this.cl_bobcycle) * this.cl_bobcycle;
        cycle /= this.cl_bobcycle;

        // Map to sinusoidal curve
        // First half (cl_bobup portion) is the "up" phase
        if (cycle < this.cl_bobup) {
            cycle = Math.PI * cycle / this.cl_bobup;
        } else {
            // Second half is the "down" phase
            cycle = Math.PI + Math.PI * (cycle - this.cl_bobup) / (1.0 - this.cl_bobup);
        }

        // Bob is proportional to XY velocity (not Z, or jumping messes it up)
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        let bob = speed * this.cl_bob;

        // Mix static and sinusoidal components
        bob = bob * 0.3 + bob * 0.7 * Math.sin(cycle);

        // Clamp to range
        if (bob > 4) bob = 4;
        else if (bob < -7) bob = -7;

        return bob;
    }

    /**
     * Calculate stair step smoothing (from view.c V_CalcRefdef lines 961-979)
     *
     * When climbing stairs, gradually raise camera (80 units/sec) to smooth
     * the abrupt Z changes.
     *
     * @param {number} originZ - Current player origin Z
     * @param {boolean} onGround - Whether player is on ground
     * @param {number} deltaTime - Frame delta time
     * @returns {number} Z offset to apply
     */
    calcStairSmooth(originZ, onGround, deltaTime) {
        let offset = 0;

        if (onGround && originZ - this.oldZ > 0) {
            // Climbing - gradually raise oldZ toward current Z
            const steptime = Math.max(0, deltaTime);
            this.oldZ += steptime * 80;  // 80 units/sec smoothing rate

            // Don't overshoot current position
            if (this.oldZ > originZ) {
                this.oldZ = originZ;
            }

            // Limit max delta (12 units max offset)
            if (originZ - this.oldZ > 12) {
                this.oldZ = originZ - 12;
            }

            offset = this.oldZ - originZ;
        } else {
            // Not climbing or not on ground - track current Z
            this.oldZ = originZ;
        }

        return offset;
    }

    /**
     * V_AddIdle - Calculate idle view sway (from view.c:793-798)
     *
     * Adds subtle sinusoidal motion to view angles when idle.
     * Controlled by v_idlescale cvar (default 0 = disabled).
     *
     * @param {number} time - Current game time
     * @returns {Object} {yaw, pitch, roll} deltas to add
     */
    calcIdleSway(time) {
        if (this.v_idlescale <= 0) {
            return { yaw: 0, pitch: 0, roll: 0 };
        }

        return {
            yaw: this.v_idlescale * Math.sin(time * this.v_iyaw_cycle) * this.v_iyaw_level,
            pitch: this.v_idlescale * Math.sin(time * this.v_ipitch_cycle) * this.v_ipitch_level,
            roll: this.v_idlescale * Math.sin(time * this.v_iroll_cycle) * this.v_iroll_level
        };
    }

    /**
     * V_StartPitchDrift (view.c:146-160)
     */
    startPitchDrift(time) {
        if (this.pitchDrift.laststop === time) return;
        if (this.pitchDrift.nodrift || !this.pitchDrift.pitchvel) {
            this.pitchDrift.pitchvel = this.v_centerspeed;
            this.pitchDrift.nodrift = false;
            this.pitchDrift.driftmove = 0;
        }
    }

    /**
     * V_StopPitchDrift (view.c:162-168)
     */
    stopPitchDrift(time) {
        this.pitchDrift.laststop = time;
        this.pitchDrift.nodrift = true;
        this.pitchDrift.pitchvel = 0;
    }

    /**
     * V_DriftPitch (view.c:182-239)
     * Auto-centers pitch when player is on ground and moving forward.
     */
    driftPitch(angles, deltaTime, options = {}) {
        const onGround = options.onGround !== undefined ? options.onGround : true;
        const forwardMove = options.forwardMove || 0;
        const time = options.time || 0;
        const demoPlayback = options.demoPlayback || false;

        if (demoPlayback || !onGround) {
            this.pitchDrift.driftmove = 0;
            this.pitchDrift.pitchvel = 0;
            return;
        }

        if (this.pitchDrift.nodrift) {
            if (Math.abs(forwardMove) < 200) {  // cl_forwardspeed default
                this.pitchDrift.driftmove = 0;
            } else {
                this.pitchDrift.driftmove += deltaTime;
            }
            if (this.pitchDrift.driftmove > this.v_centermove) {
                this.startPitchDrift(time);
            }
            return;
        }

        const idealPitch = 0; // Ground level
        const delta = idealPitch - angles.pitch;

        if (delta === 0) {
            this.pitchDrift.pitchvel = 0;
            return;
        }

        let move = deltaTime * this.pitchDrift.pitchvel;
        this.pitchDrift.pitchvel += deltaTime * this.v_centerspeed;

        if (delta > 0) {
            if (move > delta) {
                this.pitchDrift.pitchvel = 0;
                move = delta;
            }
            angles.pitch += move;
        } else {
            if (move > -delta) {
                this.pitchDrift.pitchvel = 0;
                move = -delta;
            }
            angles.pitch -= move;
        }
    }

    /**
     * V_BoundOffsets (view.c:763-784)
     * Prevent camera from going outside entity clipping hull.
     */
    boundOffsets(camPos, entityPos) {
        if (camPos.x < entityPos.x - 14) camPos.x = entityPos.x - 14;
        else if (camPos.x > entityPos.x + 14) camPos.x = entityPos.x + 14;
        if (camPos.y < entityPos.y - 14) camPos.y = entityPos.y - 14;
        else if (camPos.y > entityPos.y + 14) camPos.y = entityPos.y + 14;
        if (camPos.z < entityPos.z - 22) camPos.z = entityPos.z - 22;
        else if (camPos.z > entityPos.z + 30) camPos.z = entityPos.z + 30;
    }

    /**
     * Calculate strafe roll (V_CalcRoll from view.c)
     * Roll the camera when strafing, like original Quake
     *
     * Original formula:
     *   side = DotProduct(velocity, right)
     *   if (side < cl_rollspeed) side = side * cl_rollangle / cl_rollspeed
     *   else side = cl_rollangle
     *   return side * sign
     *
     * Defaults: cl_rollangle = 2.0, cl_rollspeed = 200
     *
     * @param {Object} angles - View angles {yaw, pitch, roll}
     * @param {Object} velocity - Player velocity {x, y, z}
     * @returns {number} Roll angle in degrees
     */
    calcStrafeRoll(angles, velocity) {
        if (!velocity) return 0;

        const cl_rollangle = 2.0;
        const cl_rollspeed = 200;

        // Calculate right vector from yaw
        const yawRad = THREE.MathUtils.degToRad(angles.yaw);
        const right = {
            x: Math.sin(yawRad),
            y: -Math.cos(yawRad),
            z: 0
        };

        // Dot product of velocity and right vector (sideways velocity)
        let side = velocity.x * right.x + velocity.y * right.y;
        const sign = side < 0 ? -1 : 1;
        side = Math.abs(side);

        // Scale based on speed
        if (side < cl_rollspeed) {
            side = side * cl_rollangle / cl_rollspeed;
        } else {
            side = cl_rollangle;
        }

        return side * sign;
    }

    /**
     * Update camera position and orientation
     * @param {Object} position - World position {x, y, z}
     * @param {Object} angles - View angles {yaw, pitch, roll}
     * @param {Object} velocity - Player velocity for strafe roll (optional) {x, y, z}
     * @param {Object} options - Optional settings {viewHeight, onGround, time, deltaTime}
     */
    updateCamera(position, angles, velocity = null, options = {}) {
        // Quake coordinate system: X=forward, Y=left, Z=up
        // Three.js with Z-up (camera.up = 0,0,1)

        // Eye height from cl.viewheight (default 22, can be 12 crouching, 8 dead)
        const eyeHeight = options.viewHeight !== undefined ? options.viewHeight : 22;

        // V_DriftPitch — auto-center pitch when on ground (view.c:182-239)
        const deltaTime = options.deltaTime || 0;
        const time = options.time || 0;
        if (!options.demoPlayback) {
            this.driftPitch(angles, deltaTime, options);
        }

        // Calculate view bob from velocity and time
        const bob = this.calcBob(time, velocity);

        // Calculate stair smoothing
        const onGround = options.onGround !== undefined ? options.onGround : true;
        const stairSmooth = this.calcStairSmooth(position.z, onGround, deltaTime);

        // Final camera position
        // Add +1/32 on each axis to prevent water plane clipping at exact boundaries
        // (from view.c:898-900 V_CalcRefdef)
        const PRECISION_OFFSET = 1 / 32;
        const camPos = {
            x: position.x + PRECISION_OFFSET,
            y: position.y + PRECISION_OFFSET,
            z: position.z + eyeHeight + bob + stairSmooth + PRECISION_OFFSET
        };

        // V_BoundOffsets — prevent camera from going outside clipping hull (view.c:763-784)
        this.boundOffsets(camPos, position);

        this.camera.position.set(camPos.x, camPos.y, camPos.z);

        // Calculate damage kick contribution (time-based decay like original)
        // Original: viewangles += v_dmg_time/v_kicktime * v_dmg_pitch/roll
        let kickPitch = 0;
        let kickRoll = 0;
        if (this.viewKick.time > 0) {
            const kickFrac = this.viewKick.time / this.v_kicktime;
            kickPitch = kickFrac * this.viewKick.pitch;
            kickRoll = kickFrac * this.viewKick.roll;
        }

        // Calculate idle view sway (V_AddIdle from view.c:793-798)
        const idleSway = this.calcIdleSway(time);

        // Calculate look direction from Quake angles
        // Quake: yaw = rotation around Z (0 = +X), pitch = up/down (positive = look down)
        // Add punchangle from weapon firing (view.c:958)
        const yawRad = THREE.MathUtils.degToRad(angles.yaw + idleSway.yaw + this.punchangle.yaw);
        const pitchRad = THREE.MathUtils.degToRad(angles.pitch + kickPitch + idleSway.pitch + this.punchangle.pitch);

        // Forward direction in Quake coordinates
        const cosPitch = Math.cos(pitchRad);
        const forward = new THREE.Vector3(
            Math.cos(yawRad) * cosPitch,
            Math.sin(yawRad) * cosPitch,
            -Math.sin(pitchRad)
        );

        // Look at point in front of camera
        const target = new THREE.Vector3(
            camPos.x + forward.x,
            camPos.y + forward.y,
            camPos.z + forward.z
        );

        this.camera.lookAt(target);

        // Dead view angle (view.c:824): r_refdef.viewangles[ROLL] = 80
        const health = options.health !== undefined ? options.health : 100;
        if (health <= 0) {
            const rollRad = THREE.MathUtils.degToRad(80);
            this.camera.rotateZ(rollRad);
            return;
        }

        // Calculate strafe roll from velocity (V_CalcRoll)
        const strafeRoll = this.calcStrafeRoll(angles, velocity);

        // Apply total roll (angles.roll + strafe roll + damage kick roll + idle roll + punchangle roll)
        const totalRoll = (angles.roll || 0) + strafeRoll + kickRoll + idleSway.roll + this.punchangle.roll;
        if (totalRoll !== 0) {
            const rollRad = THREE.MathUtils.degToRad(totalRoll);
            this.camera.rotateZ(rollRad);
        }
    }

    setViewBob(amount) {
        this.viewBob = amount;
    }

    /**
     * Set view kick from damage (like V_ParseDamage in view.c)
     * Original calculation:
     *   v_dmg_roll = count * side * v_kickroll (0.6)
     *   v_dmg_pitch = count * forward * v_kickpitch (0.6)
     *   v_dmg_time = v_kicktime (0.5)
     *
     * @param {number} pitch - Kick pitch angle in degrees
     * @param {number} roll - Kick roll angle in degrees
     */
    setViewKick(pitch, roll) {
        this.viewKick.pitch = pitch;
        this.viewKick.roll = roll;
        this.viewKick.time = this.v_kicktime;  // Reset timer
    }

    /**
     * Set punch angle from weapon firing (like cl.punchangle in client.h)
     * This is different from damage kick - it's set by weapon firing and
     * decays exponentially each frame (view.c:958)
     *
     * Original values from weapons.qc:
     *   Shotgun: punchangle_x = -2
     *   Super Shotgun: punchangle_x = -4
     *   Nailgun: punchangle_x = -1
     *   Rocket/Grenade: punchangle_x = -2 to -4
     *
     * @param {number} pitch - Punch pitch angle in degrees (negative = kick up)
     * @param {number} yaw - Punch yaw angle in degrees (optional, usually 0)
     * @param {number} roll - Punch roll angle in degrees (optional, usually 0)
     */
    setPunchAngle(pitch, yaw = 0, roll = 0) {
        // Add to existing punchangle (allows rapid fire accumulation)
        this.punchangle.pitch += pitch;
        this.punchangle.yaw += yaw;
        this.punchangle.roll += roll;
    }

    /**
     * Update view effects based on player state
     */
    updateViewEffects(player, deltaTime) {
        if (this.viewEffects) {
            this.viewEffects.update(player, deltaTime);
        }
    }

    update(deltaTime) {
        // Update view kick decay (time-based like original Quake)
        // Original: v_dmg_time -= host_frametime
        if (this.viewKick.time > 0) {
            this.viewKick.time -= deltaTime;
            if (this.viewKick.time <= 0) {
                this.viewKick.time = 0;
                // Don't reset pitch/roll - they're used with the time fraction
            }
        }

        // Update punchangle decay (exponential decay like original Quake)
        // Original: cl.punchangle[i] *= 0.9 at 10Hz physics (host_frametime ~0.1)
        // Continuous equivalent: punchangle *= pow(0.9, deltaTime / 0.1)
        // This makes it frame-rate independent while matching original feel
        if (this.punchangle.pitch !== 0 || this.punchangle.yaw !== 0 || this.punchangle.roll !== 0) {
            const decayFactor = Math.pow(0.9, deltaTime / 0.1);
            this.punchangle.pitch *= decayFactor;
            this.punchangle.yaw *= decayFactor;
            this.punchangle.roll *= decayFactor;

            // Zero out when very small to prevent floating point drift
            if (Math.abs(this.punchangle.pitch) < 0.01) this.punchangle.pitch = 0;
            if (Math.abs(this.punchangle.yaw) < 0.01) this.punchangle.yaw = 0;
            if (Math.abs(this.punchangle.roll) < 0.01) this.punchangle.roll = 0;
        }

        // Update animated textures
        if (this.bspRenderer) {
            this.bspRenderer.update(deltaTime);
        }

        if (this.skyRenderer) {
            this.skyRenderer.update(deltaTime, this.camera);
        }

        // Update particle effects
        if (this.effects) {
            this.effects.update(deltaTime);
        }

        // Update light styles (animated lights)
        if (this.lightStyles) {
            this.lightStyles.update(deltaTime);
            // Update flame model animations
            this.lightStyles.updateFlames(deltaTime, this.aliasRenderer);
        }

        // Update sprite orientations
        if (this.spriteRenderer) {
            this.spriteRenderer.update(this.camera, deltaTime);
        }

        // Update dynamic lights (decay, expire, apply to materials)
        this.updateDynamicLights(deltaTime);
    }

    updateWeapon(deltaTime, player) {
        if (this.weaponRenderer) {
            this.weaponRenderer.update(deltaTime, player);
        }
    }

    fireWeapon() {
        if (this.weaponRenderer) {
            this.weaponRenderer.fire();
        }
    }

    /**
     * Add a dynamic light (like CL_AllocDlight in cl_main.c)
     * Original Quake dynamic lights are used for:
     * - Muzzle flash (weapon firing)
     * - Explosions (rockets, grenades)
     * - Power-ups (quad, pent, etc.)
     *
     * @param {Object} options - Light options
     * @param {Object} options.position - World position {x, y, z}
     * @param {number} options.radius - Light radius (200-350 typical)
     * @param {Object} options.color - Light color {r, g, b} normalized 0-1
     * @param {number} options.decay - Decay rate per second (0 = no decay)
     * @param {number} options.die - Time to die (absolute game time)
     * @param {number} options.key - Entity key for tracking (0 = anonymous)
     * @returns {Object} The light object
     */
    addDynamicLight(options) {
        const light = {
            position: options.position || { x: 0, y: 0, z: 0 },
            radius: options.radius || 200,
            color: options.color || { r: 1, g: 1, b: 1 },
            decay: options.decay || 0,
            die: options.die || 0,
            key: options.key || 0
        };

        // If we're at max lights, find one to replace
        if (this.dynamicLights.length >= MAX_DLIGHTS) {
            // Try to find a light with the same key
            if (light.key > 0) {
                const existing = this.dynamicLights.findIndex(l => l.key === light.key);
                if (existing >= 0) {
                    this.dynamicLights[existing] = light;
                    return light;
                }
            }
            // Otherwise replace the oldest/dimmest light
            this.dynamicLights.shift();
        }

        this.dynamicLights.push(light);
        return light;
    }

    /**
     * Add a muzzle flash dynamic light (standard weapon flash)
     * @param {Object} position - World position
     */
    addMuzzleFlash(position) {
        this.addDynamicLight({
            position,
            radius: 200,
            color: { r: 1, g: 0.8, b: 0.4 },  // Orange-yellow
            decay: 400,  // Fades quickly
            die: 0.1     // Lives for 0.1 seconds (relative time)
        });
    }

    /**
     * Add an explosion dynamic light
     * @param {Object} position - World position
     */
    addExplosionLight(position) {
        this.addDynamicLight({
            position,
            radius: 350,
            color: { r: 1, g: 0.6, b: 0.2 },  // Orange
            decay: 300,  // Slower decay than muzzle flash
            die: 0.5     // Lives for 0.5 seconds
        });
    }

    /**
     * Update dynamic lights (decay and remove expired)
     * Called each frame
     * @param {number} deltaTime - Frame time in seconds
     */
    updateDynamicLights(deltaTime) {
        // Update and filter lights
        this.dynamicLights = this.dynamicLights.filter(light => {
            // Apply radius decay
            if (light.decay > 0) {
                light.radius -= light.decay * deltaTime;
            }

            // Apply time decay
            if (light.die > 0) {
                light.die -= deltaTime;
                if (light.die <= 0) {
                    return false; // Remove expired light
                }
            }

            // Remove lights that have decayed to nothing
            return light.radius > 0;
        });

        // Update BSP materials with current dynamic lights
        if (this.bspRenderer) {
            this.bspRenderer.updateDynamicLights(this.dynamicLights);
        }
    }

    /**
     * Clear all dynamic lights
     */
    clearDynamicLights() {
        this.dynamicLights = [];
        if (this.bspRenderer) {
            this.bspRenderer.updateDynamicLights([]);
        }
    }

    render() {
        // Render main scene
        this.renderer.render(this.scene, this.camera);

        // Render weapon on top (clears depth, keeps color)
        if (this.weaponRenderer) {
            this.weaponRenderer.render(this.renderer);
        }

        // View effects (damage flash, powerups, etc.) are handled by ViewEffects overlay
    }

    toggleDebug() {
        this.debugMode = !this.debugMode;

        if (this.debugMode) {
            // Add axis helper
            const axisHelper = new THREE.AxesHelper(100);
            axisHelper.name = 'debug_axes';
            this.scene.add(axisHelper);
        } else {
            const axes = this.scene.getObjectByName('debug_axes');
            if (axes) {
                this.scene.remove(axes);
            }
        }
    }

    getCanvas() {
        return this.renderer.domElement;
    }
}
