import * as THREE from 'three';
import { WEAPON } from '../entities/Player.js';

/**
 * WeaponRenderer - Renders first-person weapon viewmodel
 *
 * Uses a separate scene rendered after clearing depth buffer
 * so weapon always appears on top of world geometry (including water).
 * Camera orientation is copied each frame for smooth movement.
 */
export class WeaponRenderer {
    constructor(aliasRenderer) {
        this.aliasRenderer = aliasRenderer;

        // Separate scene for weapon (rendered after main scene with depth clear)
        this.scene = new THREE.Scene();

        // Dedicated camera for weapon scene (copies orientation from main camera)
        this.camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
        this.mainCamera = null;

        this.weaponMesh = null;
        this.currentWeapon = null;
        this.weaponModels = new Map();

        // Animation state
        this.weaponTime = 0;
        this.fireTime = 0;
        this.firing = false;

        // Bob state
        this.bob = 0;

        // Loading state
        this.modelsLoaded = false;
        this.pendingWeapon = null;
        this.lastWeaponFrame = -1;
    }

    attachToCamera(camera) {
        this.mainCamera = camera;
        // Match aspect ratio
        this.camera.aspect = camera.aspect;
        this.camera.updateProjectionMatrix();
    }

    async loadWeaponModels() {
        const weapons = [
            { id: WEAPON.AXE, model: 'progs/v_axe.mdl' },
            { id: WEAPON.SHOTGUN, model: 'progs/v_shot.mdl' },
            { id: WEAPON.SUPER_SHOTGUN, model: 'progs/v_shot2.mdl' },
            { id: WEAPON.NAILGUN, model: 'progs/v_nail.mdl' },
            { id: WEAPON.SUPER_NAILGUN, model: 'progs/v_nail2.mdl' },
            { id: WEAPON.GRENADE_LAUNCHER, model: 'progs/v_rock.mdl' },
            { id: WEAPON.ROCKET_LAUNCHER, model: 'progs/v_rock2.mdl' },
            { id: WEAPON.LIGHTNING, model: 'progs/v_light.mdl' }
        ];

        for (const weapon of weapons) {
            try {
                const modelData = await this.aliasRenderer.loadModel(weapon.model);
                if (modelData) {
                    this.weaponModels.set(weapon.id, modelData);
                    console.log(`Loaded weapon model: ${weapon.model}`);
                }
            } catch (e) {
                console.warn(`Failed to load weapon model ${weapon.model}:`, e);
            }
        }

        this.modelsLoaded = true;

        // If a weapon was requested before models loaded, set it now
        if (this.pendingWeapon !== null) {
            this.setWeapon(this.pendingWeapon);
            this.pendingWeapon = null;
        }
    }

    setWeapon(weaponId) {
        // If models aren't loaded yet, queue the weapon change
        if (!this.modelsLoaded) {
            this.pendingWeapon = weaponId;
            return;
        }
        if (this.currentWeapon === weaponId) return;

        if (this.weaponMesh) {
            this.scene.remove(this.weaponMesh);
            if (this.weaponMesh.geometry) this.weaponMesh.geometry.dispose();
            this.weaponMesh = null;
        }

        this.currentWeapon = weaponId;

        const modelData = this.weaponModels.get(weaponId);
        if (!modelData) {
            console.warn(`No model loaded for weapon ${weaponId}`);
            return;
        }

        this.weaponMesh = this.aliasRenderer.createInstance(modelData);
        if (this.weaponMesh) {
            this.aliasRenderer.setFrame(this.weaponMesh, 0);
            this.weaponMesh.frustumCulled = false;

            this.updateWeaponTransform(0, 0);
            this.scene.add(this.weaponMesh);
        }
    }

    fire() {
        this.firing = true;
        this.fireTime = 0;

        if (this.weaponMesh && this.weaponMesh.userData.modelData) {
            const animations = this.weaponMesh.userData.modelData.animations;
            if (animations.shot) {
                this.aliasRenderer.setAnimation(this.weaponMesh, 'shot');
            } else if (animations.fire) {
                this.aliasRenderer.setAnimation(this.weaponMesh, 'fire');
            } else if (animations.attack) {
                this.aliasRenderer.setAnimation(this.weaponMesh, 'attack');
            }
        }
    }

    update(deltaTime, player) {
        this.weaponTime += deltaTime;

        if (player && player.currentWeapon !== this.currentWeapon) {
            this.setWeapon(player.currentWeapon);
        }

        if (!this.weaponMesh || !player) return;

        // Set weapon frame directly from player state (like original Quake view.c)
        // view->frame = cl.stats[STAT_WEAPONFRAME]
        if (player.weaponFrame !== undefined && player.weaponFrame !== this.lastWeaponFrame) {
            this.lastWeaponFrame = player.weaponFrame;
            this.aliasRenderer.setFrame(this.weaponMesh, player.weaponFrame);
        } else if (this.firing) {
            // Fallback: client-side fire animation (non-demo gameplay)
            this.fireTime += deltaTime;
            if (this.fireTime < 0.15) {
                this.aliasRenderer.updateAnimation(this.weaponMesh, deltaTime);
            } else {
                this.firing = false;
                this.aliasRenderer.setFrame(this.weaponMesh, 0);
            }
        }

        // Calculate bob based on velocity (like Quake)
        const vel = player.velocity || { x: 0, y: 0, z: 0 };
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

        if (player.onGround && speed > 10) {
            const cycle = this.weaponTime * 10;
            this.bob = Math.sin(cycle) * Math.min(speed / 400, 1) * 2;
        } else {
            this.bob *= 0.9;
        }

        this.updateWeaponTransform(this.bob * 0.4, this.bob);
    }

    updateWeaponTransform(forwardBob, upBob) {
        if (!this.weaponMesh) return;

        // Weapon scene camera is at origin looking down -Z
        // Position weapon in front of camera (negative Z = forward)
        // Base position puts weapon geometry in lower center of screen
        // MDL geometry extends forward (+X in Quake) and down (-Z in Quake)
        const baseForward = 5;  // Base distance forward
        const baseDown = -2;    // Slight downward offset
        this.weaponMesh.position.set(0, baseDown + upBob, -baseForward - forwardBob);

        // Rotation to transform from Quake coords to camera local coords:
        // Quake: +X forward, +Y left, +Z up
        // Camera: -Z forward, +X right, +Y up
        this.weaponMesh.rotation.order = 'YXZ';
        this.weaponMesh.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
    }

    updateAspect(aspect) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    render(renderer) {
        if (!this.weaponMesh) return;

        // Render weapon scene on top of existing frame
        // autoClear is disabled so we keep the color buffer but clear depth
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(this.scene, this.camera);
        renderer.autoClear = oldAutoClear;
    }

    clear() {
        if (this.weaponMesh) {
            this.scene.remove(this.weaponMesh);
            if (this.weaponMesh.geometry) this.weaponMesh.geometry.dispose();
            this.weaponMesh = null;
        }
        this.currentWeapon = null;
        this.weaponModels.clear();
    }
}
